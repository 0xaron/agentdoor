/**
 * Individual signal detectors for agent traffic identification.
 *
 * Each detector analyzes a specific aspect of an HTTP request and returns a
 * `SignalResult` with a confidence score between 0 and 1, where 1 means
 * "definitely an agent" and 0 means "definitely not an agent."
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SignalResult {
  /** Name of the signal that fired. */
  signal: string;

  /** Confidence that this request is from an agent (0.0 – 1.0). */
  confidence: number;

  /** Human-readable explanation of why this signal fired. */
  reason: string;

  /** Additional structured data (e.g. matched framework name). */
  data?: Record<string, string>;
}

/**
 * Normalized representation of an inbound HTTP request. Adapters (Express,
 * Hono, etc.) convert their native request objects into this shape before
 * passing to signal detectors.
 */
export interface DetectableRequest {
  /** All request headers as lowercase-key -> value. */
  headers: Record<string, string | undefined>;

  /** The User-Agent string (shorthand for headers["user-agent"]). */
  userAgent?: string;

  /** Remote IP address. */
  ip?: string;

  /** HTTP method (GET, POST, etc.). */
  method?: string;

  /** Request path / URL. */
  path?: string;
}

// ---------------------------------------------------------------------------
// Known agent framework user-agent patterns
// ---------------------------------------------------------------------------

interface FrameworkPattern {
  /** Regex that matches the User-Agent string. */
  pattern: RegExp;

  /** Human-readable framework name. */
  name: string;

  /** Confidence when this pattern matches. */
  confidence: number;
}

const FRAMEWORK_PATTERNS: FrameworkPattern[] = [
  // AI / Agent frameworks
  { pattern: /langchain/i, name: "LangChain", confidence: 0.95 },
  { pattern: /langgraph/i, name: "LangGraph", confidence: 0.95 },
  { pattern: /crewai/i, name: "CrewAI", confidence: 0.95 },
  { pattern: /autogen/i, name: "AutoGen", confidence: 0.95 },
  { pattern: /openclaw/i, name: "OpenClaw", confidence: 0.95 },
  { pattern: /openai-agents/i, name: "OpenAI Agents SDK", confidence: 0.90 },
  { pattern: /llamaindex/i, name: "LlamaIndex", confidence: 0.90 },
  { pattern: /haystack/i, name: "Haystack", confidence: 0.85 },
  { pattern: /semantic[_-]?kernel/i, name: "Semantic Kernel", confidence: 0.90 },
  { pattern: /dspy/i, name: "DSPy", confidence: 0.85 },
  { pattern: /agentdoor/i, name: "AgentDoor SDK", confidence: 1.0 },
  { pattern: /browser[_-]?use/i, name: "browser-use", confidence: 0.90 },

  // HTTP libraries commonly used by agents/scripts
  { pattern: /python-requests\//i, name: "python-requests", confidence: 0.70 },
  { pattern: /python-httpx\//i, name: "python-httpx", confidence: 0.70 },
  { pattern: /aiohttp\//i, name: "aiohttp", confidence: 0.70 },
  { pattern: /httplib2\//i, name: "httplib2", confidence: 0.65 },
  { pattern: /urllib3?\//i, name: "urllib", confidence: 0.65 },
  { pattern: /node-fetch\//i, name: "node-fetch", confidence: 0.50 },
  { pattern: /undici\//i, name: "undici", confidence: 0.45 },
  { pattern: /axios\//i, name: "axios", confidence: 0.40 },
  { pattern: /got\//i, name: "got", confidence: 0.40 },

  // Bot / Crawler identifiers
  { pattern: /bot\b/i, name: "Generic Bot", confidence: 0.60 },
  { pattern: /crawler/i, name: "Crawler", confidence: 0.60 },
  { pattern: /spider/i, name: "Spider", confidence: 0.55 },
  { pattern: /scrapy/i, name: "Scrapy", confidence: 0.80 },
  { pattern: /headless[_-]?chrome/i, name: "Headless Chrome", confidence: 0.75 },
  { pattern: /puppeteer/i, name: "Puppeteer", confidence: 0.80 },
  { pattern: /playwright/i, name: "Playwright", confidence: 0.80 },
  { pattern: /selenium/i, name: "Selenium", confidence: 0.75 },

  // Cloud function / serverless runtimes
  { pattern: /CloudFlare-Workers/i, name: "Cloudflare Workers", confidence: 0.30 },
  { pattern: /Vercel\/Edge/i, name: "Vercel Edge", confidence: 0.30 },
];

/**
 * Analyze the User-Agent string for known agent frameworks and HTTP libraries.
 */
export function analyzeUserAgent(request: DetectableRequest): SignalResult {
  const ua = request.userAgent ?? request.headers["user-agent"] ?? "";

  if (!ua || ua.trim() === "") {
    return {
      signal: "user-agent:missing",
      confidence: 0.5,
      reason: "No User-Agent header — unusual for browsers, common for scripts",
    };
  }

  for (const fp of FRAMEWORK_PATTERNS) {
    const match = fp.pattern.exec(ua);
    if (match) {
      return {
        signal: "user-agent:framework",
        confidence: fp.confidence,
        reason: `User-Agent matches known agent framework: ${fp.name}`,
        data: { framework: fp.name, matched: match[0] },
      };
    }
  }

  return {
    signal: "user-agent:unknown",
    confidence: 0,
    reason: "User-Agent does not match any known agent patterns",
  };
}

// ---------------------------------------------------------------------------
// Header pattern analysis
// ---------------------------------------------------------------------------

/** Headers that real browsers almost always send. */
const BROWSER_HEADERS = [
  "accept-language",
  "accept-encoding",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-dest",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
] as const;

/** Headers whose absence is a signal (but not as strong as BROWSER_HEADERS). */
const SOFT_BROWSER_HEADERS = [
  "referer",
  "cookie",
] as const;

/**
 * Analyze request headers for patterns that distinguish browsers from agents.
 * Browsers send many standard headers (Accept-Language, Cookie, Referer,
 * Sec-* headers) that scripts and agents typically omit.
 */
export function analyzeHeaderPatterns(request: DetectableRequest): SignalResult {
  const headers = request.headers;

  let missingRequired = 0;
  const missingNames: string[] = [];

  for (const h of BROWSER_HEADERS) {
    if (!headers[h]) {
      missingRequired++;
      missingNames.push(h);
    }
  }

  let missingSoft = 0;
  for (const h of SOFT_BROWSER_HEADERS) {
    if (!headers[h]) {
      missingSoft++;
      missingNames.push(h);
    }
  }

  const totalChecked = BROWSER_HEADERS.length + SOFT_BROWSER_HEADERS.length;
  const totalMissing = missingRequired + missingSoft;

  // Weight: missing required headers matters more.
  const requiredWeight = missingRequired / BROWSER_HEADERS.length;
  const softWeight = (missingSoft / SOFT_BROWSER_HEADERS.length) * 0.3;
  const confidence = Math.min(requiredWeight + softWeight, 1.0);

  if (totalMissing === 0) {
    return {
      signal: "headers:browser-like",
      confidence: 0,
      reason: "All expected browser headers present",
    };
  }

  return {
    signal: "headers:missing-browser",
    confidence: parseFloat(confidence.toFixed(3)),
    reason: `Missing ${totalMissing}/${totalChecked} browser headers: ${missingNames.join(", ")}`,
    data: {
      missing_count: String(totalMissing),
      missing_headers: missingNames.join(","),
    },
  };
}

// ---------------------------------------------------------------------------
// IP range checking (cloud providers)
// ---------------------------------------------------------------------------

/**
 * Known cloud provider IP CIDR ranges. This is a simplified subset — in
 * production you would load from a regularly-updated source or use a
 * GeoIP / ASN database.
 */
interface CloudProvider {
  name: string;
  /** IPv4 CIDR prefixes. */
  prefixes: string[];
}

const CLOUD_PROVIDERS: CloudProvider[] = [
  {
    name: "AWS",
    prefixes: [
      "3.0.", "3.1.", "3.2.", "3.5.", "3.6.", "3.8.",
      "13.52.", "13.54.", "13.56.", "13.57.", "13.58.", "13.59.",
      "18.130.", "18.144.", "18.188.", "18.191.", "18.204.", "18.205.",
      "34.192.", "34.193.", "34.194.", "34.195.", "34.196.",
      "35.153.", "35.154.", "35.155.", "35.156.",
      "44.192.", "44.193.", "44.194.",
      "52.0.", "52.1.", "52.2.", "52.3.", "52.4.", "52.5.",
      "54.0.", "54.1.", "54.2.", "54.64.", "54.65.",
    ],
  },
  {
    name: "Google Cloud",
    prefixes: [
      "34.64.", "34.65.", "34.66.", "34.67.", "34.68.",
      "34.80.", "34.81.", "34.82.", "34.83.", "34.84.",
      "35.184.", "35.185.", "35.186.", "35.187.", "35.188.", "35.189.",
      "35.190.", "35.191.", "35.192.", "35.193.", "35.194.",
      "35.196.", "35.197.", "35.198.", "35.199.",
      "35.200.", "35.201.", "35.202.", "35.203.", "35.204.",
    ],
  },
  {
    name: "Azure",
    prefixes: [
      "13.64.", "13.65.", "13.66.", "13.67.", "13.68.", "13.69.",
      "13.70.", "13.71.", "13.72.", "13.73.", "13.74.", "13.75.",
      "20.36.", "20.37.", "20.38.", "20.39.", "20.40.", "20.41.",
      "20.42.", "20.43.", "20.44.", "20.45.", "20.46.", "20.47.",
      "40.64.", "40.65.", "40.66.", "40.67.", "40.68.", "40.69.",
      "40.70.", "40.71.", "40.74.", "40.75.", "40.76.", "40.77.",
    ],
  },
  {
    name: "DigitalOcean",
    prefixes: [
      "134.122.", "134.209.",
      "137.184.",
      "138.68.", "138.197.",
      "139.59.",
      "142.93.",
      "143.110.", "143.198.",
      "144.126.",
      "146.190.",
      "147.182.",
      "157.230.",
      "159.65.", "159.89.",
      "161.35.",
      "162.243.",
      "164.90.", "164.92.",
      "165.22.", "165.227.",
      "167.71.", "167.172.",
      "170.64.",
      "174.138.",
      "178.128.", "178.62.",
    ],
  },
  {
    name: "Hetzner",
    prefixes: [
      "49.12.", "49.13.",
      "65.108.", "65.109.",
      "78.46.", "78.47.",
      "88.198.", "88.99.",
      "95.216.", "95.217.",
      "116.202.", "116.203.",
      "128.140.",
      "135.181.",
      "136.243.",
      "142.132.",
      "148.251.",
      "157.90.",
      "159.69.",
      "162.55.",
      "167.233.", "167.235.",
      "168.119.",
      "176.9.",
      "178.63.",
      "188.34.", "188.40.",
      "195.201.",
    ],
  },
  {
    name: "Fly.io",
    prefixes: ["66.241.", "137.66.", "149.248.", "213.188."],
  },
  {
    name: "Railway",
    prefixes: ["35.223.", "34.67.", "35.226."],
  },
  {
    name: "Render",
    prefixes: ["216.24."],
  },
];

/**
 * Check if the request IP belongs to a known cloud provider.
 * Agents typically run on cloud infrastructure, not consumer ISPs.
 */
export function analyzeIpRange(request: DetectableRequest): SignalResult {
  const ip = request.ip;

  if (!ip) {
    return {
      signal: "ip:unknown",
      confidence: 0,
      reason: "No IP address available for analysis",
    };
  }

  for (const provider of CLOUD_PROVIDERS) {
    for (const prefix of provider.prefixes) {
      if (ip.startsWith(prefix)) {
        return {
          signal: "ip:cloud-provider",
          confidence: 0.4,
          reason: `IP ${ip} belongs to ${provider.name} cloud infrastructure`,
          data: { provider: provider.name, ip },
        };
      }
    }
  }

  // Check for common localhost / internal IPs (local dev, not a strong signal).
  if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) {
    return {
      signal: "ip:local",
      confidence: 0,
      reason: "Local/internal IP address — not indicative of agent",
    };
  }

  return {
    signal: "ip:consumer",
    confidence: 0,
    reason: "IP does not match known cloud provider ranges",
  };
}

// ---------------------------------------------------------------------------
// Behavioral pattern detection
// ---------------------------------------------------------------------------

/**
 * Analyze behavioral patterns in the request that distinguish agents from
 * human browsers.
 */
export function analyzeBehavioralPatterns(request: DetectableRequest): SignalResult {
  const headers = request.headers;
  let score = 0;
  const reasons: string[] = [];

  // No session cookies — agents typically don't send cookies.
  if (!headers["cookie"]) {
    score += 0.15;
    reasons.push("no cookies");
  }

  // Accept header set to application/json only (API-only traffic).
  const accept = headers["accept"] ?? "";
  if (accept === "application/json" || accept === "*/*") {
    score += 0.1;
    reasons.push(`Accept: ${accept} (API-style)`);
  }

  // No Referer — agents don't navigate from pages.
  if (!headers["referer"]) {
    score += 0.05;
    reasons.push("no referer");
  }

  // Custom headers that hint at programmatic access.
  if (headers["x-request-id"] || headers["x-correlation-id"] || headers["x-trace-id"]) {
    score += 0.1;
    reasons.push("programmatic tracing headers present");
  }

  // Connection: keep-alive without other browser indicators can suggest scripts.
  const connection = headers["connection"]?.toLowerCase();
  if (connection === "close") {
    score += 0.05;
    reasons.push("Connection: close (uncommon for browsers)");
  }

  // No DNT or GPC headers (privacy headers browsers often include).
  if (!headers["dnt"] && !headers["sec-gpc"]) {
    score += 0.03;
    reasons.push("no privacy headers (DNT/GPC)");
  }

  if (reasons.length === 0) {
    return {
      signal: "behavior:browser-like",
      confidence: 0,
      reason: "Behavioral patterns consistent with a browser",
    };
  }

  return {
    signal: "behavior:agent-like",
    confidence: parseFloat(Math.min(score, 1.0).toFixed(3)),
    reason: `Agent-like behavioral patterns: ${reasons.join("; ")}`,
    data: { patterns: reasons.join(", ") },
  };
}

// ---------------------------------------------------------------------------
// Self-identification (X-Agent-Framework header)
// ---------------------------------------------------------------------------

/**
 * Check if the request explicitly self-identifies as an agent via the
 * emerging `X-Agent-Framework` header convention.
 */
export function analyzeSelfIdentification(request: DetectableRequest): SignalResult {
  const agentHeader = request.headers["x-agent-framework"];

  if (agentHeader) {
    return {
      signal: "self-id:x-agent-framework",
      confidence: 1.0,
      reason: `Agent self-identified via X-Agent-Framework: ${agentHeader}`,
      data: { framework: agentHeader },
    };
  }

  // Check for AgentDoor-specific headers.
  const agentDoorId = request.headers["x-agentdoor-agent-id"];
  if (agentDoorId) {
    return {
      signal: "self-id:agentdoor",
      confidence: 1.0,
      reason: `Agent self-identified via X-AgentDoor-Agent-Id: ${agentDoorId}`,
      data: { agentId: agentDoorId },
    };
  }

  // Check for generic bot identification headers.
  const botHeader = request.headers["x-bot"] ?? request.headers["x-robot"];
  if (botHeader) {
    return {
      signal: "self-id:x-bot",
      confidence: 0.9,
      reason: `Bot self-identified via X-Bot/X-Robot header: ${botHeader}`,
      data: { bot: botHeader },
    };
  }

  return {
    signal: "self-id:none",
    confidence: 0,
    reason: "No self-identification headers found",
  };
}

// ---------------------------------------------------------------------------
// Run all signals
// ---------------------------------------------------------------------------

/**
 * Run all signal detectors against a request and return the array of results.
 */
export function analyzeAllSignals(request: DetectableRequest): SignalResult[] {
  return [
    analyzeUserAgent(request),
    analyzeHeaderPatterns(request),
    analyzeIpRange(request),
    analyzeBehavioralPatterns(request),
    analyzeSelfIdentification(request),
  ];
}
