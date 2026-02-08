import { describe, it, expect, beforeAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { agentgatePlugin } from "../index.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_SCOPES = [
  { id: "data.read", description: "Read data" },
  { id: "data.write", description: "Write data" },
];

function createApp(opts: Record<string, unknown> = {}): FastifyInstance {
  const app = Fastify();
  app.register(agentgatePlugin, {
    scopes: TEST_SCOPES,
    ...opts,
  });

  // Add a test route in the protected /api path.
  app.get("/api/protected", async (request) => {
    return {
      isAgent: request.isAgent,
      agentId: request.agent?.id ?? null,
    };
  });

  // Add a non-protected route.
  app.get("/public", async (request) => {
    return {
      isAgent: request.isAgent,
      message: "public",
    };
  });

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("@agentgate/fastify plugin", () => {
  describe("discovery endpoint", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = createApp();
      await app.ready();
    });

    it("serves /.well-known/agentgate.json", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/.well-known/agentgate.json",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.agentgate_version).toBe("1.0");
      expect(body.service_name).toBe("AgentGate Service");
      expect(body.registration_endpoint).toBe("/agentgate/register");
      expect(body.auth_endpoint).toBe("/agentgate/auth");
      expect(body.scopes_available).toHaveLength(2);
      expect(body.scopes_available[0].id).toBe("data.read");
      expect(body.auth_methods).toContain("ed25519-challenge");
    });

    it("includes Cache-Control header", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/.well-known/agentgate.json",
      });

      expect(res.headers["cache-control"]).toBe("public, max-age=3600");
    });
  });

  describe("registration validation", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = createApp();
      await app.ready();
    });

    it("rejects missing public_key", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/agentgate/register",
        payload: { scopes_requested: ["data.read"] },
      });

      expect(res.statusCode).toBe(400);
    });

    it("rejects missing scopes_requested", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/agentgate/register",
        payload: { public_key: "dGVzdHB1YmtleQ==" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("rejects empty scopes_requested array", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/agentgate/register",
        payload: {
          public_key: "dGVzdHB1YmtleQ==",
          scopes_requested: [],
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("rejects invalid scopes", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/agentgate/register",
        payload: {
          public_key: "dGVzdHB1YmtleXVuaXF1ZTE=",
          scopes_requested: ["nonexistent.scope"],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toContain("Invalid scopes");
    });

    it("accepts valid registration and returns challenge", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/agentgate/register",
        payload: {
          public_key: "cmVnaXN0cmF0aW9udGVzdGtleQ==",
          scopes_requested: ["data.read"],
          metadata: { framework: "test" },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.agent_id).toMatch(/^ag_/);
      expect(body.challenge).toBeDefined();
      expect(body.challenge.nonce).toBeDefined();
      expect(body.challenge.message).toContain("agentgate:register:");
      expect(body.challenge.expires_at).toBeDefined();
    });
  });

  describe("auth validation", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = createApp();
      await app.ready();
    });

    it("rejects missing fields on /agentgate/auth", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/agentgate/auth",
        payload: { agent_id: "ag_test" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("rejects unknown agent_id on /agentgate/auth", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/agentgate/auth",
        payload: {
          agent_id: "ag_doesnotexist12345678",
          signature: "dGVzdHNpZw==",
          timestamp: new Date().toISOString(),
        },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBe("Unknown agent_id");
    });
  });

  describe("verify validation", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = createApp();
      await app.ready();
    });

    it("rejects missing fields on /agentgate/register/verify", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/agentgate/register/verify",
        payload: { agent_id: "ag_test" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("rejects unknown agent_id on /agentgate/register/verify", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/agentgate/register/verify",
        payload: {
          agent_id: "ag_doesnotexist12345678",
          signature: "dGVzdHNpZw==",
        },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBe("Unknown agent_id or challenge not found");
    });
  });

  describe("auth guard", () => {
    it("returns 401 for protected path without auth header", async () => {
      const app = createApp();
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/api/protected",
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error).toBe("Authorization header required");
    });

    it("returns 401 for protected path with invalid token", async () => {
      const app = createApp();
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/api/protected",
        headers: { authorization: "Bearer invalid_token_xyz" },
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error).toBe("Invalid or expired token");
    });

    it("allows non-protected paths without auth", async () => {
      const app = createApp();
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/public",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.isAgent).toBe(false);
      expect(body.message).toBe("public");
    });
  });

  describe("passthrough mode", () => {
    it("allows unauthenticated requests to protected paths when passthrough is true", async () => {
      const app = createApp({ passthrough: true });
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/api/protected",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.isAgent).toBe(false);
      expect(body.agentId).toBeNull();
    });

    it("allows requests with invalid token in passthrough mode", async () => {
      const app = createApp({ passthrough: true });
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/api/protected",
        headers: { authorization: "Bearer invalid_token" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.isAgent).toBe(false);
    });
  });
});
