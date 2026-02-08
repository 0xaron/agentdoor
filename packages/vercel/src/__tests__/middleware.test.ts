import { describe, it, expect } from "vitest";
import { createEdgeMiddleware } from "../index.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_SCOPES = [
  { id: "data.read", description: "Read data" },
  { id: "data.write", description: "Write data" },
];

function createMiddleware(opts: Record<string, unknown> = {}) {
  return createEdgeMiddleware({
    scopes: TEST_SCOPES,
    ...opts,
  });
}

function makeRequest(method: string, path: string, body?: unknown, headers?: Record<string, string>): Request {
  const url = `https://example.com${path}`;
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  };
  if (body) {
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("@agentgate/vercel edge middleware", () => {
  describe("discovery endpoint", () => {
    it("serves /.well-known/agentgate.json", async () => {
      const middleware = createMiddleware();
      const req = makeRequest("GET", "/.well-known/agentgate.json");
      const res = await middleware(req);

      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);

      const body = await res!.json();
      expect(body.agentgate_version).toBe("1.0");
      expect(body.service_name).toBe("AgentGate Service");
      expect(body.registration_endpoint).toBe("/agentgate/register");
      expect(body.auth_endpoint).toBe("/agentgate/auth");
      expect(body.scopes_available).toHaveLength(2);
      expect(body.scopes_available[0].id).toBe("data.read");
      expect(body.auth_methods).toContain("ed25519-challenge");
    });

    it("includes Cache-Control header", async () => {
      const middleware = createMiddleware();
      const req = makeRequest("GET", "/.well-known/agentgate.json");
      const res = await middleware(req);

      expect(res!.headers.get("cache-control")).toBe("public, max-age=3600");
    });

    it("includes custom service name in discovery", async () => {
      const middleware = createMiddleware({
        service: { name: "My Service", description: "Test service" },
      });
      const req = makeRequest("GET", "/.well-known/agentgate.json");
      const res = await middleware(req);
      const body = await res!.json();

      expect(body.service_name).toBe("My Service");
      expect(body.service_description).toBe("Test service");
    });
  });

  describe("registration validation", () => {
    it("rejects missing public_key", async () => {
      const middleware = createMiddleware();
      const req = makeRequest("POST", "/agentgate/register", {
        scopes_requested: ["data.read"],
      });
      const res = await middleware(req);

      expect(res!.status).toBe(400);
      const body = await res!.json();
      expect(body.error).toContain("public_key");
    });

    it("rejects missing scopes_requested", async () => {
      const middleware = createMiddleware();
      const req = makeRequest("POST", "/agentgate/register", {
        public_key: "dGVzdHB1YmtleQ==",
      });
      const res = await middleware(req);

      expect(res!.status).toBe(400);
      const body = await res!.json();
      expect(body.error).toContain("scopes_requested");
    });

    it("rejects empty scopes_requested array", async () => {
      const middleware = createMiddleware();
      const req = makeRequest("POST", "/agentgate/register", {
        public_key: "dGVzdHB1YmtleQ==",
        scopes_requested: [],
      });
      const res = await middleware(req);

      expect(res!.status).toBe(400);
    });

    it("rejects invalid scopes", async () => {
      const middleware = createMiddleware();
      const req = makeRequest("POST", "/agentgate/register", {
        public_key: "dGVzdHB1YmtleXVuaXF1ZTE=",
        scopes_requested: ["nonexistent.scope"],
      });
      const res = await middleware(req);

      expect(res!.status).toBe(400);
      const body = await res!.json();
      expect(body.error).toContain("Invalid scopes");
    });

    it("accepts valid registration and returns challenge", async () => {
      const middleware = createMiddleware();
      const req = makeRequest("POST", "/agentgate/register", {
        public_key: "cmVnaXN0cmF0aW9udGVzdGtleTI=",
        scopes_requested: ["data.read"],
        metadata: { framework: "test" },
      });
      const res = await middleware(req);

      expect(res!.status).toBe(201);
      const body = await res!.json();
      expect(body.agent_id).toMatch(/^ag_/);
      expect(body.challenge).toBeDefined();
      expect(body.challenge.nonce).toBeDefined();
      expect(body.challenge.message).toContain("agentgate:register:");
      expect(body.challenge.expires_at).toBeDefined();
    });

    it("rejects invalid JSON body", async () => {
      const middleware = createMiddleware();
      const req = new Request("https://example.com/agentgate/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json{{{",
      });
      const res = await middleware(req);

      expect(res!.status).toBe(400);
      const body = await res!.json();
      expect(body.error).toBe("Invalid JSON body");
    });
  });

  describe("auth validation", () => {
    it("rejects missing fields on /agentgate/auth", async () => {
      const middleware = createMiddleware();
      const req = makeRequest("POST", "/agentgate/auth", {
        agent_id: "ag_test",
      });
      const res = await middleware(req);

      expect(res!.status).toBe(400);
      const body = await res!.json();
      expect(body.error).toContain("agent_id, signature, and timestamp are required");
    });

    it("rejects unknown agent_id on /agentgate/auth", async () => {
      const middleware = createMiddleware();
      const req = makeRequest("POST", "/agentgate/auth", {
        agent_id: "ag_doesnotexist12345678",
        signature: "dGVzdHNpZw==",
        timestamp: new Date().toISOString(),
      });
      const res = await middleware(req);

      expect(res!.status).toBe(404);
      const body = await res!.json();
      expect(body.error).toBe("Unknown agent_id");
    });
  });

  describe("verify validation", () => {
    it("rejects missing fields on /agentgate/register/verify", async () => {
      const middleware = createMiddleware();
      const req = makeRequest("POST", "/agentgate/register/verify", {
        agent_id: "ag_test",
      });
      const res = await middleware(req);

      expect(res!.status).toBe(400);
      const body = await res!.json();
      expect(body.error).toContain("agent_id and signature are required");
    });

    it("rejects unknown agent_id on /agentgate/register/verify", async () => {
      const middleware = createMiddleware();
      const req = makeRequest("POST", "/agentgate/register/verify", {
        agent_id: "ag_doesnotexist12345678",
        signature: "dGVzdHNpZw==",
      });
      const res = await middleware(req);

      expect(res!.status).toBe(404);
      const body = await res!.json();
      expect(body.error).toBe("Unknown agent_id or challenge not found");
    });
  });

  describe("auth guard", () => {
    it("returns 401 for protected path without auth header", async () => {
      const middleware = createMiddleware();
      const req = makeRequest("GET", "/api/protected");
      const res = await middleware(req);

      expect(res!.status).toBe(401);
      const body = await res!.json();
      expect(body.error).toBe("Authorization header required");
    });

    it("returns 401 for protected path with invalid token", async () => {
      const middleware = createMiddleware();
      const req = makeRequest("GET", "/api/protected", undefined, {
        authorization: "Bearer invalid_token_xyz",
      });
      const res = await middleware(req);

      expect(res!.status).toBe(401);
      const body = await res!.json();
      expect(body.error).toBe("Invalid or expired token");
    });

    it("returns null for non-protected paths (passthrough to origin)", async () => {
      const middleware = createMiddleware();
      const req = makeRequest("GET", "/public/page");
      const res = await middleware(req);

      expect(res).toBeNull();
    });
  });

  describe("passthrough mode", () => {
    it("returns passthrough response for protected path without auth", async () => {
      const middleware = createMiddleware({ passthrough: true });
      const req = makeRequest("GET", "/api/protected");
      const res = await middleware(req);

      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      expect(res!.headers.get("x-agentgate-authenticated")).toBe("false");
    });

    it("returns passthrough response for protected path with invalid token", async () => {
      const middleware = createMiddleware({ passthrough: true });
      const req = makeRequest("GET", "/api/protected", undefined, {
        authorization: "Bearer invalid_token",
      });
      const res = await middleware(req);

      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      expect(res!.headers.get("x-agentgate-authenticated")).toBe("false");
    });
  });
});
