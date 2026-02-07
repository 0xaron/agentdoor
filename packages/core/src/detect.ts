/**
 * @agentgate/core - Agent Traffic Detection & Fingerprinting
 *
 * Classifies HTTP requests as human or agent traffic based on multiple
 * signals: User-Agent strings, header patterns, timing, IP ranges,
 * and self-identification headers.
 *
 * This powers the "detect-only" mode that gives SaaS owners visibility
 * into their agent traffic before they enable registration.
 */

import type { RequestInfo, DetectionResult, DetectionSignal } from "./types.js";
import {
  KNOWN_AGENT_USER_AGENTS,
  KNOWN_AGENT_IP_PREFIXES,
  BROWSER_TYPICAL_HEADERS,
  AGENT_FRAMEWORK_HEADER,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Signal Weights
// ---------------------------------------------------------------------------

/**
 * Weights for each detection signal.
 * Higher weight = more confidence in the classification.
 */
const SIGNAL_WEIGHTS = {
  /** Self-identification via X-Agent-Framework header (definitive) */
  SELF_IDENTIFICATION: 1.0,
  /** Known agent framework User-Agent string */
  USER_AGENT: 0.7,
  /** Missing typical browser headers */
  MISSING_BROWSER_HEADERS: 0.4,
  /** Known cloud/agent hosting IP range */
  IP_RANGE: 0.3,
  /** Request timing patterns (machine-speed) */
  TIMING: 0.3,
  /** Lack of session cookies */
  NO_COOKIES: 0.2,
  /** No Referer header */
  NO_REFERER: 0.15,
  /** Accept header suggests non-browser (e.g. application/json only) */
  ACCEPT_HEADER: 0.2,
} as const;

/**
 * Threshold above which we classify a request as likely from an agent.
 * Scored as weighted sum of triggered signals, normalized to 0-1.
 */
const AGENT_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Request Timing Tracker
// ---------------------------------------------------------------------------

/**
 * Tracks request timing per IP to detect machine-speed patterns.
 * Stores the last N request timestamps for each IP.
 */
class TimingTracker {
  private history: Map<string, number[]> = new Map();
  private readonly maxHistory = 20;
  private readonly windowMs = 60_000; // 1 minute tracking window

  /**
   * Record a request and check for machine-speed patterns.
   *
   * @param ip - Client IP address
   * @param timestamp - Request timestamp in ms
   * @returns Object with isPattern flag and optional detail
   */
  check(ip: string, timestamp: number): { isPattern: boolean; detail?: string } {
    if (!ip) return { isPattern: false };

    let timestamps = this.history.get(ip);
    if (!timestamps) {
      timestamps = [];
      this.history.set(ip, timestamps);
    }

    // Remove old entries outside the tracking window
    const cutoff = timestamp - this.windowMs;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    timestamps.push(timestamp);

    // Trim to max history
    if (timestamps.length > this.maxHistory) {
      timestamps.splice(0, timestamps.length - this.maxHistory);
    }

    // Need at least 5 requests to detect a pattern
    if (timestamps.length < 5) {
      return { isPattern: false };
    }

    // Check for suspiciously consistent intervals
    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }

    // Calculate coefficient of variation (CV) of intervals
    // Low CV = very consistent timing = likely machine
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance =
      intervals.reduce((sum, val) => sum + (val - mean) ** 2, 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? stdDev / mean : 0;

    // Very rapid requests (avg < 100ms between requests)
    if (mean < 100) {
      return {
        isPattern: true,
        detail: `Rapid sequential requests: avg ${Math.round(mean)}ms between requests`,
      };
    }

    // Very consistent intervals (CV < 0.15 with many requests)
    if (cv < 0.15 && timestamps.length >= 8) {
      return {
        isPattern: true,
        detail: `Consistent request intervals: CV=${cv.toFixed(3)}, mean=${Math.round(mean)}ms`,
      };
    }

    return { isPattern: false };
  }

  /**
   * Clean up old entries to prevent memory leaks.
   */
  cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.windowMs * 2;

    for (const [ip, timestamps] of this.history) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] < cutoff) {
        this.history.delete(ip);
      }
    }
  }

  /** Number of tracked IPs */
  get size(): number {
    return this.history.size;
  }
}

// ---------------------------------------------------------------------------
// Singleton Timing Tracker
// ---------------------------------------------------------------------------

const timingTracker = new TimingTracker();

// Periodic cleanup (every 5 minutes)
const cleanupInterval = setInterval(() => {
  timingTracker.cleanup();
}, 5 * 60_000);

// Allow the process to exit
if (typeof cleanupInterval === "object" && "unref" in cleanupInterval) {
  cleanupInterval.unref();
}

// ---------------------------------------------------------------------------
// Individual Signal Detectors
// ---------------------------------------------------------------------------

/**
 * Check if the User-Agent matches a known agent framework.
 */
function checkUserAgent(userAgent?: string): DetectionSignal & { framework?: string; version?: string } {
  if (!userAgent) {
    return {
      name: "user_agent",
      triggered: false,
      weight: SIGNAL_WEIGHTS.USER_AGENT,
      detail: "No User-Agent header present",
    };
  }

  for (const { pattern, framework } of KNOWN_AGENT_USER_AGENTS) {
    const match = userAgent.match(pattern);
    if (match) {
      // Try to extract version
      const versionMatch = userAgent.match(new RegExp(`${framework}[/\\s]?(\\d+\\.\\d+(?:\\.\\d+)?)`, "i"));
      const version = versionMatch?.[1];

      return {
        name: "user_agent",
        triggered: true,
        weight: SIGNAL_WEIGHTS.USER_AGENT,
        detail: `Matched known agent framework: ${framework}${version ? ` v${version}` : ""}`,
        framework,
        version,
      };
    }
  }

  // Check for missing typical browser identifiers
  const hasBrowserEngine =
    /Mozilla|Chrome|Safari|Firefox|Edge|Opera/i.test(userAgent) &&
    /AppleWebKit|Gecko|Trident|Blink/i.test(userAgent);

  if (!hasBrowserEngine) {
    return {
      name: "user_agent",
      triggered: true,
      weight: SIGNAL_WEIGHTS.USER_AGENT * 0.5, // Lower confidence
      detail: `Non-browser User-Agent: "${userAgent.substring(0, 80)}"`,
    };
  }

  return {
    name: "user_agent",
    triggered: false,
    weight: SIGNAL_WEIGHTS.USER_AGENT,
  };
}

/**
 * Check for the X-Agent-Framework self-identification header.
 * This is the highest-confidence signal (definitive).
 */
function checkSelfIdentification(
  headers: Record<string, string | string[] | undefined>,
): DetectionSignal & { framework?: string; version?: string } {
  const value = normalizeHeader(headers[AGENT_FRAMEWORK_HEADER]);

  if (value) {
    // Parse "framework/version" format
    const parts = value.split("/");
    const framework = parts[0].trim();
    const version = parts[1]?.trim();

    return {
      name: "self_identification",
      triggered: true,
      weight: SIGNAL_WEIGHTS.SELF_IDENTIFICATION,
      detail: `X-Agent-Framework: ${value}`,
      framework,
      version,
    };
  }

  return {
    name: "self_identification",
    triggered: false,
    weight: SIGNAL_WEIGHTS.SELF_IDENTIFICATION,
  };
}

/**
 * Check if typical browser headers are missing.
 */
function checkMissingBrowserHeaders(
  headers: Record<string, string | string[] | undefined>,
): DetectionSignal {
  const missingHeaders: string[] = [];

  for (const header of BROWSER_TYPICAL_HEADERS) {
    if (!headers[header]) {
      missingHeaders.push(header);
    }
  }

  // If most browser headers are missing, it's likely not a browser
  const missingRatio = missingHeaders.length / BROWSER_TYPICAL_HEADERS.length;
  const triggered = missingRatio > 0.6;

  return {
    name: "missing_browser_headers",
    triggered,
    weight: triggered ? SIGNAL_WEIGHTS.MISSING_BROWSER_HEADERS : 0,
    detail: triggered
      ? `Missing ${missingHeaders.length}/${BROWSER_TYPICAL_HEADERS.length} typical browser headers: ${missingHeaders.join(", ")}`
      : undefined,
  };
}

/**
 * Check if the IP is from a known cloud/agent hosting provider.
 */
function checkIpRange(ip?: string): DetectionSignal {
  if (!ip) {
    return {
      name: "ip_range",
      triggered: false,
      weight: SIGNAL_WEIGHTS.IP_RANGE,
    };
  }

  for (const prefix of KNOWN_AGENT_IP_PREFIXES) {
    if (ip.startsWith(prefix)) {
      return {
        name: "ip_range",
        triggered: true,
        weight: SIGNAL_WEIGHTS.IP_RANGE,
        detail: `IP ${ip} matches known cloud provider prefix ${prefix}*`,
      };
    }
  }

  return {
    name: "ip_range",
    triggered: false,
    weight: SIGNAL_WEIGHTS.IP_RANGE,
  };
}

/**
 * Check request timing patterns.
 */
function checkTiming(ip?: string, timestamp?: number): DetectionSignal {
  if (!ip || !timestamp) {
    return {
      name: "timing",
      triggered: false,
      weight: SIGNAL_WEIGHTS.TIMING,
    };
  }

  const result = timingTracker.check(ip, timestamp);

  return {
    name: "timing",
    triggered: result.isPattern,
    weight: result.isPattern ? SIGNAL_WEIGHTS.TIMING : 0,
    detail: result.detail,
  };
}

/**
 * Check if cookies are present (agents typically don't send cookies).
 */
function checkCookies(
  headers: Record<string, string | string[] | undefined>,
): DetectionSignal {
  const hasCookies = !!headers["cookie"];

  return {
    name: "no_cookies",
    triggered: !hasCookies,
    weight: !hasCookies ? SIGNAL_WEIGHTS.NO_COOKIES : 0,
    detail: !hasCookies ? "No Cookie header present" : undefined,
  };
}

/**
 * Check if Referer header is present (agents typically don't send Referer).
 */
function checkReferer(
  headers: Record<string, string | string[] | undefined>,
): DetectionSignal {
  const hasReferer = !!headers["referer"] || !!headers["referrer"];

  return {
    name: "no_referer",
    triggered: !hasReferer,
    weight: !hasReferer ? SIGNAL_WEIGHTS.NO_REFERER : 0,
    detail: !hasReferer ? "No Referer header present" : undefined,
  };
}

/**
 * Check Accept header for non-browser patterns.
 * Browsers typically send complex Accept headers;
 * agents usually request application/json directly.
 */
function checkAcceptHeader(
  headers: Record<string, string | string[] | undefined>,
): DetectionSignal {
  const accept = normalizeHeader(headers["accept"]);

  if (!accept) {
    return {
      name: "accept_header",
      triggered: true,
      weight: SIGNAL_WEIGHTS.ACCEPT_HEADER * 0.5,
      detail: "No Accept header present",
    };
  }

  // Browsers typically send complex Accept with text/html
  const isBrowserAccept = accept.includes("text/html");
  const isApiOnly =
    accept === "application/json" || accept === "*/*" || accept === "application/json, */*";

  if (!isBrowserAccept && isApiOnly) {
    return {
      name: "accept_header",
      triggered: true,
      weight: SIGNAL_WEIGHTS.ACCEPT_HEADER,
      detail: `API-only Accept header: "${accept}"`,
    };
  }

  return {
    name: "accept_header",
    triggered: false,
    weight: SIGNAL_WEIGHTS.ACCEPT_HEADER,
  };
}

// ---------------------------------------------------------------------------
// Main Detection Function
// ---------------------------------------------------------------------------

/**
 * Classify an HTTP request as human or agent traffic.
 *
 * Analyzes multiple signals and produces a confidence score.
 * Each signal has a weight; the final score is the weighted sum
 * of triggered signals normalized to 0-1.
 *
 * @param request - Normalized request information
 * @returns DetectionResult with isAgent flag, confidence, and signal details
 */
export function detectAgent(request: RequestInfo): DetectionResult {
  const signals: DetectionSignal[] = [];
  let framework: string | undefined;
  let frameworkVersion: string | undefined;

  // 1. Self-identification (highest confidence)
  const selfId = checkSelfIdentification(request.headers);
  signals.push(selfId);
  if (selfId.triggered && "framework" in selfId) {
    framework = selfId.framework;
    frameworkVersion = selfId.version;
  }

  // 2. User-Agent
  const ua = checkUserAgent(request.userAgent);
  signals.push(ua);
  if (ua.triggered && !framework && "framework" in ua) {
    framework = ua.framework;
    frameworkVersion = ua.version;
  }

  // 3. Missing browser headers
  signals.push(checkMissingBrowserHeaders(request.headers));

  // 4. IP range
  signals.push(checkIpRange(request.ip));

  // 5. Timing patterns
  signals.push(checkTiming(request.ip, request.timestamp ?? Date.now()));

  // 6. Cookies
  signals.push(checkCookies(request.headers));

  // 7. Referer
  signals.push(checkReferer(request.headers));

  // 8. Accept header
  signals.push(checkAcceptHeader(request.headers));

  // Calculate confidence score
  const maxPossibleWeight = Object.values(SIGNAL_WEIGHTS).reduce(
    (sum, w) => sum + w,
    0,
  );
  const triggeredWeight = signals
    .filter((s) => s.triggered)
    .reduce((sum, s) => sum + s.weight, 0);
  const confidence = Math.min(1, triggeredWeight / maxPossibleWeight);

  return {
    isAgent: confidence >= AGENT_THRESHOLD,
    confidence: Math.round(confidence * 1000) / 1000, // Round to 3 decimal places
    framework,
    frameworkVersion,
    signals,
  };
}

/**
 * Quick check: is this request likely from an agent?
 * Faster than the full detectAgent() - only checks the highest-confidence signals.
 *
 * @param request - Normalized request information
 * @returns true if the request is likely from an agent
 */
export function isLikelyAgent(request: RequestInfo): boolean {
  // Quick checks in order of confidence
  // 1. Self-identification header
  if (request.headers[AGENT_FRAMEWORK_HEADER]) {
    return true;
  }

  // 2. Known agent User-Agent
  if (request.userAgent) {
    for (const { pattern } of KNOWN_AGENT_USER_AGENTS) {
      if (pattern.test(request.userAgent)) {
        return true;
      }
    }
  }

  // 3. AgentGate auth headers (definitely an agent)
  if (
    request.headers["authorization"]?.toString().startsWith("Bearer agk_")
  ) {
    return true;
  }

  return false;
}

/**
 * Extract framework info from request headers and User-Agent.
 * Returns null if no framework is detected.
 *
 * @param request - Normalized request information
 * @returns Framework name and version, or null
 */
export function extractFrameworkInfo(
  request: RequestInfo,
): { framework: string; version?: string } | null {
  // Check X-Agent-Framework header first (most authoritative)
  const agentFrameworkHeader = normalizeHeader(
    request.headers[AGENT_FRAMEWORK_HEADER],
  );
  if (agentFrameworkHeader) {
    const parts = agentFrameworkHeader.split("/");
    return {
      framework: parts[0].trim(),
      version: parts[1]?.trim(),
    };
  }

  // Check User-Agent
  if (request.userAgent) {
    for (const { pattern, framework } of KNOWN_AGENT_USER_AGENTS) {
      if (pattern.test(request.userAgent)) {
        const versionMatch = request.userAgent.match(
          new RegExp(`${framework}[/\\s]?(\\d+\\.\\d+(?:\\.\\d+)?)`, "i"),
        );
        return {
          framework,
          version: versionMatch?.[1],
        };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Normalize a header value to a string (handles string | string[] | undefined).
 */
function normalizeHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Create a RequestInfo from common HTTP request properties.
 * Helper for framework adapters (Express, Hono, etc.).
 *
 * @param opts - Raw request properties
 * @returns Normalized RequestInfo
 */
export function createRequestInfo(opts: {
  userAgent?: string;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  method: string;
  path: string;
  timestamp?: number;
}): RequestInfo {
  // Normalize header keys to lowercase
  const normalizedHeaders: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(opts.headers)) {
    normalizedHeaders[key.toLowerCase()] = value;
  }

  return {
    userAgent: opts.userAgent ?? normalizeHeader(normalizedHeaders["user-agent"]),
    headers: normalizedHeaders,
    ip: opts.ip,
    method: opts.method.toUpperCase(),
    path: opts.path,
    timestamp: opts.timestamp ?? Date.now(),
  };
}
