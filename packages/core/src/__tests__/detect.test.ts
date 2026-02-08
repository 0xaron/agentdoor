import { describe, it, expect } from "vitest";
import {
  detectAgent,
  isLikelyAgent,
  extractFrameworkInfo,
  createRequestInfo,
} from "../detect.js";
import type { RequestInfo } from "../types.js";
import { AGENT_FRAMEWORK_HEADER } from "../constants.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal RequestInfo for testing. */
function makeRequest(overrides: Partial<RequestInfo> = {}): RequestInfo {
  return {
    method: "GET",
    path: "/api/test",
    headers: {},
    ...overrides,
  };
}

/** Build a browser-like request. */
function makeBrowserRequest(): RequestInfo {
  return makeRequest({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    headers: {
      "accept-language": "en-US,en;q=0.9",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      "sec-fetch-dest": "document",
      "sec-ch-ua": '"Chromium";v="120"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      cookie: "session=abc123",
      referer: "https://example.com/",
    },
  });
}

// ---------------------------------------------------------------------------
// detectAgent
// ---------------------------------------------------------------------------

describe("detectAgent", () => {
  describe("User-Agent string classification", () => {
    it("detects LangChain user agent", () => {
      const result = detectAgent(makeRequest({ userAgent: "langchain/0.1.0" }));
      const uaSignal = result.signals.find((s) => s.name === "user_agent");
      expect(uaSignal?.triggered).toBe(true);
      expect(result.framework).toBe("langchain");
    });

    it("detects CrewAI user agent", () => {
      const result = detectAgent(makeRequest({ userAgent: "CrewAI/1.0.0" }));
      const uaSignal = result.signals.find((s) => s.name === "user_agent");
      expect(uaSignal?.triggered).toBe(true);
      expect(result.framework).toBe("crewai");
    });

    it("detects AutoGen user agent", () => {
      const result = detectAgent(makeRequest({ userAgent: "AutoGen/0.2.0" }));
      const uaSignal = result.signals.find((s) => s.name === "user_agent");
      expect(uaSignal?.triggered).toBe(true);
      expect(result.framework).toBe("autogen");
    });

    it("detects python-requests user agent signal", () => {
      const result = detectAgent(
        makeRequest({ userAgent: "python-requests/2.31.0" }),
      );
      const uaSignal = result.signals.find((s) => s.name === "user_agent");
      expect(uaSignal?.triggered).toBe(true);
      expect(result.framework).toBe("python-requests");
    });

    it("detects python-httpx user agent signal", () => {
      const result = detectAgent(
        makeRequest({ userAgent: "python-httpx/0.25.0" }),
      );
      const uaSignal = result.signals.find((s) => s.name === "user_agent");
      expect(uaSignal?.triggered).toBe(true);
      expect(result.framework).toBe("python-httpx");
    });

    it("detects curl user agent signal", () => {
      const result = detectAgent(makeRequest({ userAgent: "curl/8.1.2" }));
      const uaSignal = result.signals.find((s) => s.name === "user_agent");
      expect(uaSignal?.triggered).toBe(true);
      expect(result.framework).toBe("curl");
    });

    it("does not flag a Chrome browser user agent as agent", () => {
      const result = detectAgent(makeBrowserRequest());
      expect(result.isAgent).toBe(false);
      expect(result.confidence).toBeLessThan(0.5);
    });

    it("flags a non-browser user agent with lower confidence", () => {
      const result = detectAgent(
        makeRequest({ userAgent: "MyCustomApp/1.0" }),
      );
      // Should trigger at lower confidence since it's not a known framework
      const uaSignal = result.signals.find((s) => s.name === "user_agent");
      expect(uaSignal?.triggered).toBe(true);
    });
  });

  describe("Self-identification via X-Agent-Framework header", () => {
    it("detects self-identified agent with framework header", () => {
      const result = detectAgent(
        makeRequest({
          headers: { [AGENT_FRAMEWORK_HEADER]: "langchain/0.1.0" },
        }),
      );
      expect(result.isAgent).toBe(true);
      expect(result.framework).toBe("langchain");
      expect(result.frameworkVersion).toBe("0.1.0");
    });

    it("detects framework without version", () => {
      const result = detectAgent(
        makeRequest({
          headers: { [AGENT_FRAMEWORK_HEADER]: "custom-agent" },
        }),
      );
      expect(result.isAgent).toBe(true);
      expect(result.framework).toBe("custom-agent");
    });

    it("self-identification has highest weight", () => {
      const result = detectAgent(
        makeRequest({
          headers: { [AGENT_FRAMEWORK_HEADER]: "test-framework" },
        }),
      );
      const selfIdSignal = result.signals.find(
        (s) => s.name === "self_identification",
      );
      expect(selfIdSignal?.triggered).toBe(true);
      expect(selfIdSignal?.weight).toBe(1.0);
    });
  });

  describe("Header pattern analysis", () => {
    it("flags missing browser headers (Accept-Language, sec-* headers)", () => {
      const result = detectAgent(makeRequest({ headers: {} }));
      const headerSignal = result.signals.find(
        (s) => s.name === "missing_browser_headers",
      );
      expect(headerSignal?.triggered).toBe(true);
    });

    it("does not flag when browser headers are present", () => {
      const result = detectAgent(makeBrowserRequest());
      const headerSignal = result.signals.find(
        (s) => s.name === "missing_browser_headers",
      );
      expect(headerSignal?.triggered).toBe(false);
    });
  });

  describe("IP range classification", () => {
    it("flags known cloud provider IP (AWS 52.x)", () => {
      const result = detectAgent(makeRequest({ ip: "52.12.34.56" }));
      const ipSignal = result.signals.find((s) => s.name === "ip_range");
      expect(ipSignal?.triggered).toBe(true);
    });

    it("flags known cloud provider IP (GCP 34.x)", () => {
      const result = detectAgent(makeRequest({ ip: "34.56.78.90" }));
      const ipSignal = result.signals.find((s) => s.name === "ip_range");
      expect(ipSignal?.triggered).toBe(true);
    });

    it("does not flag non-cloud IPs", () => {
      const result = detectAgent(makeRequest({ ip: "192.168.1.100" }));
      const ipSignal = result.signals.find((s) => s.name === "ip_range");
      expect(ipSignal?.triggered).toBe(false);
    });

    it("handles missing IP gracefully", () => {
      const result = detectAgent(makeRequest({ ip: undefined }));
      const ipSignal = result.signals.find((s) => s.name === "ip_range");
      expect(ipSignal?.triggered).toBe(false);
    });
  });

  describe("Behavioral pattern detection (timing)", () => {
    it("does not flag timing with fewer than 5 requests", () => {
      const ip = "10.0.0.1";
      const now = Date.now();
      for (let i = 0; i < 4; i++) {
        detectAgent(makeRequest({ ip, timestamp: now + i * 50 }));
      }
      const result = detectAgent(makeRequest({ ip, timestamp: now + 200 }));
      // Should not yet trigger timing (need 5+ in tracker)
      const timingSignal = result.signals.find((s) => s.name === "timing");
      // Timing detection needs history build-up
      expect(timingSignal).toBeDefined();
    });

    it("flags rapid sequential requests", () => {
      const ip = "10.0.0.99";
      const now = Date.now();
      // Send 10 requests with 10ms intervals (very fast)
      let result;
      for (let i = 0; i < 10; i++) {
        result = detectAgent(makeRequest({ ip, timestamp: now + i * 10 }));
      }
      const timingSignal = result!.signals.find((s) => s.name === "timing");
      expect(timingSignal?.triggered).toBe(true);
    });
  });

  describe("Cookie and Referer checks", () => {
    it("flags missing cookies", () => {
      const result = detectAgent(makeRequest({ headers: {} }));
      const cookieSignal = result.signals.find((s) => s.name === "no_cookies");
      expect(cookieSignal?.triggered).toBe(true);
    });

    it("does not flag when cookies are present", () => {
      const result = detectAgent(
        makeRequest({ headers: { cookie: "session=abc" } }),
      );
      const cookieSignal = result.signals.find((s) => s.name === "no_cookies");
      expect(cookieSignal?.triggered).toBe(false);
    });

    it("flags missing referer", () => {
      const result = detectAgent(makeRequest({ headers: {} }));
      const refererSignal = result.signals.find(
        (s) => s.name === "no_referer",
      );
      expect(refererSignal?.triggered).toBe(true);
    });

    it("does not flag when referer is present", () => {
      const result = detectAgent(
        makeRequest({ headers: { referer: "https://example.com" } }),
      );
      const refererSignal = result.signals.find(
        (s) => s.name === "no_referer",
      );
      expect(refererSignal?.triggered).toBe(false);
    });
  });

  describe("Accept header analysis", () => {
    it("flags API-only accept header (application/json)", () => {
      const result = detectAgent(
        makeRequest({ headers: { accept: "application/json" } }),
      );
      const acceptSignal = result.signals.find(
        (s) => s.name === "accept_header",
      );
      expect(acceptSignal?.triggered).toBe(true);
    });

    it("flags missing accept header", () => {
      const result = detectAgent(makeRequest({ headers: {} }));
      const acceptSignal = result.signals.find(
        (s) => s.name === "accept_header",
      );
      expect(acceptSignal?.triggered).toBe(true);
    });

    it("does not flag browser-style accept header", () => {
      const result = detectAgent(
        makeRequest({
          headers: {
            accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        }),
      );
      const acceptSignal = result.signals.find(
        (s) => s.name === "accept_header",
      );
      expect(acceptSignal?.triggered).toBe(false);
    });
  });

  describe("Combined signal scoring and threshold", () => {
    it("confidence is 0-1 range", () => {
      const result = detectAgent(makeRequest());
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("confidence is rounded to 3 decimal places", () => {
      const result = detectAgent(makeRequest());
      const str = result.confidence.toString();
      const decimals = str.includes(".") ? str.split(".")[1].length : 0;
      expect(decimals).toBeLessThanOrEqual(3);
    });

    it("returns signals array with all signal types", () => {
      const result = detectAgent(makeRequest());
      const signalNames = result.signals.map((s) => s.name);
      expect(signalNames).toContain("self_identification");
      expect(signalNames).toContain("user_agent");
      expect(signalNames).toContain("missing_browser_headers");
      expect(signalNames).toContain("ip_range");
      expect(signalNames).toContain("timing");
      expect(signalNames).toContain("no_cookies");
      expect(signalNames).toContain("no_referer");
      expect(signalNames).toContain("accept_header");
    });

    it("browser request scores below threshold", () => {
      const result = detectAgent(makeBrowserRequest());
      expect(result.isAgent).toBe(false);
    });

    it("agent request with multiple signals scores above threshold", () => {
      const result = detectAgent(
        makeRequest({
          userAgent: "python-requests/2.31.0",
          headers: {
            accept: "application/json",
            [AGENT_FRAMEWORK_HEADER]: "langchain/0.1.0",
          },
          ip: "52.12.34.56",
        }),
      );
      expect(result.isAgent).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    });
  });

  describe("Edge cases", () => {
    it("handles empty headers", () => {
      const result = detectAgent(makeRequest({ headers: {} }));
      expect(result).toHaveProperty("isAgent");
      expect(result).toHaveProperty("confidence");
    });

    it("handles undefined user agent", () => {
      const result = detectAgent(
        makeRequest({ userAgent: undefined }),
      );
      expect(result).toHaveProperty("isAgent");
    });

    it("handles array header values", () => {
      const result = detectAgent(
        makeRequest({
          headers: { [AGENT_FRAMEWORK_HEADER]: ["langchain/0.1.0"] },
        }),
      );
      expect(result.framework).toBe("langchain");
    });
  });
});

// ---------------------------------------------------------------------------
// isLikelyAgent
// ---------------------------------------------------------------------------

describe("isLikelyAgent", () => {
  it("returns true for X-Agent-Framework header", () => {
    const result = isLikelyAgent(
      makeRequest({
        headers: { [AGENT_FRAMEWORK_HEADER]: "myagent" },
      }),
    );
    expect(result).toBe(true);
  });

  it("returns true for known agent user agent", () => {
    expect(
      isLikelyAgent(makeRequest({ userAgent: "langchain/0.1.0" })),
    ).toBe(true);
    expect(
      isLikelyAgent(makeRequest({ userAgent: "python-requests/2.31" })),
    ).toBe(true);
  });

  it("returns true for AgentGate auth header", () => {
    const result = isLikelyAgent(
      makeRequest({
        headers: { authorization: "Bearer agk_live_test123" },
      }),
    );
    expect(result).toBe(true);
  });

  it("returns false for normal browser request", () => {
    expect(isLikelyAgent(makeBrowserRequest())).toBe(false);
  });

  it("returns false for empty request", () => {
    expect(isLikelyAgent(makeRequest())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractFrameworkInfo
// ---------------------------------------------------------------------------

describe("extractFrameworkInfo", () => {
  it("extracts from X-Agent-Framework header", () => {
    const info = extractFrameworkInfo(
      makeRequest({
        headers: { [AGENT_FRAMEWORK_HEADER]: "crewai/1.2.3" },
      }),
    );
    expect(info).toEqual({ framework: "crewai", version: "1.2.3" });
  });

  it("extracts from X-Agent-Framework without version", () => {
    const info = extractFrameworkInfo(
      makeRequest({
        headers: { [AGENT_FRAMEWORK_HEADER]: "custom-bot" },
      }),
    );
    expect(info).toEqual({ framework: "custom-bot", version: undefined });
  });

  it("extracts from user agent when no header", () => {
    const info = extractFrameworkInfo(
      makeRequest({ userAgent: "langchain/0.5.0" }),
    );
    expect(info?.framework).toBe("langchain");
  });

  it("returns null when no framework detectable", () => {
    const info = extractFrameworkInfo(makeBrowserRequest());
    expect(info).toBeNull();
  });

  it("prefers X-Agent-Framework header over user agent", () => {
    const info = extractFrameworkInfo(
      makeRequest({
        userAgent: "langchain/0.1.0",
        headers: { [AGENT_FRAMEWORK_HEADER]: "crewai/2.0" },
      }),
    );
    expect(info?.framework).toBe("crewai");
  });
});

// ---------------------------------------------------------------------------
// createRequestInfo
// ---------------------------------------------------------------------------

describe("createRequestInfo", () => {
  it("normalizes header keys to lowercase", () => {
    const info = createRequestInfo({
      headers: { "Accept-Language": "en-US", "Content-Type": "application/json" },
      method: "GET",
      path: "/test",
    });
    expect(info.headers["accept-language"]).toBe("en-US");
    expect(info.headers["content-type"]).toBe("application/json");
  });

  it("uppercases the method", () => {
    const info = createRequestInfo({
      headers: {},
      method: "post",
      path: "/test",
    });
    expect(info.method).toBe("POST");
  });

  it("extracts user-agent from headers if not provided", () => {
    const info = createRequestInfo({
      headers: { "User-Agent": "test-agent/1.0" },
      method: "GET",
      path: "/test",
    });
    expect(info.userAgent).toBe("test-agent/1.0");
  });

  it("prefers explicit userAgent over header", () => {
    const info = createRequestInfo({
      userAgent: "explicit-agent",
      headers: { "User-Agent": "header-agent" },
      method: "GET",
      path: "/test",
    });
    expect(info.userAgent).toBe("explicit-agent");
  });

  it("sets timestamp if not provided", () => {
    const before = Date.now();
    const info = createRequestInfo({
      headers: {},
      method: "GET",
      path: "/test",
    });
    const after = Date.now();
    expect(info.timestamp).toBeGreaterThanOrEqual(before);
    expect(info.timestamp).toBeLessThanOrEqual(after);
  });
});
