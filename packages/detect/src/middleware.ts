/**
 * Generic middleware for detect-only mode. Works with Express, Hono, and
 * any framework that follows the (req, res, next) or (c, next) pattern.
 *
 * Classifies incoming requests as agent or human and optionally sends
 * classification results to a webhook URL.
 */

import type { DetectableRequest } from "./signals.js";
import type { ClassificationResult, ClassifierConfig } from "./fingerprint.js";
import { classifyRequest } from "./fingerprint.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DetectMiddlewareConfig extends ClassifierConfig {
  /**
   * Webhook URL to POST classification results to. If provided, every
   * classified-as-agent request triggers a webhook notification.
   */
  webhook?: string;

  /**
   * Only send webhook for requests classified as agents.
   * Defaults to `true`.
   */
  webhookAgentsOnly?: boolean;

  /**
   * Custom headers to include in webhook POST requests.
   */
  webhookHeaders?: Record<string, string>;

  /**
   * Path prefixes to apply detection to. Defaults to all paths.
   * Set to e.g. ["/api"] to only classify API traffic.
   */
  paths?: string[];

  /**
   * Path prefixes to exclude from detection. Health checks,
   * static assets, etc. Defaults to common static paths.
   */
  excludePaths?: string[];

  /**
   * Callback invoked with every classification result. Useful for
   * custom logging, metrics, or real-time dashboards.
   */
  onClassified?: (result: ClassificationResult, request: DetectableRequest) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Webhook sender
// ---------------------------------------------------------------------------

async function sendWebhook(
  url: string,
  result: ClassificationResult,
  request: DetectableRequest,
  headers?: Record<string, string>,
): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "AgentGate-Detect/0.1.0",
        ...headers,
      },
      body: JSON.stringify({
        event: "agent.detected",
        timestamp: result.classifiedAt,
        classification: {
          is_agent: result.isAgent,
          confidence: result.confidence,
          framework: result.framework ?? null,
          signals: result.signals.map((s) => ({
            signal: s.signal,
            confidence: s.confidence,
            reason: s.reason,
          })),
        },
        request: {
          method: request.method ?? "GET",
          path: request.path ?? "/",
          user_agent: request.userAgent ?? null,
          ip: request.ip ?? null,
        },
      }),
      // Non-blocking: don't wait more than 5 seconds.
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Webhook failures are non-fatal — detection should not block requests.
  }
}

// ---------------------------------------------------------------------------
// Default exclusions
// ---------------------------------------------------------------------------

const DEFAULT_EXCLUDE_PATHS = [
  "/_next/",
  "/static/",
  "/assets/",
  "/favicon",
  "/robots.txt",
  "/sitemap",
  "/.well-known/",
  "/health",
  "/ready",
];

// ---------------------------------------------------------------------------
// Express-compatible middleware
// ---------------------------------------------------------------------------

/**
 * Minimal Express-like request shape.
 */
interface ExpressLikeRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  method?: string;
  path?: string;
  url?: string;
  get?(name: string): string | undefined;
}

/**
 * Minimal Express-like response shape.
 */
interface ExpressLikeResponse {
  setHeader?(name: string, value: string): void;
  set?(name: string, value: string): void;
}

/**
 * Create Express-compatible middleware for detect-only mode.
 *
 * @example
 * ```ts
 * import express from "express";
 * import { detect } from "@agentgate/detect";
 *
 * const app = express();
 *
 * app.use(detect({
 *   webhook: "https://hooks.yoursite.com/agent-traffic",
 *   threshold: 0.5,
 * }));
 *
 * app.get("/api/data", (req, res) => {
 *   // Detection results available on headers:
 *   // x-agentgate-is-agent: "true"
 *   // x-agentgate-confidence: "0.82"
 *   // x-agentgate-framework: "LangChain"
 *   res.json({ data: "hello" });
 * });
 * ```
 */
export function detect(
  config?: DetectMiddlewareConfig,
): (req: ExpressLikeRequest, res: ExpressLikeResponse, next: () => void) => void {
  const paths = config?.paths;
  const excludePaths = config?.excludePaths ?? DEFAULT_EXCLUDE_PATHS;
  const webhookAgentsOnly = config?.webhookAgentsOnly ?? true;

  return (req, res, next) => {
    const requestPath = req.path ?? req.url ?? "/";

    // Check exclusions.
    if (excludePaths.some((p) => requestPath.startsWith(p))) {
      next();
      return;
    }

    // Check inclusions.
    if (paths && !paths.some((p) => requestPath.startsWith(p))) {
      next();
      return;
    }

    // Normalize request for the classifier.
    const normalized = normalizeExpressRequest(req);

    // Classify.
    const result = classifyRequest(normalized, config);

    // Set response headers with classification info.
    const setHeader = res.setHeader?.bind(res) ?? res.set?.bind(res);
    if (setHeader) {
      setHeader("x-agentgate-is-agent", String(result.isAgent));
      setHeader("x-agentgate-confidence", String(result.confidence));
      if (result.framework) {
        setHeader("x-agentgate-framework", result.framework);
      }
    }

    // Webhook (fire-and-forget).
    if (config?.webhook) {
      if (!webhookAgentsOnly || result.isAgent) {
        sendWebhook(config.webhook, result, normalized, config.webhookHeaders);
      }
    }

    // Callback.
    if (config?.onClassified) {
      try {
        const callbackResult = config.onClassified(result, normalized);
        if (callbackResult && typeof (callbackResult as Promise<void>).catch === "function") {
          (callbackResult as Promise<void>).catch(() => {});
        }
      } catch {
        // Non-fatal.
      }
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Generic / fetch-based middleware (Hono, Cloudflare Workers, etc.)
// ---------------------------------------------------------------------------

/**
 * Create a generic detection handler suitable for Hono middleware,
 * Cloudflare Workers, Deno serve, or any fetch-based runtime.
 *
 * Returns a function that accepts a Request and returns a ClassificationResult.
 *
 * @example Hono
 * ```ts
 * import { Hono } from "hono";
 * import { createDetector } from "@agentgate/detect";
 *
 * const app = new Hono();
 * const detector = createDetector({ threshold: 0.5 });
 *
 * app.use("*", async (c, next) => {
 *   const result = detector(c.req.raw);
 *   c.set("detection", result);
 *   c.header("x-agentgate-is-agent", String(result.isAgent));
 *   await next();
 * });
 * ```
 */
export function createDetector(
  config?: DetectMiddlewareConfig,
): (request: Request) => ClassificationResult {
  return (request: Request) => {
    const normalized = normalizeFetchRequest(request);
    return classifyRequest(normalized, config);
  };
}

/**
 * Create a Hono-compatible middleware handler for detect-only mode.
 *
 * @example
 * ```ts
 * import { Hono } from "hono";
 * import { detectMiddleware } from "@agentgate/detect";
 *
 * const app = new Hono();
 * app.use("*", detectMiddleware({
 *   webhook: "https://hooks.yoursite.com/agent-traffic",
 * }));
 * ```
 */
export function detectMiddleware(
  config?: DetectMiddlewareConfig,
): (c: { req: { raw: Request; url: string }; header: (name: string, value: string) => void }, next: () => Promise<void>) => Promise<void> {
  const paths = config?.paths;
  const excludePaths = config?.excludePaths ?? DEFAULT_EXCLUDE_PATHS;
  const webhookAgentsOnly = config?.webhookAgentsOnly ?? true;

  return async (c, next) => {
    const url = new URL(c.req.url);
    const pathname = url.pathname;

    // Exclusions.
    if (excludePaths.some((p) => pathname.startsWith(p))) {
      await next();
      return;
    }

    // Inclusions.
    if (paths && !paths.some((p) => pathname.startsWith(p))) {
      await next();
      return;
    }

    const normalized = normalizeFetchRequest(c.req.raw);
    const result = classifyRequest(normalized, config);

    c.header("x-agentgate-is-agent", String(result.isAgent));
    c.header("x-agentgate-confidence", String(result.confidence));
    if (result.framework) {
      c.header("x-agentgate-framework", result.framework);
    }

    // Webhook.
    if (config?.webhook) {
      if (!webhookAgentsOnly || result.isAgent) {
        sendWebhook(config.webhook, result, normalized, config.webhookHeaders);
      }
    }

    // Callback.
    if (config?.onClassified) {
      try {
        await config.onClassified(result, normalized);
      } catch {
        // Non-fatal.
      }
    }

    await next();
  };
}

// ---------------------------------------------------------------------------
// Request normalizers
// ---------------------------------------------------------------------------

function normalizeExpressRequest(req: ExpressLikeRequest): DetectableRequest {
  const headers: Record<string, string | undefined> = {};

  // Express stores headers as lowercased keys.
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") {
      headers[key.toLowerCase()] = value;
    } else if (Array.isArray(value)) {
      headers[key.toLowerCase()] = value.join(", ");
    }
  }

  const userAgent = headers["user-agent"];

  // Attempt to get real IP from common proxy headers.
  const ip =
    headers["x-forwarded-for"]?.split(",")[0]?.trim() ??
    headers["x-real-ip"] ??
    req.ip;

  return {
    headers,
    userAgent,
    ip,
    method: req.method,
    path: req.path ?? req.url,
  };
}

function normalizeFetchRequest(request: Request): DetectableRequest {
  const headers: Record<string, string | undefined> = {};

  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const userAgent = headers["user-agent"];
  const ip =
    headers["x-forwarded-for"]?.split(",")[0]?.trim() ??
    headers["x-real-ip"] ??
    headers["cf-connecting-ip"]; // Cloudflare

  const url = new URL(request.url);

  return {
    headers,
    userAgent,
    ip,
    method: request.method,
    path: url.pathname,
  };
}
