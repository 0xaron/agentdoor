import { describe, it, expect } from "vitest";
import { createAgentGateWorker, handleRequest, AgentGateDurableObject } from "../index.js";
import type { CloudflareEnv } from "../index.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_SCOPES = [
  { id: "data.read", description: "Read data" },
  { id: "data.write", description: "Write data" },
];

function createHandler(opts: Record<string, unknown> = {}) {
  return createAgentGateWorker({
    scopes: TEST_SCOPES,
    ...opts,
  });
}

function makeRequest(method: string, path: string, body?: unknown, headers?: Record<string, string>): Request {
  const url = `https://worker.example.com${path}`;
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

const mockEnv: CloudflareEnv = {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("@agentgate/cloudflare worker", () => {
  describe("discovery endpoint", () => {
    it("serves /.well-known/agentgate.json", async () => {
      const handler = createHandler();
      const req = makeRequest("GET", "/.well-known/agentgate.json");
      const res = await handler(req, mockEnv);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.agentgate_version).toBe("1.0");
      expect(body.service_name).toBe("AgentGate Service");
      expect(body.registration_endpoint).toBe("/agentgate/register");
      expect(body.auth_endpoint).toBe("/agentgate/auth");
      expect(body.scopes_available).toHaveLength(2);
      expect(body.scopes_available[0].id).toBe("data.read");
      expect(body.auth_methods).toContain("ed25519-challenge");
    });

    it("includes Cache-Control header", async () => {
      const handler = createHandler();
      const req = makeRequest("GET", "/.well-known/agentgate.json");
      const res = await handler(req, mockEnv);

      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    });

    it("includes custom service metadata in discovery", async () => {
      const handler = createHandler({
        service: { name: "My Worker", description: "A test worker" },
      });
      const req = makeRequest("GET", "/.well-known/agentgate.json");
      const res = await handler(req, mockEnv);
      const body = await res.json();

      expect(body.service_name).toBe("My Worker");
      expect(body.service_description).toBe("A test worker");
    });
  });

  describe("registration validation", () => {
    it("rejects missing public_key", async () => {
      const handler = createHandler();
      const req = makeRequest("POST", "/agentgate/register", {
        scopes_requested: ["data.read"],
      });
      const res = await handler(req, mockEnv);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("public_key");
    });

    it("rejects missing scopes_requested", async () => {
      const handler = createHandler();
      const req = makeRequest("POST", "/agentgate/register", {
        public_key: "dGVzdHB1YmtleQ==",
      });
      const res = await handler(req, mockEnv);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("scopes_requested");
    });

    it("rejects empty scopes_requested array", async () => {
      const handler = createHandler();
      const req = makeRequest("POST", "/agentgate/register", {
        public_key: "dGVzdHB1YmtleQ==",
        scopes_requested: [],
      });
      const res = await handler(req, mockEnv);

      expect(res.status).toBe(400);
    });

    it("rejects invalid scopes", async () => {
      const handler = createHandler();
      const req = makeRequest("POST", "/agentgate/register", {
        public_key: "Y2xvdWRmbGFyZXRlc3RrZXk=",
        scopes_requested: ["nonexistent.scope"],
      });
      const res = await handler(req, mockEnv);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid scopes");
    });

    it("accepts valid registration and returns challenge", async () => {
      const handler = createHandler();
      const req = makeRequest("POST", "/agentgate/register", {
        public_key: "Y2xvdWRmbGFyZXJlZ3Rlc3Q=",
        scopes_requested: ["data.read"],
        metadata: { framework: "test" },
      });
      const res = await handler(req, mockEnv);

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.agent_id).toMatch(/^ag_/);
      expect(body.challenge).toBeDefined();
      expect(body.challenge.nonce).toBeDefined();
      expect(body.challenge.message).toContain("agentgate:register:");
      expect(body.challenge.expires_at).toBeDefined();
    });

    it("rejects invalid JSON body", async () => {
      const handler = createHandler();
      const req = new Request("https://worker.example.com/agentgate/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json{{{",
      });
      const res = await handler(req, mockEnv);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid JSON body");
    });
  });

  describe("auth validation", () => {
    it("rejects missing fields on /agentgate/auth", async () => {
      const handler = createHandler();
      const req = makeRequest("POST", "/agentgate/auth", {
        agent_id: "ag_test",
      });
      const res = await handler(req, mockEnv);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("agent_id, signature, and timestamp are required");
    });

    it("rejects unknown agent_id on /agentgate/auth", async () => {
      const handler = createHandler();
      const req = makeRequest("POST", "/agentgate/auth", {
        agent_id: "ag_doesnotexist12345678",
        signature: "dGVzdHNpZw==",
        timestamp: new Date().toISOString(),
      });
      const res = await handler(req, mockEnv);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("Unknown agent_id");
    });
  });

  describe("verify validation", () => {
    it("rejects missing fields on /agentgate/register/verify", async () => {
      const handler = createHandler();
      const req = makeRequest("POST", "/agentgate/register/verify", {
        agent_id: "ag_test",
      });
      const res = await handler(req, mockEnv);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("agent_id and signature are required");
    });

    it("rejects unknown agent_id on /agentgate/register/verify", async () => {
      const handler = createHandler();
      const req = makeRequest("POST", "/agentgate/register/verify", {
        agent_id: "ag_doesnotexist12345678",
        signature: "dGVzdHNpZw==",
      });
      const res = await handler(req, mockEnv);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("Unknown agent_id or challenge not found");
    });
  });

  describe("auth guard", () => {
    it("returns 401 for protected path without auth header", async () => {
      const handler = createHandler();
      const req = makeRequest("GET", "/api/protected");
      const res = await handler(req, mockEnv);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Authorization header required");
    });

    it("returns 401 for protected path with invalid token", async () => {
      const handler = createHandler();
      const req = makeRequest("GET", "/api/protected", undefined, {
        authorization: "Bearer invalid_token_xyz",
      });
      const res = await handler(req, mockEnv);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Invalid or expired token");
    });

    it("returns 404 for non-AgentGate non-protected routes", async () => {
      const handler = createHandler();
      const req = makeRequest("GET", "/public/page");
      const res = await handler(req, mockEnv);

      expect(res.status).toBe(404);
    });
  });

  describe("passthrough mode", () => {
    it("returns passthrough response for protected path without auth", async () => {
      const handler = createHandler({ passthrough: true });
      const req = makeRequest("GET", "/api/protected");
      const res = await handler(req, mockEnv);

      expect(res.status).toBe(200);
      expect(res.headers.get("x-agentgate-authenticated")).toBe("false");
    });

    it("returns passthrough response for protected path with invalid token", async () => {
      const handler = createHandler({ passthrough: true });
      const req = makeRequest("GET", "/api/protected", undefined, {
        authorization: "Bearer invalid_token",
      });
      const res = await handler(req, mockEnv);

      expect(res.status).toBe(200);
      expect(res.headers.get("x-agentgate-authenticated")).toBe("false");
    });
  });

  describe("handleRequest direct usage", () => {
    it("works when called directly with env and config", async () => {
      const req = makeRequest("GET", "/.well-known/agentgate.json");
      const res = await handleRequest(req, mockEnv, {
        scopes: TEST_SCOPES,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.agentgate_version).toBe("1.0");
    });
  });

  describe("AgentGateDurableObject", () => {
    it("exports the AgentGateDurableObject class", () => {
      expect(AgentGateDurableObject).toBeDefined();
      expect(typeof AgentGateDurableObject).toBe("function");
    });

    it("instantiates with a mock state", () => {
      const mockStorage = {
        get: async () => undefined,
        put: async () => {},
        delete: async () => true,
        list: async () => new Map(),
      };
      const obj = new AgentGateDurableObject({ storage: mockStorage });
      expect(obj).toBeDefined();
    });

    it("handles /do/agent/get for missing agent", async () => {
      const mockStorage = {
        get: async () => undefined,
        put: async () => {},
        delete: async () => true,
        list: async () => new Map(),
      };
      const obj = new AgentGateDurableObject({ storage: mockStorage });

      const req = new Request("https://do.internal/do/agent/get", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "ag_nonexistent" }),
      });

      const res = await obj.fetch(req);
      expect(res.status).toBe(404);
    });

    it("handles /do/challenge/set and /do/challenge/get", async () => {
      const store = new Map<string, unknown>();
      const mockStorage = {
        get: async (key: string) => store.get(key),
        put: async (key: string, value: unknown) => { store.set(key, value); },
        delete: async (key: string) => store.delete(key),
        list: async () => new Map(),
      };
      const obj = new AgentGateDurableObject({ storage: mockStorage });

      const challenge = {
        nonce: "test-nonce",
        message: "test-message",
        publicKey: "test-key",
        scopesRequested: ["data.read"],
        metadata: {},
        expiresAt: Date.now() + 60000,
      };

      // Set challenge.
      const setReq = new Request("https://do.internal/do/challenge/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "ag_test123", challenge }),
      });
      const setRes = await obj.fetch(setReq);
      expect(setRes.status).toBe(200);

      // Get challenge.
      const getReq = new Request("https://do.internal/do/challenge/get", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "ag_test123" }),
      });
      const getRes = await obj.fetch(getReq);
      expect(getRes.status).toBe(200);
      const getBody = await getRes.json();
      expect(getBody.nonce).toBe("test-nonce");
    });

    it("returns 404 for unknown DO paths", async () => {
      const mockStorage = {
        get: async () => undefined,
        put: async () => {},
        delete: async () => true,
        list: async () => new Map(),
      };
      const obj = new AgentGateDurableObject({ storage: mockStorage });

      const req = new Request("https://do.internal/do/unknown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await obj.fetch(req);
      expect(res.status).toBe(404);
    });
  });
});
