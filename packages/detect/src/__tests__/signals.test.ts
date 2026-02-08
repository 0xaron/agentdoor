import { describe, it, expect } from "vitest";
import {
  analyzeUserAgent,
  analyzeHeaderPatterns,
  analyzeIpRange,
  analyzeBehavioralPatterns,
  analyzeSelfIdentification,
  analyzeAllSignals,
} from "../signals.js";
import type { DetectableRequest } from "../signals.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal DetectableRequest with overrides. */
function req(overrides: Partial<DetectableRequest> = {}): DetectableRequest {
  return {
    headers: {},
    ...overrides,
  };
}

/** All standard browser headers present. */
const FULL_BROWSER_HEADERS: Record<string, string> = {
  "accept-language": "en-US,en;q=0.9",
  "accept-encoding": "gzip, deflate, br",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-dest": "document",
  "sec-ch-ua": '"Chromium";v="120"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  referer: "https://example.com/",
  cookie: "session=abc123",
};

// =========================================================================
// analyzeUserAgent
// =========================================================================

describe("analyzeUserAgent", () => {
  // --- AI / Agent frameworks ------------------------------------------------

  it("detects LangChain with confidence 0.95", () => {
    const result = analyzeUserAgent(req({ userAgent: "langchain/1.0" }));
    expect(result.signal).toBe("user-agent:framework");
    expect(result.confidence).toBe(0.95);
    expect(result.data?.framework).toBe("LangChain");
  });

  it("detects LangGraph with confidence 0.95", () => {
    const result = analyzeUserAgent(req({ userAgent: "LangGraph/0.2.0" }));
    expect(result.confidence).toBe(0.95);
    expect(result.data?.framework).toBe("LangGraph");
  });

  it("detects CrewAI with confidence 0.95", () => {
    const result = analyzeUserAgent(req({ userAgent: "CrewAI/1.2" }));
    expect(result.confidence).toBe(0.95);
    expect(result.data?.framework).toBe("CrewAI");
  });

  it("detects AutoGen with confidence 0.95", () => {
    const result = analyzeUserAgent(req({ userAgent: "AutoGen/0.5" }));
    expect(result.confidence).toBe(0.95);
    expect(result.data?.framework).toBe("AutoGen");
  });

  it("detects OpenAI Agents SDK with confidence 0.90", () => {
    const result = analyzeUserAgent(req({ userAgent: "openai-agents/1.0" }));
    expect(result.confidence).toBe(0.90);
    expect(result.data?.framework).toBe("OpenAI Agents SDK");
  });

  it("detects LlamaIndex with confidence 0.90", () => {
    const result = analyzeUserAgent(req({ userAgent: "LlamaIndex/0.9" }));
    expect(result.confidence).toBe(0.90);
    expect(result.data?.framework).toBe("LlamaIndex");
  });

  it("detects Haystack with confidence 0.85", () => {
    const result = analyzeUserAgent(req({ userAgent: "haystack/2.0" }));
    expect(result.confidence).toBe(0.85);
    expect(result.data?.framework).toBe("Haystack");
  });

  it("detects Semantic Kernel with confidence 0.90", () => {
    const result = analyzeUserAgent(req({ userAgent: "semantic-kernel/1.0" }));
    expect(result.confidence).toBe(0.90);
    expect(result.data?.framework).toBe("Semantic Kernel");
  });

  it("detects DSPy with confidence 0.85", () => {
    const result = analyzeUserAgent(req({ userAgent: "dspy/2.4" }));
    expect(result.confidence).toBe(0.85);
    expect(result.data?.framework).toBe("DSPy");
  });

  it("detects AgentGate SDK with confidence 1.0", () => {
    const result = analyzeUserAgent(req({ userAgent: "AgentGate-SDK/0.1.0" }));
    expect(result.signal).toBe("user-agent:framework");
    expect(result.confidence).toBe(1.0);
    expect(result.data?.framework).toBe("AgentGate SDK");
  });

  it("detects browser-use with confidence 0.90", () => {
    const result = analyzeUserAgent(req({ userAgent: "browser-use/1.0" }));
    expect(result.confidence).toBe(0.90);
    expect(result.data?.framework).toBe("browser-use");
  });

  // --- HTTP libraries -------------------------------------------------------

  it("detects python-requests with confidence 0.70", () => {
    const result = analyzeUserAgent(
      req({ userAgent: "python-requests/2.31.0" }),
    );
    expect(result.signal).toBe("user-agent:framework");
    expect(result.confidence).toBe(0.70);
    expect(result.data?.framework).toBe("python-requests");
  });

  it("detects python-httpx with confidence 0.70", () => {
    const result = analyzeUserAgent(req({ userAgent: "python-httpx/0.24.0" }));
    expect(result.confidence).toBe(0.70);
    expect(result.data?.framework).toBe("python-httpx");
  });

  it("detects aiohttp with confidence 0.70", () => {
    const result = analyzeUserAgent(req({ userAgent: "aiohttp/3.9.1" }));
    expect(result.confidence).toBe(0.70);
    expect(result.data?.framework).toBe("aiohttp");
  });

  it("detects httplib2 with confidence 0.65", () => {
    const result = analyzeUserAgent(req({ userAgent: "httplib2/0.22" }));
    expect(result.confidence).toBe(0.65);
    expect(result.data?.framework).toBe("httplib2");
  });

  it("detects urllib with confidence 0.65", () => {
    const result = analyzeUserAgent(req({ userAgent: "urllib3/2.0" }));
    expect(result.confidence).toBe(0.65);
    expect(result.data?.framework).toBe("urllib");
  });

  it("detects node-fetch with confidence 0.50", () => {
    const result = analyzeUserAgent(req({ userAgent: "node-fetch/3.0" }));
    expect(result.confidence).toBe(0.50);
    expect(result.data?.framework).toBe("node-fetch");
  });

  it("detects undici with confidence 0.45", () => {
    const result = analyzeUserAgent(req({ userAgent: "undici/5.0" }));
    expect(result.confidence).toBe(0.45);
    expect(result.data?.framework).toBe("undici");
  });

  it("detects axios with confidence 0.40", () => {
    const result = analyzeUserAgent(req({ userAgent: "axios/1.6.0" }));
    expect(result.confidence).toBe(0.40);
    expect(result.data?.framework).toBe("axios");
  });

  it("detects got with confidence 0.40", () => {
    const result = analyzeUserAgent(req({ userAgent: "got/14.0" }));
    expect(result.confidence).toBe(0.40);
    expect(result.data?.framework).toBe("got");
  });

  // --- Bot / Crawler --------------------------------------------------------

  it("detects generic bot UA with confidence 0.60", () => {
    const result = analyzeUserAgent(req({ userAgent: "Googlebot/2.1" }));
    expect(result.signal).toBe("user-agent:framework");
    expect(result.confidence).toBe(0.60);
    expect(result.data?.framework).toBe("Generic Bot");
  });

  it("detects crawler UA with confidence 0.60", () => {
    const result = analyzeUserAgent(
      req({ userAgent: "MyCrawler/1.0" }),
    );
    expect(result.confidence).toBe(0.60);
    expect(result.data?.framework).toBe("Crawler");
  });

  it("detects spider UA with confidence 0.55", () => {
    const result = analyzeUserAgent(
      req({ userAgent: "SuperSpider/1.0" }),
    );
    expect(result.confidence).toBe(0.55);
    expect(result.data?.framework).toBe("Spider");
  });

  it("detects Scrapy with confidence 0.80", () => {
    const result = analyzeUserAgent(req({ userAgent: "Scrapy/2.11" }));
    expect(result.confidence).toBe(0.80);
    expect(result.data?.framework).toBe("Scrapy");
  });

  it("detects Headless Chrome with confidence 0.75", () => {
    const result = analyzeUserAgent(
      req({ userAgent: "HeadlessChrome/120.0" }),
    );
    expect(result.confidence).toBe(0.75);
    expect(result.data?.framework).toBe("Headless Chrome");
  });

  it("detects Puppeteer with confidence 0.80", () => {
    const result = analyzeUserAgent(req({ userAgent: "Puppeteer/21.0" }));
    expect(result.confidence).toBe(0.80);
    expect(result.data?.framework).toBe("Puppeteer");
  });

  it("detects Playwright with confidence 0.80", () => {
    const result = analyzeUserAgent(req({ userAgent: "Playwright/1.40" }));
    expect(result.confidence).toBe(0.80);
    expect(result.data?.framework).toBe("Playwright");
  });

  it("detects Selenium with confidence 0.75", () => {
    const result = analyzeUserAgent(req({ userAgent: "Selenium/4.16" }));
    expect(result.confidence).toBe(0.75);
    expect(result.data?.framework).toBe("Selenium");
  });

  // --- Cloud / serverless ---------------------------------------------------

  it("detects Cloudflare Workers with confidence 0.30", () => {
    const result = analyzeUserAgent(
      req({ userAgent: "CloudFlare-Workers" }),
    );
    expect(result.confidence).toBe(0.30);
    expect(result.data?.framework).toBe("Cloudflare Workers");
  });

  it("detects Vercel Edge with confidence 0.30", () => {
    const result = analyzeUserAgent(req({ userAgent: "Vercel/Edge" }));
    expect(result.confidence).toBe(0.30);
    expect(result.data?.framework).toBe("Vercel Edge");
  });

  // --- Missing or unknown ---------------------------------------------------

  it("returns confidence 0.5 for missing user-agent", () => {
    const result = analyzeUserAgent(req({ headers: {} }));
    expect(result.signal).toBe("user-agent:missing");
    expect(result.confidence).toBe(0.5);
    expect(result.reason).toContain("No User-Agent");
  });

  it("returns confidence 0.5 for empty string user-agent", () => {
    const result = analyzeUserAgent(req({ userAgent: "" }));
    expect(result.signal).toBe("user-agent:missing");
    expect(result.confidence).toBe(0.5);
  });

  it("returns confidence 0.5 for whitespace-only user-agent", () => {
    const result = analyzeUserAgent(req({ userAgent: "   " }));
    expect(result.signal).toBe("user-agent:missing");
    expect(result.confidence).toBe(0.5);
  });

  it("returns confidence 0 for a normal browser user-agent", () => {
    const result = analyzeUserAgent(
      req({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      }),
    );
    expect(result.signal).toBe("user-agent:unknown");
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain("does not match");
  });

  it("falls back to headers[user-agent] when userAgent field is undefined", () => {
    const result = analyzeUserAgent(
      req({
        headers: { "user-agent": "python-requests/2.31.0" },
      }),
    );
    expect(result.signal).toBe("user-agent:framework");
    expect(result.confidence).toBe(0.70);
  });

  it("is case-insensitive for framework matching", () => {
    const result = analyzeUserAgent(req({ userAgent: "LANGCHAIN/2.0" }));
    expect(result.confidence).toBe(0.95);
    expect(result.data?.framework).toBe("LangChain");
  });

  it("returns the matched substring in data.matched", () => {
    const result = analyzeUserAgent(
      req({ userAgent: "my-app python-requests/2.31.0" }),
    );
    expect(result.data?.matched).toBe("python-requests/");
  });
});

// =========================================================================
// analyzeHeaderPatterns
// =========================================================================

describe("analyzeHeaderPatterns", () => {
  it("returns confidence 0 when all browser headers are present", () => {
    const result = analyzeHeaderPatterns(
      req({ headers: { ...FULL_BROWSER_HEADERS } }),
    );
    expect(result.signal).toBe("headers:browser-like");
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain("All expected browser headers present");
  });

  it("returns high confidence when no browser headers are present", () => {
    const result = analyzeHeaderPatterns(req({ headers: {} }));
    expect(result.signal).toBe("headers:missing-browser");
    // All 8 required headers missing (weight 1.0) + 2 soft headers (weight 0.3)
    // = 1.0 + 0.3 = 1.3, capped at 1.0
    expect(result.confidence).toBeGreaterThanOrEqual(1.0);
    expect(result.data?.missing_count).toBe("10");
  });

  it("returns medium confidence when some headers are missing", () => {
    // Provide half of the required browser headers
    const result = analyzeHeaderPatterns(
      req({
        headers: {
          "accept-language": "en-US",
          "accept-encoding": "gzip",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "none",
          // missing: sec-fetch-dest, sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform
          // missing soft: referer, cookie
        },
      }),
    );
    expect(result.signal).toBe("headers:missing-browser");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(1.0);
  });

  it("lists missing header names in data.missing_headers", () => {
    const result = analyzeHeaderPatterns(
      req({
        headers: {
          "accept-language": "en-US",
          "accept-encoding": "gzip",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "none",
          "sec-fetch-dest": "document",
          "sec-ch-ua": '"Chromium"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"macOS"',
          // Only missing the soft headers: referer, cookie
        },
      }),
    );
    expect(result.signal).toBe("headers:missing-browser");
    const missing = result.data?.missing_headers?.split(",") ?? [];
    expect(missing).toContain("referer");
    expect(missing).toContain("cookie");
  });

  it("weights required headers more heavily than soft headers", () => {
    // Only soft headers missing
    const softOnly = analyzeHeaderPatterns(
      req({
        headers: {
          "accept-language": "en-US",
          "accept-encoding": "gzip",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "none",
          "sec-fetch-dest": "document",
          "sec-ch-ua": '"Chromium"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"macOS"',
        },
      }),
    );

    // Only one required header missing
    const oneRequired = analyzeHeaderPatterns(
      req({
        headers: {
          "accept-language": "en-US",
          "accept-encoding": "gzip",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "none",
          "sec-fetch-dest": "document",
          "sec-ch-ua": '"Chromium"',
          "sec-ch-ua-mobile": "?0",
          // Missing: sec-ch-ua-platform (1 required)
          referer: "https://example.com",
          cookie: "session=abc",
        },
      }),
    );

    // Missing 2 soft headers contributes 0.3 weight
    // Missing 1 required header contributes 1/8 = 0.125 weight
    // So soft only should be higher
    expect(softOnly.confidence).toBeGreaterThan(oneRequired.confidence);
  });

  it("confidence is a float with at most 3 decimal places", () => {
    const result = analyzeHeaderPatterns(
      req({
        headers: {
          "accept-language": "en-US",
          cookie: "sid=abc",
        },
      }),
    );
    const decimals = result.confidence.toString().split(".")[1];
    if (decimals) {
      expect(decimals.length).toBeLessThanOrEqual(3);
    }
  });
});

// =========================================================================
// analyzeIpRange
// =========================================================================

describe("analyzeIpRange", () => {
  // --- Cloud providers ------------------------------------------------------

  it("detects AWS IP with confidence 0.4", () => {
    const result = analyzeIpRange(req({ ip: "54.1.2.3" }));
    expect(result.signal).toBe("ip:cloud-provider");
    expect(result.confidence).toBe(0.4);
    expect(result.data?.provider).toBe("AWS");
    expect(result.data?.ip).toBe("54.1.2.3");
  });

  it("detects another AWS prefix (52.0.x.x)", () => {
    const result = analyzeIpRange(req({ ip: "52.0.100.50" }));
    expect(result.signal).toBe("ip:cloud-provider");
    expect(result.confidence).toBe(0.4);
    expect(result.data?.provider).toBe("AWS");
  });

  it("detects Google Cloud IP with confidence 0.4", () => {
    const result = analyzeIpRange(req({ ip: "35.184.1.1" }));
    expect(result.signal).toBe("ip:cloud-provider");
    expect(result.confidence).toBe(0.4);
    expect(result.data?.provider).toBe("Google Cloud");
  });

  it("detects Azure IP with confidence 0.4", () => {
    const result = analyzeIpRange(req({ ip: "13.64.0.1" }));
    expect(result.signal).toBe("ip:cloud-provider");
    expect(result.confidence).toBe(0.4);
    expect(result.data?.provider).toBe("Azure");
  });

  it("detects DigitalOcean IP with confidence 0.4", () => {
    const result = analyzeIpRange(req({ ip: "134.209.10.5" }));
    expect(result.signal).toBe("ip:cloud-provider");
    expect(result.confidence).toBe(0.4);
    expect(result.data?.provider).toBe("DigitalOcean");
  });

  it("detects Hetzner IP with confidence 0.4", () => {
    const result = analyzeIpRange(req({ ip: "49.12.99.1" }));
    expect(result.signal).toBe("ip:cloud-provider");
    expect(result.confidence).toBe(0.4);
    expect(result.data?.provider).toBe("Hetzner");
  });

  it("detects Fly.io IP with confidence 0.4", () => {
    const result = analyzeIpRange(req({ ip: "66.241.100.1" }));
    expect(result.signal).toBe("ip:cloud-provider");
    expect(result.confidence).toBe(0.4);
    expect(result.data?.provider).toBe("Fly.io");
  });

  it("detects Railway IP with confidence 0.4", () => {
    const result = analyzeIpRange(req({ ip: "35.223.50.1" }));
    expect(result.signal).toBe("ip:cloud-provider");
    expect(result.confidence).toBe(0.4);
    expect(result.data?.provider).toBe("Railway");
  });

  it("detects Render IP with confidence 0.4", () => {
    const result = analyzeIpRange(req({ ip: "216.24.1.1" }));
    expect(result.signal).toBe("ip:cloud-provider");
    expect(result.confidence).toBe(0.4);
    expect(result.data?.provider).toBe("Render");
  });

  // --- Local IPs ------------------------------------------------------------

  it("returns confidence 0 for localhost 127.0.0.1", () => {
    const result = analyzeIpRange(req({ ip: "127.0.0.1" }));
    expect(result.signal).toBe("ip:local");
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain("Local");
  });

  it("returns confidence 0 for IPv6 localhost ::1", () => {
    const result = analyzeIpRange(req({ ip: "::1" }));
    expect(result.signal).toBe("ip:local");
    expect(result.confidence).toBe(0);
  });

  it("returns confidence 0 for private 192.168.x.x range", () => {
    const result = analyzeIpRange(req({ ip: "192.168.1.100" }));
    expect(result.signal).toBe("ip:local");
    expect(result.confidence).toBe(0);
  });

  it("returns confidence 0 for private 10.x.x.x range", () => {
    const result = analyzeIpRange(req({ ip: "10.0.0.55" }));
    expect(result.signal).toBe("ip:local");
    expect(result.confidence).toBe(0);
  });

  // --- Consumer / unknown IPs -----------------------------------------------

  it("returns confidence 0 for a consumer IP", () => {
    const result = analyzeIpRange(req({ ip: "73.162.45.123" }));
    expect(result.signal).toBe("ip:consumer");
    expect(result.confidence).toBe(0);
  });

  // --- No IP ----------------------------------------------------------------

  it("returns confidence 0 when no IP is provided", () => {
    const result = analyzeIpRange(req({}));
    expect(result.signal).toBe("ip:unknown");
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain("No IP");
  });

  it("returns confidence 0 when IP is undefined", () => {
    const result = analyzeIpRange(req({ ip: undefined }));
    expect(result.signal).toBe("ip:unknown");
    expect(result.confidence).toBe(0);
  });
});

// =========================================================================
// analyzeBehavioralPatterns
// =========================================================================

describe("analyzeBehavioralPatterns", () => {
  it("detects no cookies as agent-like", () => {
    const result = analyzeBehavioralPatterns(
      req({
        headers: {
          accept: "application/json",
          // no cookie header
        },
      }),
    );
    expect(result.signal).toBe("behavior:agent-like");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.reason).toContain("no cookies");
  });

  it("detects JSON-only accept as agent-like", () => {
    const result = analyzeBehavioralPatterns(
      req({
        headers: {
          accept: "application/json",
          cookie: "sid=abc", // has cookies to isolate accept
          referer: "https://example.com",
          dnt: "1",
        },
      }),
    );
    expect(result.signal).toBe("behavior:agent-like");
    expect(result.reason).toContain("API-style");
  });

  it("detects wildcard accept (*/*) as agent-like", () => {
    const result = analyzeBehavioralPatterns(
      req({
        headers: {
          accept: "*/*",
          cookie: "sid=abc",
          referer: "https://example.com",
          dnt: "1",
        },
      }),
    );
    expect(result.reason).toContain("API-style");
  });

  it("detects missing referer as agent-like", () => {
    const result = analyzeBehavioralPatterns(
      req({
        headers: {
          cookie: "sid=abc",
          dnt: "1",
          // no referer
        },
      }),
    );
    expect(result.reason).toContain("no referer");
  });

  it("detects programmatic tracing headers (x-request-id)", () => {
    const result = analyzeBehavioralPatterns(
      req({
        headers: {
          "x-request-id": "abc-123",
          cookie: "sid=abc",
          referer: "https://example.com",
          dnt: "1",
        },
      }),
    );
    expect(result.signal).toBe("behavior:agent-like");
    expect(result.reason).toContain("programmatic tracing headers");
  });

  it("detects x-correlation-id as tracing header", () => {
    const result = analyzeBehavioralPatterns(
      req({
        headers: {
          "x-correlation-id": "corr-456",
          cookie: "sid=abc",
          referer: "https://example.com",
          dnt: "1",
        },
      }),
    );
    expect(result.reason).toContain("programmatic tracing headers");
  });

  it("detects x-trace-id as tracing header", () => {
    const result = analyzeBehavioralPatterns(
      req({
        headers: {
          "x-trace-id": "trace-789",
          cookie: "sid=abc",
          referer: "https://example.com",
          dnt: "1",
        },
      }),
    );
    expect(result.reason).toContain("programmatic tracing headers");
  });

  it("detects Connection: close as agent-like", () => {
    const result = analyzeBehavioralPatterns(
      req({
        headers: {
          connection: "close",
          cookie: "sid=abc",
          referer: "https://example.com",
          dnt: "1",
        },
      }),
    );
    expect(result.signal).toBe("behavior:agent-like");
    expect(result.reason).toContain("Connection: close");
  });

  it("detects missing privacy headers (DNT/GPC) as agent-like", () => {
    const result = analyzeBehavioralPatterns(
      req({
        headers: {
          cookie: "sid=abc",
          referer: "https://example.com",
          // no dnt, no sec-gpc
        },
      }),
    );
    expect(result.reason).toContain("no privacy headers");
  });

  it("does not flag privacy headers when DNT is present", () => {
    const result = analyzeBehavioralPatterns(
      req({
        headers: {
          cookie: "sid=abc",
          referer: "https://example.com",
          accept: "text/html",
          dnt: "1",
        },
      }),
    );
    expect(result.reason).not.toContain("no privacy headers");
  });

  it("does not flag privacy headers when sec-gpc is present", () => {
    const result = analyzeBehavioralPatterns(
      req({
        headers: {
          cookie: "sid=abc",
          referer: "https://example.com",
          accept: "text/html",
          "sec-gpc": "1",
        },
      }),
    );
    expect(result.reason).not.toContain("no privacy headers");
  });

  it("returns confidence 0 when all browser behaviors are present", () => {
    const result = analyzeBehavioralPatterns(
      req({
        headers: {
          cookie: "session=abc123",
          accept: "text/html,application/xhtml+xml",
          referer: "https://example.com/page",
          dnt: "1",
          connection: "keep-alive",
        },
      }),
    );
    expect(result.signal).toBe("behavior:browser-like");
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain("consistent with a browser");
  });

  it("accumulates multiple agent-like signals", () => {
    const result = analyzeBehavioralPatterns(
      req({
        headers: {
          accept: "application/json",
          "x-request-id": "abc",
          connection: "close",
          // no cookie, no referer, no dnt/gpc
        },
      }),
    );
    expect(result.signal).toBe("behavior:agent-like");
    // 0.15 (no cookies) + 0.1 (json accept) + 0.05 (no referer) +
    // 0.1 (tracing) + 0.05 (connection close) + 0.03 (no privacy) = 0.48
    expect(result.confidence).toBeCloseTo(0.48, 2);
  });

  it("caps confidence at 1.0", () => {
    // Even with all signals firing, confidence should not exceed 1.0
    const result = analyzeBehavioralPatterns(
      req({ headers: {} }),
    );
    expect(result.confidence).toBeLessThanOrEqual(1.0);
  });

  it("returns data.patterns with comma-separated reasons", () => {
    const result = analyzeBehavioralPatterns(
      req({
        headers: {
          accept: "application/json",
          // no cookie, no referer, no dnt/gpc
        },
      }),
    );
    expect(result.data?.patterns).toBeDefined();
    expect(result.data!.patterns).toContain("no cookies");
  });
});

// =========================================================================
// analyzeSelfIdentification
// =========================================================================

describe("analyzeSelfIdentification", () => {
  it("detects X-Agent-Framework header with confidence 1.0", () => {
    const result = analyzeSelfIdentification(
      req({
        headers: { "x-agent-framework": "LangChain/1.0" },
      }),
    );
    expect(result.signal).toBe("self-id:x-agent-framework");
    expect(result.confidence).toBe(1.0);
    expect(result.data?.framework).toBe("LangChain/1.0");
    expect(result.reason).toContain("X-Agent-Framework");
  });

  it("detects X-AgentGate-Agent-Id header with confidence 1.0", () => {
    const result = analyzeSelfIdentification(
      req({
        headers: { "x-agentgate-agent-id": "agent-abc-123" },
      }),
    );
    expect(result.signal).toBe("self-id:agentgate");
    expect(result.confidence).toBe(1.0);
    expect(result.data?.agentId).toBe("agent-abc-123");
    expect(result.reason).toContain("X-AgentGate-Agent-Id");
  });

  it("detects X-Bot header with confidence 0.9", () => {
    const result = analyzeSelfIdentification(
      req({
        headers: { "x-bot": "true" },
      }),
    );
    expect(result.signal).toBe("self-id:x-bot");
    expect(result.confidence).toBe(0.9);
    expect(result.data?.bot).toBe("true");
  });

  it("detects X-Robot header with confidence 0.9", () => {
    const result = analyzeSelfIdentification(
      req({
        headers: { "x-robot": "my-robot/1.0" },
      }),
    );
    expect(result.signal).toBe("self-id:x-bot");
    expect(result.confidence).toBe(0.9);
    expect(result.data?.bot).toBe("my-robot/1.0");
  });

  it("returns confidence 0 when no self-identification headers are present", () => {
    const result = analyzeSelfIdentification(
      req({
        headers: { "user-agent": "Mozilla/5.0" },
      }),
    );
    expect(result.signal).toBe("self-id:none");
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain("No self-identification");
  });

  it("prioritizes X-Agent-Framework over X-AgentGate-Agent-Id", () => {
    const result = analyzeSelfIdentification(
      req({
        headers: {
          "x-agent-framework": "MyFramework",
          "x-agentgate-agent-id": "agent-1",
        },
      }),
    );
    expect(result.signal).toBe("self-id:x-agent-framework");
    expect(result.data?.framework).toBe("MyFramework");
  });

  it("prioritizes X-AgentGate-Agent-Id over X-Bot", () => {
    const result = analyzeSelfIdentification(
      req({
        headers: {
          "x-agentgate-agent-id": "agent-2",
          "x-bot": "true",
        },
      }),
    );
    expect(result.signal).toBe("self-id:agentgate");
    expect(result.data?.agentId).toBe("agent-2");
  });
});

// =========================================================================
// analyzeAllSignals
// =========================================================================

describe("analyzeAllSignals", () => {
  it("returns exactly 5 signal results", () => {
    const results = analyzeAllSignals(req({}));
    expect(results).toHaveLength(5);
  });

  it("returns results for all signal categories", () => {
    const results = analyzeAllSignals(req({ userAgent: "TestBot" }));
    const signals = results.map((r) => r.signal);

    // Should have one result starting with each prefix
    expect(signals.some((s) => s.startsWith("user-agent:"))).toBe(true);
    expect(signals.some((s) => s.startsWith("headers:"))).toBe(true);
    expect(signals.some((s) => s.startsWith("ip:"))).toBe(true);
    expect(signals.some((s) => s.startsWith("behavior:"))).toBe(true);
    expect(signals.some((s) => s.startsWith("self-id:"))).toBe(true);
  });

  it("passes the same request to all detectors", () => {
    const testReq = req({
      userAgent: "python-requests/2.31.0",
      ip: "54.1.2.3",
      headers: {
        "user-agent": "python-requests/2.31.0",
        "x-agent-framework": "LangChain",
      },
    });
    const results = analyzeAllSignals(testReq);

    // user-agent should detect python-requests
    const uaResult = results.find((r) => r.signal.startsWith("user-agent:"))!;
    expect(uaResult.confidence).toBe(0.70);

    // ip should detect AWS
    const ipResult = results.find((r) => r.signal.startsWith("ip:"))!;
    expect(ipResult.confidence).toBe(0.4);

    // self-id should detect x-agent-framework
    const selfIdResult = results.find((r) => r.signal.startsWith("self-id:"))!;
    expect(selfIdResult.confidence).toBe(1.0);
  });

  it("each result has signal, confidence, and reason properties", () => {
    const results = analyzeAllSignals(req({}));
    for (const result of results) {
      expect(result).toHaveProperty("signal");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("reason");
      expect(typeof result.signal).toBe("string");
      expect(typeof result.confidence).toBe("number");
      expect(typeof result.reason).toBe("string");
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });
});
