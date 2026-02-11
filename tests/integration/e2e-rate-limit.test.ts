/**
 * Integration / E2E tests for rate limiting.
 *
 * Tests the full rate limiting flow: register an agent, make requests
 * until the rate limit is exceeded, and verify 429 responses.
 *
 * Uses Express with the RateLimiter from core integrated into the
 * application handler, simulating real-world rate limiting behavior.
 */

import { describe, it, expect } from "vitest";
import express from "express";
import * as http from "node:http";
import { agentdoor } from "@agentdoor/express";
import {
  MemoryStore,
  generateKeypair,
  signChallenge,
  RateLimiter,
} from "@agentdoor/core";

// ---------------------------------------------------------------------------
// HTTP request helper
// ---------------------------------------------------------------------------

async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      const bodyStr = body ? JSON.stringify(body) : undefined;
      const reqHeaders: Record<string, string> = { ...headers };
      if (bodyStr) {
        reqHeaders["Content-Type"] = "application/json";
        reqHeaders["Content-Length"] = Buffer.byteLength(bodyStr).toString();
      }

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
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  });
}

// ---------------------------------------------------------------------------
// Shared config
// ---------------------------------------------------------------------------

const TEST_SCOPES = [
  { id: "data.read", description: "Read data" },
];

function createAppWithRateLimit(maxRequests: number) {
  const store = new MemoryStore();
  const limiter = new RateLimiter({ requests: maxRequests, window: "1h" }, 0);
  const app = express();

  app.use(
    agentdoor({
      scopes: TEST_SCOPES,
      store,
      service: { name: "Rate Limit Test API" },
      rateLimit: { requests: maxRequests, window: "1h" },
    }),
  );

  // Route that enforces rate limiting for agents
  app.get("/api/data", (req, res) => {
    if (req.isAgent && req.agent) {
      const result = limiter.check(req.agent.id);
      if (!result.allowed) {
        res
          .status(429)
          .set("Retry-After", String(Math.ceil((result.retryAfter ?? 0) / 1000)))
          .set("X-RateLimit-Limit", String(result.limit))
          .set("X-RateLimit-Remaining", String(result.remaining))
          .json({
            error: "Rate limit exceeded",
            retry_after_ms: result.retryAfter,
            limit: result.limit,
            remaining: result.remaining,
          });
        return;
      }
      res
        .set("X-RateLimit-Limit", String(result.limit))
        .set("X-RateLimit-Remaining", String(result.remaining))
        .json({ isAgent: true, ok: true, remaining: result.remaining });
      return;
    }
    res.json({ isAgent: false, ok: true });
  });

  return { app, store, limiter };
}

async function registerAgent(
  app: express.Express,
  scopes: string[] = ["data.read"],
) {
  const keypair = generateKeypair();
  const regRes = await request(app, "POST", "/agentdoor/register", {
    public_key: keypair.publicKey,
    scopes_requested: scopes,
    metadata: { framework: "vitest" },
  });
  expect(regRes.status).toBe(201);

  const { agent_id, challenge } = regRes.body;
  const signature = signChallenge(challenge.message, keypair.secretKey);
  const verifyRes = await request(app, "POST", "/agentdoor/register/verify", {
    agent_id,
    signature,
  });
  expect(verifyRes.status).toBe(200);

  return {
    agentId: agent_id as string,
    apiKey: verifyRes.body.api_key as string,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("AgentDoor E2E: Rate Limiting", () => {
  it("allows requests within the rate limit", async () => {
    const { app } = createAppWithRateLimit(5);
    const { apiKey } = await registerAgent(app);

    const res = await request(app, "GET", "/api/data", undefined, {
      Authorization: `Bearer ${apiKey}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.isAgent).toBe(true);
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
  });

  it("returns 429 after exceeding the rate limit", async () => {
    const { app } = createAppWithRateLimit(3);
    const { apiKey } = await registerAgent(app);

    // Make 3 requests (within limit)
    for (let i = 0; i < 3; i++) {
      const res = await request(app, "GET", "/api/data", undefined, {
        Authorization: `Bearer ${apiKey}`,
      });
      expect(res.status).toBe(200);
    }

    // 4th request should be rate limited
    const res = await request(app, "GET", "/api/data", undefined, {
      Authorization: `Bearer ${apiKey}`,
    });
    expect(res.status).toBe(429);
    expect(res.body.error).toContain("Rate limit exceeded");
    expect(res.body.retry_after_ms).toBeDefined();
    expect(res.headers["retry-after"]).toBeDefined();
    expect(res.headers["x-ratelimit-limit"]).toBe("3");
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("rate limits are per-agent (different agents have separate buckets)", async () => {
    const { app } = createAppWithRateLimit(2);
    const agent1 = await registerAgent(app);
    const agent2 = await registerAgent(app);

    // Exhaust agent1's limit
    for (let i = 0; i < 2; i++) {
      const res = await request(app, "GET", "/api/data", undefined, {
        Authorization: `Bearer ${agent1.apiKey}`,
      });
      expect(res.status).toBe(200);
    }

    // agent1 is now rate limited
    const res1 = await request(app, "GET", "/api/data", undefined, {
      Authorization: `Bearer ${agent1.apiKey}`,
    });
    expect(res1.status).toBe(429);

    // agent2 should still be able to make requests
    const res2 = await request(app, "GET", "/api/data", undefined, {
      Authorization: `Bearer ${agent2.apiKey}`,
    });
    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
  });

  it("non-agent requests are not rate limited", async () => {
    const { app } = createAppWithRateLimit(1);

    // Non-agent requests should always work
    for (let i = 0; i < 5; i++) {
      const res = await request(app, "GET", "/api/data");
      expect(res.status).toBe(200);
      expect(res.body.isAgent).toBe(false);
    }
  });

  it("rate limit info is included in verification response", async () => {
    const store = new MemoryStore();
    const app = express();
    app.use(
      agentdoor({
        scopes: TEST_SCOPES,
        store,
        service: { name: "Rate Limit Test" },
        rateLimit: { requests: 500, window: "1h" },
      }),
    );

    const keypair = generateKeypair();
    const regRes = await request(app, "POST", "/agentdoor/register", {
      public_key: keypair.publicKey,
      scopes_requested: ["data.read"],
    });
    const { agent_id, challenge } = regRes.body;
    const signature = signChallenge(challenge.message, keypair.secretKey);

    const verifyRes = await request(app, "POST", "/agentdoor/register/verify", {
      agent_id,
      signature,
    });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.rate_limit).toBeDefined();
    expect(verifyRes.body.rate_limit.requests).toBe(500);
    expect(verifyRes.body.rate_limit.window).toBe("1h");
  });

  it("rate limit info is included in the discovery document", async () => {
    const app = express();
    app.use(
      agentdoor({
        scopes: TEST_SCOPES,
        service: { name: "Rate Limit Test" },
        rateLimit: { requests: 200, window: "1h" },
      }),
    );

    const res = await request(app, "GET", "/.well-known/agentdoor.json");
    expect(res.status).toBe(200);
    expect(res.body.rate_limits).toBeDefined();
    expect(res.body.rate_limits.default).toBe("200/1h");
  });
});
