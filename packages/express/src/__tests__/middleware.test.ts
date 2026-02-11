import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import * as http from "node:http";
import { agentdoor } from "../index.js";
import {
  MemoryStore,
  generateKeypair,
  signChallenge,
  issueToken,
  hashApiKey,
  verifyToken,
  resolveConfig,
  AGENTDOOR_VERSION,
  API_KEY_PREFIX,
} from "@agentdoor/core";

// ---------------------------------------------------------------------------
// Test helper: make HTTP requests to an Express app without supertest
// ---------------------------------------------------------------------------

async function makeRequest(
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
      const reqHeaders: Record<string, string> = {
        ...headers,
      };
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
            resolve({
              status: res.statusCode!,
              body: parsed,
              headers: res.headers,
            });
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
// Shared test configuration
// ---------------------------------------------------------------------------

const TEST_SCOPES = [
  { id: "test.read", description: "Read test data" },
  { id: "test.write", description: "Write test data" },
];

/**
 * Helper: creates a fresh Express app with agentdoor middleware and a test route.
 * Returns the app, the store, and a helper to perform full registration.
 */
function createTestApp(overrides?: Record<string, unknown>) {
  const store = new MemoryStore();
  const app = express();
  app.use(
    agentdoor({
      scopes: TEST_SCOPES,
      store,
      ...overrides,
    }),
  );

  // A protected test route that returns agent context
  app.get("/api/test", (req, res) => {
    res.json({ isAgent: req.isAgent, agent: req.agent ?? null });
  });

  return { app, store };
}

/**
 * Helper: perform a full two-step registration and return all relevant data.
 */
async function registerAgent(
  app: express.Express,
  scopesRequested: string[] = ["test.read"],
) {
  const keypair = generateKeypair();

  // Step 1: Register
  const regRes = await makeRequest(app, "POST", "/agentdoor/register", {
    public_key: keypair.publicKey,
    scopes_requested: scopesRequested,
  });

  expect(regRes.status).toBe(201);

  const { agent_id, challenge } = regRes.body;

  // Step 2: Sign the challenge and verify
  const signature = signChallenge(challenge.message, keypair.secretKey);

  const verifyRes = await makeRequest(app, "POST", "/agentdoor/register/verify", {
    agent_id,
    signature,
  });

  expect(verifyRes.status).toBe(200);

  return {
    keypair,
    agentId: agent_id as string,
    apiKey: verifyRes.body.api_key as string,
    token: verifyRes.body.token as string,
    scopesGranted: verifyRes.body.scopes_granted as string[],
    challengeMessage: challenge.message as string,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("agentdoor() Express middleware", () => {
  // -------------------------------------------------------------------------
  // Discovery endpoint
  // -------------------------------------------------------------------------

  describe("GET /.well-known/agentdoor.json", () => {
    it("returns 200 with a valid discovery document", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "GET", "/.well-known/agentdoor.json");

      expect(res.status).toBe(200);
      expect(res.body.agentdoor_version).toBe(AGENTDOOR_VERSION);
      expect(res.body.service_name).toEqual(expect.any(String));
      expect(res.body.registration_endpoint).toBe("/agentdoor/register");
      expect(res.body.auth_endpoint).toBe("/agentdoor/auth");
      expect(res.body.auth_methods).toEqual(expect.arrayContaining(["ed25519-challenge", "jwt"]));
    });

    it("includes scopes_available from configuration", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "GET", "/.well-known/agentdoor.json");

      expect(res.body.scopes_available).toHaveLength(2);
      expect(res.body.scopes_available[0]).toMatchObject({
        id: "test.read",
        description: "Read test data",
      });
      expect(res.body.scopes_available[1]).toMatchObject({
        id: "test.write",
        description: "Write test data",
      });
    });

    it("includes rate_limits information", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "GET", "/.well-known/agentdoor.json");

      expect(res.body.rate_limits).toBeDefined();
      expect(res.body.rate_limits.registration).toEqual(expect.any(String));
      expect(res.body.rate_limits.default).toEqual(expect.any(String));
    });

    it("sets proper Content-Type and Cache-Control headers", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "GET", "/.well-known/agentdoor.json");

      expect(res.headers["content-type"]).toContain("application/json");
      expect(res.headers["cache-control"]).toContain("public");
      expect(res.headers["x-agentdoor-version"]).toBe(AGENTDOOR_VERSION);
    });
  });

  // -------------------------------------------------------------------------
  // Health endpoint
  // -------------------------------------------------------------------------

  describe("GET /agentdoor/health", () => {
    it("returns 200 with status healthy", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "GET", "/agentdoor/health");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("healthy");
    });

    it("includes version and uptime info", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "GET", "/agentdoor/health");

      expect(res.body.version).toBe(AGENTDOOR_VERSION);
      expect(res.body.uptime_ms).toEqual(expect.any(Number));
      expect(res.body.uptime_ms).toBeGreaterThanOrEqual(0);
    });

    it("includes a timestamp", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "GET", "/agentdoor/health");

      expect(res.body.timestamp).toEqual(expect.any(String));
      // The timestamp should be a valid ISO 8601 date
      const parsed = new Date(res.body.timestamp);
      expect(parsed.getTime()).not.toBeNaN();
    });

    it("includes storage connectivity status", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "GET", "/agentdoor/health");

      expect(res.body.storage).toBeDefined();
      expect(res.body.storage.status).toBe("connected");
    });
  });

  // -------------------------------------------------------------------------
  // Registration flow
  // -------------------------------------------------------------------------

  describe("POST /agentdoor/register (step 1)", () => {
    it("returns 201 with agent_id and challenge on valid request", async () => {
      const { app } = createTestApp();
      const keypair = generateKeypair();

      const res = await makeRequest(app, "POST", "/agentdoor/register", {
        public_key: keypair.publicKey,
        scopes_requested: ["test.read"],
      });

      expect(res.status).toBe(201);
      expect(res.body.agent_id).toEqual(expect.stringMatching(/^ag_/));
      expect(res.body.challenge).toBeDefined();
      expect(res.body.challenge.nonce).toEqual(expect.any(String));
      expect(res.body.challenge.message).toEqual(expect.any(String));
      expect(res.body.challenge.expires_at).toEqual(expect.any(String));
    });

    it("returns 400 when public_key is missing", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "POST", "/agentdoor/register", {
        scopes_requested: ["test.read"],
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.message).toContain("public_key");
    });

    it("returns 400 when scopes_requested is missing", async () => {
      const { app } = createTestApp();
      const keypair = generateKeypair();

      const res = await makeRequest(app, "POST", "/agentdoor/register", {
        public_key: keypair.publicKey,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.message).toContain("scopes_requested");
    });

    it("returns 400 when scopes_requested is an empty array", async () => {
      const { app } = createTestApp();
      const keypair = generateKeypair();

      const res = await makeRequest(app, "POST", "/agentdoor/register", {
        public_key: keypair.publicKey,
        scopes_requested: [],
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    });

    it("returns 400 when requesting an unknown scope", async () => {
      const { app } = createTestApp();
      const keypair = generateKeypair();

      const res = await makeRequest(app, "POST", "/agentdoor/register", {
        public_key: keypair.publicKey,
        scopes_requested: ["nonexistent.scope"],
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_scopes");
      expect(res.body.available_scopes).toEqual(
        expect.arrayContaining(["test.read", "test.write"]),
      );
    });

    it("returns 409 when public key is already registered", async () => {
      const { app } = createTestApp();

      // Register once
      const reg = await registerAgent(app, ["test.read"]);

      // Try to register the same public key again
      const res = await makeRequest(app, "POST", "/agentdoor/register", {
        public_key: reg.keypair.publicKey,
        scopes_requested: ["test.read"],
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("already_registered");
      expect(res.body.agent_id).toBe(reg.agentId);
    });

    it("challenge message contains the agent_id", async () => {
      const { app } = createTestApp();
      const keypair = generateKeypair();

      const res = await makeRequest(app, "POST", "/agentdoor/register", {
        public_key: keypair.publicKey,
        scopes_requested: ["test.read"],
      });

      expect(res.body.challenge.message).toContain(res.body.agent_id);
      // Challenge format: agentdoor:register:{agent_id}:{timestamp}:{nonce}
      expect(res.body.challenge.message).toMatch(/^agentdoor:register:ag_/);
    });
  });

  describe("POST /agentdoor/register/verify (step 2)", () => {
    it("returns 200 with agent_id, api_key, and token on valid signature", async () => {
      const { app } = createTestApp();
      const keypair = generateKeypair();

      // Step 1
      const regRes = await makeRequest(app, "POST", "/agentdoor/register", {
        public_key: keypair.publicKey,
        scopes_requested: ["test.read"],
      });

      const { agent_id, challenge } = regRes.body;
      const signature = signChallenge(challenge.message, keypair.secretKey);

      // Step 2
      const verifyRes = await makeRequest(
        app,
        "POST",
        "/agentdoor/register/verify",
        { agent_id, signature },
      );

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.agent_id).toBe(agent_id);
      expect(verifyRes.body.api_key).toEqual(expect.stringContaining(API_KEY_PREFIX));
      expect(verifyRes.body.token).toEqual(expect.any(String));
      expect(verifyRes.body.token_expires_at).toEqual(expect.any(String));
      expect(verifyRes.body.scopes_granted).toEqual(["test.read"]);
      expect(verifyRes.body.rate_limit).toBeDefined();
      expect(verifyRes.body.rate_limit.requests).toEqual(expect.any(Number));
      expect(verifyRes.body.rate_limit.window).toEqual(expect.any(String));
    });

    it("returns 400 when agent_id is missing", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "POST", "/agentdoor/register/verify", {
        signature: "bogus",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.message).toContain("agent_id");
    });

    it("returns 400 when signature is missing", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "POST", "/agentdoor/register/verify", {
        agent_id: "ag_test123",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.message).toContain("signature");
    });

    it("returns 404 when agent_id has no pending registration", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "POST", "/agentdoor/register/verify", {
        agent_id: "ag_nonexistent_id_12345",
        signature: "bogus_signature",
      });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("not_found");
    });

    it("returns 400 when signature is invalid", async () => {
      const { app } = createTestApp();
      const keypair = generateKeypair();

      // Step 1
      const regRes = await makeRequest(app, "POST", "/agentdoor/register", {
        public_key: keypair.publicKey,
        scopes_requested: ["test.read"],
      });

      const { agent_id } = regRes.body;

      // Step 2 with wrong signature (sign with a different key)
      const wrongKeypair = generateKeypair();
      const wrongSignature = signChallenge(
        regRes.body.challenge.message,
        wrongKeypair.secretKey,
      );

      const verifyRes = await makeRequest(
        app,
        "POST",
        "/agentdoor/register/verify",
        { agent_id, signature: wrongSignature },
      );

      expect(verifyRes.status).toBe(400);
      expect(verifyRes.body.error).toBe("invalid_signature");
    });

    it("grants multiple scopes when requested", async () => {
      const { app } = createTestApp();

      const reg = await registerAgent(app, ["test.read", "test.write"]);

      expect(reg.scopesGranted).toEqual(["test.read", "test.write"]);
    });

    it("issued token is a valid JWT", async () => {
      const { app } = createTestApp({
        jwt: { secret: "test-secret-that-is-long-enough" },
      });

      const reg = await registerAgent(app, ["test.read"]);

      // Verify the token is decodable
      const result = await verifyToken(
        reg.token,
        "test-secret-that-is-long-enough",
      );
      expect(result.agent.id).toBe(reg.agentId);
      expect(result.agent.scopes).toEqual(["test.read"]);
    });
  });

  // -------------------------------------------------------------------------
  // Full registration flow (end-to-end)
  // -------------------------------------------------------------------------

  describe("Full registration flow (end-to-end)", () => {
    it("completes a full register -> verify cycle", async () => {
      const { app, store } = createTestApp();

      const reg = await registerAgent(app, ["test.read"]);

      // Verify the agent was persisted in the store
      const storedAgent = await store.getAgent(reg.agentId);
      expect(storedAgent).toBeDefined();
      expect(storedAgent!.id).toBe(reg.agentId);
      expect(storedAgent!.publicKey).toBe(reg.keypair.publicKey);
      expect(storedAgent!.scopesGranted).toEqual(["test.read"]);
      expect(storedAgent!.status).toBe("active");
    });

    it("stores the API key hash (not the raw key)", async () => {
      const { app, store } = createTestApp();

      const reg = await registerAgent(app);

      const storedAgent = await store.getAgent(reg.agentId);
      expect(storedAgent).toBeDefined();
      // The stored hash should match the hash of the returned API key
      expect(storedAgent!.apiKeyHash).toBe(hashApiKey(reg.apiKey));
    });

    it("API key can be looked up by hash in the store", async () => {
      const { app, store } = createTestApp();

      const reg = await registerAgent(app);

      const keyHash = hashApiKey(reg.apiKey);
      const agent = await store.getAgentByApiKeyHash(keyHash);
      expect(agent).toBeDefined();
      expect(agent!.id).toBe(reg.agentId);
    });
  });

  // -------------------------------------------------------------------------
  // Auth endpoint (returning agents)
  // -------------------------------------------------------------------------

  describe("POST /agentdoor/auth", () => {
    it("returns 200 with a fresh token on valid auth request", async () => {
      const { app } = createTestApp({
        jwt: { secret: "test-secret-that-is-long-enough" },
      });

      const reg = await registerAgent(app, ["test.read"]);

      // Build auth request: sign "agentdoor:auth:{agent_id}:{timestamp}"
      const timestamp = new Date().toISOString();
      const authMessage = `agentdoor:auth:${reg.agentId}:${timestamp}`;
      const signature = signChallenge(authMessage, reg.keypair.secretKey);

      const authRes = await makeRequest(app, "POST", "/agentdoor/auth", {
        agent_id: reg.agentId,
        timestamp,
        signature,
      });

      expect(authRes.status).toBe(200);
      expect(authRes.body.token).toEqual(expect.any(String));
      expect(authRes.body.expires_at).toEqual(expect.any(String));

      // The new token should be valid
      const result = await verifyToken(
        authRes.body.token,
        "test-secret-that-is-long-enough",
      );
      expect(result.agent.id).toBe(reg.agentId);
    });

    it("returns 400 when agent_id is missing", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "POST", "/agentdoor/auth", {
        timestamp: new Date().toISOString(),
        signature: "bogus",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    });

    it("returns 400 when timestamp is missing", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "POST", "/agentdoor/auth", {
        agent_id: "ag_test",
        signature: "bogus",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    });

    it("returns 400 when signature is missing", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "POST", "/agentdoor/auth", {
        agent_id: "ag_test",
        timestamp: new Date().toISOString(),
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    });

    it("returns 404 when agent_id is not registered", async () => {
      const { app } = createTestApp();

      const timestamp = new Date().toISOString();
      const keypair = generateKeypair();
      const authMessage = `agentdoor:auth:ag_nonexistent:${timestamp}`;
      const signature = signChallenge(authMessage, keypair.secretKey);

      const res = await makeRequest(app, "POST", "/agentdoor/auth", {
        agent_id: "ag_nonexistent",
        timestamp,
        signature,
      });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("agent_not_found");
    });

    it("returns 401 when signature is invalid", async () => {
      const { app } = createTestApp();

      const reg = await registerAgent(app, ["test.read"]);

      const timestamp = new Date().toISOString();
      const wrongKeypair = generateKeypair();
      const authMessage = `agentdoor:auth:${reg.agentId}:${timestamp}`;
      const wrongSignature = signChallenge(authMessage, wrongKeypair.secretKey);

      const authRes = await makeRequest(app, "POST", "/agentdoor/auth", {
        agent_id: reg.agentId,
        timestamp,
        signature: wrongSignature,
      });

      expect(authRes.status).toBe(401);
      expect(authRes.body.error).toBe("invalid_signature");
    });

    it("returns 400 when timestamp is too old", async () => {
      const { app } = createTestApp();

      const reg = await registerAgent(app, ["test.read"]);

      // Use a timestamp from 10 minutes ago (exceeds 5-minute window)
      const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const authMessage = `agentdoor:auth:${reg.agentId}:${oldTimestamp}`;
      const signature = signChallenge(authMessage, reg.keypair.secretKey);

      const authRes = await makeRequest(app, "POST", "/agentdoor/auth", {
        agent_id: reg.agentId,
        timestamp: oldTimestamp,
        signature,
      });

      expect(authRes.status).toBe(400);
      expect(authRes.body.error).toBe("timestamp_invalid");
    });

    it("returns 400 when timestamp is not valid ISO 8601", async () => {
      const { app } = createTestApp();

      const reg = await registerAgent(app, ["test.read"]);

      const authRes = await makeRequest(app, "POST", "/agentdoor/auth", {
        agent_id: reg.agentId,
        timestamp: "not-a-date",
        signature: "bogus",
      });

      expect(authRes.status).toBe(400);
      expect(authRes.body.error).toBe("invalid_request");
    });
  });

  // -------------------------------------------------------------------------
  // Auth guard (API key authentication on custom routes)
  // -------------------------------------------------------------------------

  describe("Auth guard middleware", () => {
    it("sets req.isAgent = false when no Authorization header is present", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "GET", "/api/test");

      expect(res.status).toBe(200);
      expect(res.body.isAgent).toBe(false);
      expect(res.body.agent).toBeNull();
    });

    it("sets req.isAgent = true when a valid API key is in the Authorization header", async () => {
      const { app } = createTestApp();

      const reg = await registerAgent(app, ["test.read"]);

      const res = await makeRequest(app, "GET", "/api/test", undefined, {
        Authorization: `Bearer ${reg.apiKey}`,
      });

      expect(res.status).toBe(200);
      expect(res.body.isAgent).toBe(true);
      expect(res.body.agent).toBeDefined();
      expect(res.body.agent.id).toBe(reg.agentId);
      expect(res.body.agent.scopes).toEqual(["test.read"]);
    });

    it("sets req.isAgent = true when a valid JWT token is in the Authorization header", async () => {
      const { app } = createTestApp({
        jwt: { secret: "test-secret-that-is-long-enough" },
      });

      const reg = await registerAgent(app, ["test.read"]);

      const res = await makeRequest(app, "GET", "/api/test", undefined, {
        Authorization: `Bearer ${reg.token}`,
      });

      expect(res.status).toBe(200);
      expect(res.body.isAgent).toBe(true);
      expect(res.body.agent).toBeDefined();
      expect(res.body.agent.id).toBe(reg.agentId);
    });

    it("sets req.isAgent = false when Authorization header has an invalid API key", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "GET", "/api/test", undefined, {
        Authorization: `Bearer agk_live_invalid_key_that_does_not_exist`,
      });

      expect(res.status).toBe(200);
      expect(res.body.isAgent).toBe(false);
      expect(res.body.agent).toBeNull();
    });

    it("sets req.isAgent = false when Authorization header has an invalid JWT", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "GET", "/api/test", undefined, {
        Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.invalid.token",
      });

      expect(res.status).toBe(200);
      expect(res.body.isAgent).toBe(false);
      expect(res.body.agent).toBeNull();
    });

    it("sets req.isAgent = false when Authorization header is not Bearer", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "GET", "/api/test", undefined, {
        Authorization: "Basic dXNlcjpwYXNz",
      });

      expect(res.status).toBe(200);
      expect(res.body.isAgent).toBe(false);
      expect(res.body.agent).toBeNull();
    });

    it("includes publicKey in agent context", async () => {
      const { app } = createTestApp();

      const reg = await registerAgent(app, ["test.read"]);

      const res = await makeRequest(app, "GET", "/api/test", undefined, {
        Authorization: `Bearer ${reg.apiKey}`,
      });

      expect(res.body.agent.publicKey).toBe(reg.keypair.publicKey);
    });

    it("does not block unauthenticated requests (non-blocking design)", async () => {
      const { app } = createTestApp();

      // Even without auth, the request should proceed to the route handler
      const res = await makeRequest(app, "GET", "/api/test");

      expect(res.status).toBe(200);
      expect(res.body.isAgent).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Auth guard is NOT applied to agentdoor own routes
  // -------------------------------------------------------------------------

  describe("Auth guard skips agentdoor routes", () => {
    it("discovery endpoint works without auth", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "GET", "/.well-known/agentdoor.json");

      expect(res.status).toBe(200);
      expect(res.body.agentdoor_version).toBeDefined();
    });

    it("health endpoint works without auth", async () => {
      const { app } = createTestApp();

      const res = await makeRequest(app, "GET", "/agentdoor/health");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("healthy");
    });

    it("register endpoint works without auth", async () => {
      const { app } = createTestApp();
      const keypair = generateKeypair();

      const res = await makeRequest(app, "POST", "/agentdoor/register", {
        public_key: keypair.publicKey,
        scopes_requested: ["test.read"],
      });

      expect(res.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  // Configuration options
  // -------------------------------------------------------------------------

  describe("Configuration options", () => {
    it("uses custom service name in discovery document", async () => {
      const { app } = createTestApp({
        service: { name: "My Test API", description: "A test API service" },
      });

      const res = await makeRequest(app, "GET", "/.well-known/agentdoor.json");

      expect(res.body.service_name).toBe("My Test API");
      expect(res.body.service_description).toBe("A test API service");
    });

    it("uses the provided store instance", async () => {
      const store = new MemoryStore();
      const app = express();
      app.use(agentdoor({ scopes: TEST_SCOPES, store }));
      app.get("/api/test", (req, res) => {
        res.json({ isAgent: req.isAgent, agent: req.agent ?? null });
      });

      const reg = await registerAgent(app, ["test.read"]);

      // Verify the store has the agent
      const agent = await store.getAgent(reg.agentId);
      expect(agent).toBeDefined();
      expect(agent!.id).toBe(reg.agentId);
    });

    it("disables auth guard when enableAuthGuard is false", async () => {
      const store = new MemoryStore();
      const app = express();
      app.use(
        agentdoor({
          scopes: TEST_SCOPES,
          store,
          enableAuthGuard: false,
        }),
      );
      app.get("/api/test", (req, res) => {
        // When auth guard is disabled, req.isAgent won't be set at all
        res.json({
          isAgent: req.isAgent ?? "undefined",
          agent: req.agent ?? null,
        });
      });

      const reg = await registerAgent(app, ["test.read"]);

      // Even with a valid API key, the auth guard should not be active
      const res = await makeRequest(app, "GET", "/api/test", undefined, {
        Authorization: `Bearer ${reg.apiKey}`,
      });

      expect(res.status).toBe(200);
      // isAgent should not be set (defaults to undefined or whatever Express gives)
      expect(res.body.isAgent).not.toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Multiple agents
  // -------------------------------------------------------------------------

  describe("Multiple agents", () => {
    it("can register and authenticate multiple independent agents", async () => {
      const { app } = createTestApp();

      const agent1 = await registerAgent(app, ["test.read"]);
      const agent2 = await registerAgent(app, ["test.write"]);

      expect(agent1.agentId).not.toBe(agent2.agentId);
      expect(agent1.apiKey).not.toBe(agent2.apiKey);

      // Both should be able to authenticate via API key
      const res1 = await makeRequest(app, "GET", "/api/test", undefined, {
        Authorization: `Bearer ${agent1.apiKey}`,
      });
      const res2 = await makeRequest(app, "GET", "/api/test", undefined, {
        Authorization: `Bearer ${agent2.apiKey}`,
      });

      expect(res1.body.agent.id).toBe(agent1.agentId);
      expect(res1.body.agent.scopes).toEqual(["test.read"]);
      expect(res2.body.agent.id).toBe(agent2.agentId);
      expect(res2.body.agent.scopes).toEqual(["test.write"]);
    });
  });
});
