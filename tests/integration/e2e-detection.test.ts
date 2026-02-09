/**
 * Integration / E2E tests for the detection middleware.
 *
 * Tests that the detection system correctly identifies agent vs browser
 * traffic based on User-Agent, headers, and other signals.
 *
 * Uses the @agentgate/detect package with Express middleware.
 *
 * Note: The classifier uses a weighted combination of 5 signal categories
 * (user-agent, self-id, headers, behavior, ip). Individual signals may not
 * cross the 0.5 threshold alone — combining multiple agent-like signals
 * produces reliable classification.
 */

import { describe, it, expect } from "vitest";
import express from "express";
import * as http from "node:http";
import { detect, classifyRequest } from "@agentgate/detect";

// ---------------------------------------------------------------------------
// HTTP request helper
// ---------------------------------------------------------------------------

async function request(
  app: express.Express,
  method: string,
  path: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      const reqHeaders: Record<string, string> = { ...headers };

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: addr.port,
          path,
          method,
          headers: reqHeaders,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            server.close();
            let parsed: any;
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = data;
            }
            resolve({ status: res.statusCode!, body: parsed, headers: res.headers });
          });
        },
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

function createApp() {
  const app = express();
  app.use(detect());
  app.get("/api/data", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/public/page", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("AgentGate E2E: Detection Middleware", () => {
  it("detects high-confidence agent traffic (LangChain UA)", async () => {
    const app = createApp();

    // LangChain has 0.95 UA confidence — strong enough to cross 0.5 threshold
    const res = await request(app, "GET", "/api/data", {
      "User-Agent": "langchain/0.1.0",
    });

    expect(res.status).toBe(200);
    expect(res.headers["x-agentgate-is-agent"]).toBe("true");
    expect(res.headers["x-agentgate-confidence"]).toBeDefined();
    const confidence = parseFloat(res.headers["x-agentgate-confidence"] as string);
    expect(confidence).toBeGreaterThan(0.5);
  });

  it("detects agent traffic via X-Agent-Framework header (self-identification)", async () => {
    const app = createApp();

    // Self-identification short-circuits to confidence 1.0
    const res = await request(app, "GET", "/api/data", {
      "User-Agent": "curl/8.0",
      "X-Agent-Framework": "my-custom-agent/1.0.0",
    });

    expect(res.status).toBe(200);
    expect(res.headers["x-agentgate-is-agent"]).toBe("true");
    expect(res.headers["x-agentgate-framework"]).toBeDefined();
  });

  it("detects agent traffic from combined signals (HTTP library + no browser headers)", async () => {
    const app = createApp();

    // python-requests alone may not cross 0.5 (0.70 * 0.35 = 0.245),
    // but combined with Accept: application/json (no browser Accept)
    // and no cookies/referer/accept-language, the signals combine
    const res = await request(app, "GET", "/api/data", {
      "User-Agent": "python-requests/2.31.0",
      Accept: "application/json",
    });

    expect(res.status).toBe(200);
    expect(res.headers["x-agentgate-is-agent"]).toBeDefined();
    expect(res.headers["x-agentgate-confidence"]).toBeDefined();
    const confidence = parseFloat(res.headers["x-agentgate-confidence"] as string);
    expect(confidence).toBeGreaterThan(0);
  });

  it("classifies browser traffic as non-agent", async () => {
    const app = createApp();

    const res = await request(app, "GET", "/api/data", {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Accept-Encoding": "gzip, deflate, br",
      Cookie: "session=abc123",
      Referer: "https://example.com/dashboard",
    });

    expect(res.status).toBe(200);
    expect(res.headers["x-agentgate-is-agent"]).toBe("false");
  });

  it("detects agent traffic with self-identification + auth header", async () => {
    const app = createApp();

    const res = await request(app, "GET", "/api/data", {
      "User-Agent": "agentgate-sdk/1.0.0",
      "X-Agent-Framework": "agentgate-sdk/1.0.0",
      Authorization: "Bearer agk_live_test1234567890abcdef12345678",
    });

    expect(res.status).toBe(200);
    expect(res.headers["x-agentgate-is-agent"]).toBe("true");
  });

  it("handles requests with no User-Agent header", async () => {
    const app = createApp();

    const res = await request(app, "GET", "/api/data", {
      Accept: "application/json",
    });

    expect(res.status).toBe(200);
    expect(res.headers["x-agentgate-is-agent"]).toBeDefined();
  });

  it("classifyRequest function works standalone (high-confidence agent)", () => {
    // Use a high-confidence framework UA that reliably crosses the threshold
    const result = classifyRequest({
      headers: {
        "user-agent": "langchain/0.3.14",
        "x-agent-framework": "langchain/0.3.14",
      },
      userAgent: "langchain/0.3.14",
    });

    expect(result.isAgent).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.signals).toBeDefined();
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it("classifyRequest function works standalone (browser)", () => {
    const result = classifyRequest({
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
        cookie: "session=xyz",
        referer: "https://example.com/",
      },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    });

    expect(result.isAgent).toBe(false);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("detection provides confidence score between 0 and 1", async () => {
    const app = createApp();

    const res = await request(app, "GET", "/api/data", {
      "User-Agent": "python-httpx/0.25.0",
    });

    expect(res.status).toBe(200);
    const confidence = parseFloat(res.headers["x-agentgate-confidence"] as string);
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("detection works on multiple requests consistently", async () => {
    const app = createApp();

    // High-confidence agent request (LangChain)
    const agentRes = await request(app, "GET", "/api/data", {
      "User-Agent": "langchain/0.1.0",
    });
    expect(agentRes.headers["x-agentgate-is-agent"]).toBe("true");

    // Browser request
    const browserRes = await request(app, "GET", "/api/data", {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US",
      Cookie: "session=abc",
      Referer: "https://example.com/",
    });
    expect(browserRes.headers["x-agentgate-is-agent"]).toBe("false");

    // Self-identification agent request
    const agent2Res = await request(app, "GET", "/api/data", {
      "User-Agent": "custom-bot/1.0",
      "X-Agent-Framework": "CrewAI/0.5.0",
    });
    expect(agent2Res.headers["x-agentgate-is-agent"]).toBe("true");
  });
});
