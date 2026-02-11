import { describe, it, expect, vi } from "vitest";
import { detect, createDetector, detectMiddleware } from "../middleware.js";
import type { DetectMiddlewareConfig } from "../middleware.js";

// ---------------------------------------------------------------------------
// Mock helpers — Express
// ---------------------------------------------------------------------------

function createMockExpressReq(overrides: Partial<any> = {}): any {
  return {
    headers: {},
    method: "GET",
    path: "/api/test",
    ip: "127.0.0.1",
    ...overrides,
  };
}

function createMockExpressRes(): any {
  const headers: Record<string, string> = {};
  return {
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    set: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    _headers: headers,
  };
}

// ---------------------------------------------------------------------------
// Mock helpers — Hono
// ---------------------------------------------------------------------------

function createMockHonoContext(
  url: string,
  reqHeaders: Record<string, string> = {},
  method: string = "GET",
): any {
  const headersObj = new Headers(reqHeaders);
  const responseHeaders: Record<string, string> = {};

  return {
    req: {
      raw: new Request(url, {
        method,
        headers: headersObj,
      }),
      url,
    },
    header: vi.fn((name: string, value: string) => {
      responseHeaders[name] = value;
    }),
    _responseHeaders: responseHeaders,
  };
}

// =========================================================================
// detect (Express middleware)
// =========================================================================

describe("detect (Express middleware)", () => {
  // --- Header setting -------------------------------------------------------

  it("sets x-agentdoor-is-agent header on response", () => {
    const middleware = detect();
    const req = createMockExpressReq({
      headers: { "user-agent": "python-requests/2.31.0" },
    });
    const res = createMockExpressRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(res._headers["x-agentdoor-is-agent"]).toBeDefined();
    expect(["true", "false"]).toContain(
      res._headers["x-agentdoor-is-agent"],
    );
  });

  it("sets x-agentdoor-confidence header on response", () => {
    const middleware = detect();
    const req = createMockExpressReq({
      headers: { "user-agent": "python-requests/2.31.0" },
    });
    const res = createMockExpressRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(res._headers["x-agentdoor-confidence"]).toBeDefined();
    const confidence = parseFloat(res._headers["x-agentdoor-confidence"]);
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("sets x-agentdoor-framework when framework is detected", () => {
    const middleware = detect();
    const req = createMockExpressReq({
      headers: { "user-agent": "langchain/1.0" },
    });
    const res = createMockExpressRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(res._headers["x-agentdoor-framework"]).toBe("LangChain");
  });

  it("does not set x-agentdoor-framework for browser requests", () => {
    const middleware = detect();
    const req = createMockExpressReq({
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120",
        "accept-language": "en-US",
        "accept-encoding": "gzip",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "sec-fetch-dest": "document",
        "sec-ch-ua": '"Chromium"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        cookie: "session=abc",
        referer: "https://example.com",
      },
      ip: "73.162.45.1",
    });
    const res = createMockExpressRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(res._headers["x-agentdoor-framework"]).toBeUndefined();
  });

  it("marks agent request as is-agent: true", () => {
    const middleware = detect({ excludePaths: [] });
    const req = createMockExpressReq({
      headers: {
        "user-agent": "python-requests/2.31.0",
        accept: "application/json",
        connection: "close",
        "x-request-id": "req-123",
      },
      ip: "54.1.2.3", // AWS cloud IP adds to the signal
    });
    const res = createMockExpressRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(res._headers["x-agentdoor-is-agent"]).toBe("true");
  });

  // --- Calls next() ---------------------------------------------------------

  it("always calls next()", () => {
    const middleware = detect();
    const req = createMockExpressReq({
      headers: { "user-agent": "python-requests/2.31.0" },
    });
    const res = createMockExpressRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next() even for excluded paths", () => {
    const middleware = detect();
    const req = createMockExpressReq({ path: "/health" });
    const res = createMockExpressRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  // --- Path exclusions ------------------------------------------------------

  it("skips detection for default excluded paths", () => {
    const middleware = detect();
    const excludedPaths = [
      "/_next/static/chunk.js",
      "/static/style.css",
      "/assets/logo.png",
      "/favicon.ico",
      "/robots.txt",
      "/sitemap.xml",
      "/.well-known/openid-configuration",
      "/health",
      "/ready",
    ];

    for (const path of excludedPaths) {
      const req = createMockExpressReq({
        path,
        headers: { "user-agent": "python-requests/2.31.0" },
      });
      const res = createMockExpressRes();
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      // No detection headers should be set for excluded paths
      expect(res._headers["x-agentdoor-is-agent"]).toBeUndefined();
    }
  });

  it("respects custom excludePaths", () => {
    const middleware = detect({ excludePaths: ["/internal/"] });
    const req = createMockExpressReq({
      path: "/internal/admin",
      headers: { "user-agent": "python-requests/2.31.0" },
    });
    const res = createMockExpressRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res._headers["x-agentdoor-is-agent"]).toBeUndefined();
  });

  it("overrides default excludePaths when custom ones are provided", () => {
    // Custom excludePaths replaces defaults, so /health should now be processed
    const middleware = detect({ excludePaths: ["/skip-me/"] });
    const req = createMockExpressReq({
      path: "/health",
      headers: { "user-agent": "python-requests/2.31.0" },
    });
    const res = createMockExpressRes();
    const next = vi.fn();

    middleware(req, res, next);

    // /health is NOT excluded with custom config, so headers should be set
    expect(res._headers["x-agentdoor-is-agent"]).toBeDefined();
  });

  // --- Path inclusions ------------------------------------------------------

  it("respects paths inclusion filter", () => {
    const middleware = detect({ paths: ["/api/"], excludePaths: [] });

    // Matching path should get detection
    const apiReq = createMockExpressReq({
      path: "/api/data",
      headers: { "user-agent": "python-requests/2.31.0" },
    });
    const apiRes = createMockExpressRes();
    const apiNext = vi.fn();

    middleware(apiReq, apiRes, apiNext);
    expect(apiRes._headers["x-agentdoor-is-agent"]).toBeDefined();
    expect(apiNext).toHaveBeenCalled();

    // Non-matching path should skip detection
    const webReq = createMockExpressReq({
      path: "/about",
      headers: { "user-agent": "python-requests/2.31.0" },
    });
    const webRes = createMockExpressRes();
    const webNext = vi.fn();

    middleware(webReq, webRes, webNext);
    expect(webRes._headers["x-agentdoor-is-agent"]).toBeUndefined();
    expect(webNext).toHaveBeenCalled();
  });

  it("applies both path inclusions and exclusions", () => {
    const middleware = detect({
      paths: ["/api/"],
      excludePaths: ["/api/health"],
    });

    // /api/data should be processed
    const dataReq = createMockExpressReq({
      path: "/api/data",
      headers: { "user-agent": "python-requests/2.31.0" },
    });
    const dataRes = createMockExpressRes();
    const dataNext = vi.fn();
    middleware(dataReq, dataRes, dataNext);
    expect(dataRes._headers["x-agentdoor-is-agent"]).toBeDefined();

    // /api/health should be excluded (exclusion takes priority)
    const healthReq = createMockExpressReq({
      path: "/api/health",
      headers: { "user-agent": "python-requests/2.31.0" },
    });
    const healthRes = createMockExpressRes();
    const healthNext = vi.fn();
    middleware(healthReq, healthRes, healthNext);
    expect(healthRes._headers["x-agentdoor-is-agent"]).toBeUndefined();
  });

  // --- onClassified callback ------------------------------------------------

  it("calls onClassified callback with classification result and request", () => {
    const onClassified = vi.fn();
    const middleware = detect({ onClassified, excludePaths: [] });
    const req = createMockExpressReq({
      headers: { "user-agent": "python-requests/2.31.0" },
    });
    const res = createMockExpressRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(onClassified).toHaveBeenCalledTimes(1);
    const [result, normalizedReq] = onClassified.mock.calls[0];
    expect(result).toHaveProperty("isAgent");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("signals");
    expect(normalizedReq).toHaveProperty("headers");
    expect(normalizedReq).toHaveProperty("userAgent");
  });

  it("does not call onClassified for excluded paths", () => {
    const onClassified = vi.fn();
    const middleware = detect({ onClassified });
    const req = createMockExpressReq({ path: "/health" });
    const res = createMockExpressRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(onClassified).not.toHaveBeenCalled();
  });

  it("handles onClassified callback errors gracefully", () => {
    const onClassified = vi.fn(() => {
      throw new Error("callback error");
    });
    const middleware = detect({ onClassified, excludePaths: [] });
    const req = createMockExpressReq({
      headers: { "user-agent": "python-requests/2.31.0" },
    });
    const res = createMockExpressRes();
    const next = vi.fn();

    // Should not throw
    expect(() => middleware(req, res, next)).not.toThrow();
    expect(next).toHaveBeenCalled();
  });

  it("handles async onClassified callback", () => {
    const onClassified = vi.fn(async () => {
      // async callback
    });
    const middleware = detect({ onClassified, excludePaths: [] });
    const req = createMockExpressReq({
      headers: { "user-agent": "python-requests/2.31.0" },
    });
    const res = createMockExpressRes();
    const next = vi.fn();

    expect(() => middleware(req, res, next)).not.toThrow();
    expect(onClassified).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  // --- Request normalization ------------------------------------------------

  it("reads user-agent from express headers", () => {
    const middleware = detect({ excludePaths: [] });
    const onClassified = vi.fn();
    const mw = detect({ onClassified, excludePaths: [] });

    const req = createMockExpressReq({
      headers: { "user-agent": "langchain/1.0" },
    });
    const res = createMockExpressRes();
    const next = vi.fn();

    mw(req, res, next);

    const [result] = onClassified.mock.calls[0];
    expect(result.framework).toBe("LangChain");
  });

  it("falls back to req.url when req.path is not available", () => {
    const onClassified = vi.fn();
    const middleware = detect({
      paths: ["/api/"],
      excludePaths: [],
      onClassified,
    });

    const req = createMockExpressReq({
      path: undefined,
      url: "/api/data",
      headers: { "user-agent": "test" },
    });
    const res = createMockExpressRes();
    const next = vi.fn();

    middleware(req, res, next);

    // Path matching should still work via url fallback
    expect(onClassified).toHaveBeenCalled();
  });

  it("reads IP from x-forwarded-for header", () => {
    const onClassified = vi.fn();
    const middleware = detect({ onClassified, excludePaths: [] });

    const req = createMockExpressReq({
      headers: {
        "user-agent": "test",
        "x-forwarded-for": "54.1.2.3, 10.0.0.1",
      },
      ip: "10.0.0.1",
    });
    const res = createMockExpressRes();
    const next = vi.fn();

    middleware(req, res, next);

    const [, normalizedReq] = onClassified.mock.calls[0];
    expect(normalizedReq.ip).toBe("54.1.2.3");
  });

  it("reads IP from x-real-ip header", () => {
    const onClassified = vi.fn();
    const middleware = detect({ onClassified, excludePaths: [] });

    const req = createMockExpressReq({
      headers: {
        "user-agent": "test",
        "x-real-ip": "54.1.2.3",
      },
      ip: "10.0.0.1",
    });
    const res = createMockExpressRes();
    const next = vi.fn();

    middleware(req, res, next);

    const [, normalizedReq] = onClassified.mock.calls[0];
    expect(normalizedReq.ip).toBe("54.1.2.3");
  });

  it("handles array-valued headers (Express behavior)", () => {
    const onClassified = vi.fn();
    const middleware = detect({ onClassified, excludePaths: [] });

    const req = createMockExpressReq({
      headers: {
        "user-agent": "test-agent",
        "x-custom": ["value1", "value2"],
      },
    });
    const res = createMockExpressRes();
    const next = vi.fn();

    middleware(req, res, next);

    // Should not crash — array headers are joined
    expect(next).toHaveBeenCalled();
    expect(onClassified).toHaveBeenCalled();
  });

  // --- Response with res.set instead of res.setHeader -----------------------

  it("uses res.set if res.setHeader is not available", () => {
    const middleware = detect({ excludePaths: [] });
    const headers: Record<string, string> = {};
    const res = {
      set: vi.fn((name: string, value: string) => {
        headers[name] = value;
      }),
      _headers: headers,
    };
    const req = createMockExpressReq({
      headers: { "user-agent": "python-requests/2.31.0" },
    });
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(res.set).toHaveBeenCalled();
    expect(headers["x-agentdoor-is-agent"]).toBeDefined();
  });

  // --- Classifier config passthrough ----------------------------------------

  it("passes threshold config to classifier", () => {
    const middleware = detect({ threshold: 0.99, excludePaths: [] });

    const req = createMockExpressReq({
      headers: { "user-agent": "python-requests/2.31.0" },
    });
    const res = createMockExpressRes();
    const next = vi.fn();

    middleware(req, res, next);

    // With 0.99 threshold, python-requests should not be classified as agent
    expect(res._headers["x-agentdoor-is-agent"]).toBe("false");
  });

  it("passes weights config to classifier", () => {
    const onClassified = vi.fn();
    const middleware = detect({
      weights: { "user-agent": 1.0, headers: 0, ip: 0, behavior: 0, "self-id": 0 },
      onClassified,
      excludePaths: [],
    });

    const req = createMockExpressReq({
      headers: { "user-agent": "python-requests/2.31.0" },
    });
    const res = createMockExpressRes();
    const next = vi.fn();

    middleware(req, res, next);

    const [result] = onClassified.mock.calls[0];
    // Confidence should be dominated by user-agent signal
    expect(result.confidence).toBeCloseTo(0.7, 1);
  });
});

// =========================================================================
// createDetector
// =========================================================================

describe("createDetector", () => {
  it("returns a function", () => {
    const detector = createDetector();
    expect(typeof detector).toBe("function");
  });

  it("classifies a fetch Request as agent", () => {
    const detector = createDetector();
    const request = new Request("https://example.com/api/data", {
      headers: {
        "User-Agent": "python-requests/2.31.0",
        Accept: "application/json",
        Connection: "close",
        "X-Request-Id": "req-456",
        "X-Forwarded-For": "54.1.2.3", // AWS cloud IP
      },
    });

    const result = detector(request);

    expect(result).toHaveProperty("isAgent");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("signals");
    expect(result).toHaveProperty("classifiedAt");
    expect(result.isAgent).toBe(true);
  });

  it("classifies a fetch Request as browser", () => {
    const detector = createDetector();
    const request = new Request("https://example.com/", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-Dest": "document",
        "Sec-Ch-Ua": '"Chromium";v="120"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"macOS"',
        Referer: "https://example.com/",
        Cookie: "session=abc123",
        DNT: "1",
      },
    });

    const result = detector(request);
    expect(result.isAgent).toBe(false);
  });

  it("respects config threshold", () => {
    const strictDetector = createDetector({ threshold: 0.99 });
    const request = new Request("https://example.com/api", {
      headers: {
        "User-Agent": "python-requests/2.31.0",
      },
    });

    const result = strictDetector(request);
    expect(result.isAgent).toBe(false);
    expect(result.confidence).toBeLessThan(0.99);
  });

  it("detects self-identified agent in fetch Request", () => {
    const detector = createDetector();
    const request = new Request("https://example.com/api", {
      headers: {
        "X-Agent-Framework": "LangChain/1.0",
      },
    });

    const result = detector(request);
    expect(result.isAgent).toBe(true);
    expect(result.confidence).toBe(1.0);
    expect(result.framework).toBe("LangChain/1.0");
  });

  it("extracts IP from x-forwarded-for in fetch Request", () => {
    const detector = createDetector();
    const request = new Request("https://example.com/api", {
      headers: {
        "User-Agent": "test",
        "X-Forwarded-For": "54.1.2.3, 10.0.0.1",
      },
    });

    const result = detector(request);
    // Should detect 54.1.2.3 as AWS IP
    const ipSignal = result.signals.find((s) => s.signal.startsWith("ip:"));
    expect(ipSignal?.signal).toBe("ip:cloud-provider");
    expect(ipSignal?.data?.provider).toBe("AWS");
  });

  it("extracts IP from cf-connecting-ip header", () => {
    const detector = createDetector();
    const request = new Request("https://example.com/api", {
      headers: {
        "User-Agent": "test",
        "CF-Connecting-IP": "35.184.1.1",
      },
    });

    const result = detector(request);
    const ipSignal = result.signals.find((s) => s.signal.startsWith("ip:"));
    expect(ipSignal?.signal).toBe("ip:cloud-provider");
    expect(ipSignal?.data?.provider).toBe("Google Cloud");
  });

  it("extracts path from fetch Request URL", () => {
    const detector = createDetector();
    const request = new Request(
      "https://example.com/api/v1/data?key=value",
      {
        method: "POST",
        headers: { "User-Agent": "test" },
      },
    );

    // Just verify it doesn't crash with a URL that has query params
    const result = detector(request);
    expect(result).toHaveProperty("isAgent");
  });
});

// =========================================================================
// detectMiddleware (Hono)
// =========================================================================

describe("detectMiddleware (Hono)", () => {
  it("sets x-agentdoor-is-agent header on Hono context", async () => {
    const middleware = detectMiddleware({ excludePaths: [] });
    const c = createMockHonoContext("https://example.com/api/test", {
      "User-Agent": "python-requests/2.31.0",
    });
    const next = vi.fn(async () => {});

    await middleware(c, next);

    expect(c.header).toHaveBeenCalledWith(
      "x-agentdoor-is-agent",
      expect.any(String),
    );
    // Find the call that sets is-agent
    const isAgentCall = c.header.mock.calls.find(
      (call: string[]) => call[0] === "x-agentdoor-is-agent",
    );
    expect(isAgentCall).toBeDefined();
    expect(["true", "false"]).toContain(isAgentCall![1]);
  });

  it("sets x-agentdoor-confidence header on Hono context", async () => {
    const middleware = detectMiddleware({ excludePaths: [] });
    const c = createMockHonoContext("https://example.com/api/test", {
      "User-Agent": "python-requests/2.31.0",
    });
    const next = vi.fn(async () => {});

    await middleware(c, next);

    const confidenceCall = c.header.mock.calls.find(
      (call: string[]) => call[0] === "x-agentdoor-confidence",
    );
    expect(confidenceCall).toBeDefined();
    const confidence = parseFloat(confidenceCall![1]);
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("sets x-agentdoor-framework header when framework detected", async () => {
    const middleware = detectMiddleware({ excludePaths: [] });
    const c = createMockHonoContext("https://example.com/api/test", {
      "User-Agent": "langchain/1.0",
    });
    const next = vi.fn(async () => {});

    await middleware(c, next);

    const frameworkCall = c.header.mock.calls.find(
      (call: string[]) => call[0] === "x-agentdoor-framework",
    );
    expect(frameworkCall).toBeDefined();
    expect(frameworkCall![1]).toBe("LangChain");
  });

  it("calls next()", async () => {
    const middleware = detectMiddleware({ excludePaths: [] });
    const c = createMockHonoContext("https://example.com/api/test");
    const next = vi.fn(async () => {});

    await middleware(c, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  // --- Path exclusions for Hono ---------------------------------------------

  it("skips detection for default excluded paths", async () => {
    const middleware = detectMiddleware();
    const excludedPaths = [
      "https://example.com/_next/static/chunk.js",
      "https://example.com/static/style.css",
      "https://example.com/health",
      "https://example.com/ready",
      "https://example.com/robots.txt",
      "https://example.com/favicon.ico",
    ];

    for (const url of excludedPaths) {
      const c = createMockHonoContext(url, {
        "User-Agent": "python-requests/2.31.0",
      });
      const next = vi.fn(async () => {});

      await middleware(c, next);

      expect(next).toHaveBeenCalled();
      // No headers should be set for excluded paths
      expect(c.header).not.toHaveBeenCalled();
    }
  });

  it("respects custom excludePaths", async () => {
    const middleware = detectMiddleware({ excludePaths: ["/internal/"] });
    const c = createMockHonoContext(
      "https://example.com/internal/admin",
      { "User-Agent": "python-requests/2.31.0" },
    );
    const next = vi.fn(async () => {});

    await middleware(c, next);

    expect(next).toHaveBeenCalled();
    expect(c.header).not.toHaveBeenCalled();
  });

  // --- Path inclusions for Hono ---------------------------------------------

  it("respects paths inclusion filter", async () => {
    const middleware = detectMiddleware({
      paths: ["/api/"],
      excludePaths: [],
    });

    // Matching path
    const apiCtx = createMockHonoContext(
      "https://example.com/api/data",
      { "User-Agent": "python-requests/2.31.0" },
    );
    const apiNext = vi.fn(async () => {});
    await middleware(apiCtx, apiNext);
    expect(apiCtx.header).toHaveBeenCalled();

    // Non-matching path
    const webCtx = createMockHonoContext(
      "https://example.com/about",
      { "User-Agent": "python-requests/2.31.0" },
    );
    const webNext = vi.fn(async () => {});
    await middleware(webCtx, webNext);
    expect(webCtx.header).not.toHaveBeenCalled();
    expect(webNext).toHaveBeenCalled();
  });

  // --- onClassified callback ------------------------------------------------

  it("calls onClassified callback", async () => {
    const onClassified = vi.fn();
    const middleware = detectMiddleware({ onClassified, excludePaths: [] });
    const c = createMockHonoContext("https://example.com/api/test", {
      "User-Agent": "python-requests/2.31.0",
    });
    const next = vi.fn(async () => {});

    await middleware(c, next);

    expect(onClassified).toHaveBeenCalledTimes(1);
    const [result, normalizedReq] = onClassified.mock.calls[0];
    expect(result).toHaveProperty("isAgent");
    expect(normalizedReq).toHaveProperty("headers");
  });

  it("handles async onClassified callback errors gracefully", async () => {
    const onClassified = vi.fn(async () => {
      throw new Error("async callback error");
    });
    const middleware = detectMiddleware({ onClassified, excludePaths: [] });
    const c = createMockHonoContext("https://example.com/api/test", {
      "User-Agent": "test",
    });
    const next = vi.fn(async () => {});

    // Should not throw
    await expect(middleware(c, next)).resolves.not.toThrow();
    expect(next).toHaveBeenCalled();
  });

  // --- Classifier config passthrough ----------------------------------------

  it("passes threshold config to classifier", async () => {
    const middleware = detectMiddleware({
      threshold: 0.99,
      excludePaths: [],
    });
    const c = createMockHonoContext("https://example.com/api/test", {
      "User-Agent": "python-requests/2.31.0",
    });
    const next = vi.fn(async () => {});

    await middleware(c, next);

    const isAgentCall = c.header.mock.calls.find(
      (call: string[]) => call[0] === "x-agentdoor-is-agent",
    );
    expect(isAgentCall![1]).toBe("false");
  });

  it("detects self-identified agent via Hono context", async () => {
    const middleware = detectMiddleware({ excludePaths: [] });
    const c = createMockHonoContext("https://example.com/api/test", {
      "X-Agent-Framework": "CustomAgent/1.0",
    });
    const next = vi.fn(async () => {});

    await middleware(c, next);

    const isAgentCall = c.header.mock.calls.find(
      (call: string[]) => call[0] === "x-agentdoor-is-agent",
    );
    expect(isAgentCall![1]).toBe("true");

    const confidenceCall = c.header.mock.calls.find(
      (call: string[]) => call[0] === "x-agentdoor-confidence",
    );
    expect(confidenceCall![1]).toBe("1");

    const frameworkCall = c.header.mock.calls.find(
      (call: string[]) => call[0] === "x-agentdoor-framework",
    );
    expect(frameworkCall![1]).toBe("CustomAgent/1.0");
  });
});
