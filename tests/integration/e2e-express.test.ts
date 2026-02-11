/**
 * Integration / E2E tests for the AgentDoor Express middleware.
 *
 * These tests exercise the complete agent lifecycle:
 *   Discovery -> Register -> Verify -> Auth Guard -> Authenticated Request -> Re-Auth
 *
 * They use the real MemoryStore and crypto to test the full stack.
 */

import { describe, it, expect } from "vitest";
import express from "express";
import * as http from "node:http";
import { agentdoor } from "@agentdoor/express";
import {
  MemoryStore,
  generateKeypair,
  signChallenge,
} from "@agentdoor/core";

// ---------------------------------------------------------------------------
// Test helper: make HTTP requests
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
  { id: "data.write", description: "Write data" },
  { id: "analytics.read", description: "Read analytics" },
];

function createApp(overrides?: Record<string, unknown>) {
  const store = new MemoryStore();
  const app = express();
  app.use(
    agentdoor({
      scopes: TEST_SCOPES,
      store,
      service: { name: "Integration Test API", description: "E2E test service" },
      ...overrides,
    }),
  );
  app.get("/api/data", (req, res) => {
    res.json({ isAgent: req.isAgent, agent: req.agent ?? null, ok: true });
  });
  app.post("/api/data", (req, res) => {
    res.json({ isAgent: req.isAgent, ok: true });
  });
  return { app, store };
}

async function fullRegistration(
  app: express.Express,
  scopes: string[] = ["data.read"],
) {
  const keypair = generateKeypair();

  const regRes = await request(app, "POST", "/agentdoor/register", {
    public_key: keypair.publicKey,
    scopes_requested: scopes,
    metadata: { framework: "vitest", version: "1.0.0", name: "E2E Test Agent" },
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
    keypair,
    agentId: agent_id as string,
    apiKey: verifyRes.body.api_key as string,
    token: verifyRes.body.token as string,
    scopesGranted: verifyRes.body.scopes_granted as string[],
  };
}

// ===========================================================================
// Integration Tests
// ===========================================================================

describe("AgentDoor E2E: Full Agent Lifecycle", () => {
  it("completes the full lifecycle: discovery -> register -> verify -> auth guard -> re-auth", async () => {
    const { app, store } = createApp();
    const keypair = generateKeypair();

    // 1. Discovery
    const discovery = await request(app, "GET", "/.well-known/agentdoor.json");
    expect(discovery.status).toBe(200);
    expect(discovery.body.agentdoor_version).toBe("1.0");
    expect(discovery.body.service_name).toBe("Integration Test API");
    expect(discovery.body.scopes_available).toHaveLength(3);

    // 2. Register
    const regRes = await request(app, "POST", "/agentdoor/register", {
      public_key: keypair.publicKey,
      scopes_requested: ["data.read", "data.write"],
      metadata: { framework: "vitest", version: "1.0.0" },
    });
    expect(regRes.status).toBe(201);
    const { agent_id, challenge } = regRes.body;

    // 3. Verify
    const sig = signChallenge(challenge.message, keypair.secretKey);
    const verifyRes = await request(app, "POST", "/agentdoor/register/verify", {
      agent_id,
      signature: sig,
    });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.api_key).toBeDefined();
    expect(verifyRes.body.scopes_granted).toEqual(["data.read", "data.write"]);

    // 4. Auth guard with API key
    const apiRes = await request(app, "GET", "/api/data", undefined, {
      Authorization: `Bearer ${verifyRes.body.api_key}`,
    });
    expect(apiRes.status).toBe(200);
    expect(apiRes.body.isAgent).toBe(true);
    expect(apiRes.body.agent.id).toBe(agent_id);
    expect(apiRes.body.agent.scopes).toEqual(["data.read", "data.write"]);

    // 5. Re-auth with signature
    const ts = new Date().toISOString();
    const authMsg = `agentdoor:auth:${agent_id}:${ts}`;
    const authSig = signChallenge(authMsg, keypair.secretKey);
    const authRes = await request(app, "POST", "/agentdoor/auth", {
      agent_id,
      timestamp: ts,
      signature: authSig,
    });
    expect(authRes.status).toBe(200);
    expect(authRes.body.token).toBeDefined();
    expect(authRes.body.expires_at).toBeDefined();

    // 6. Verify agent persisted in store
    const stored = await store.getAgent(agent_id);
    expect(stored).toBeDefined();
    expect(stored!.publicKey).toBe(keypair.publicKey);
    expect(stored!.scopesGranted).toEqual(["data.read", "data.write"]);
  });

  it("rejects requests from unregistered agents at auth guard", async () => {
    const { app } = createApp();

    const res = await request(app, "GET", "/api/data", undefined, {
      Authorization: "Bearer agk_live_bogus_key_12345678901234567",
    });
    expect(res.status).toBe(200);
    expect(res.body.isAgent).toBe(false);
  });

  it("multiple agents can coexist independently", async () => {
    const { app, store } = createApp();

    const agent1 = await fullRegistration(app, ["data.read"]);
    const agent2 = await fullRegistration(app, ["data.write"]);
    const agent3 = await fullRegistration(app, ["data.read", "analytics.read"]);

    // Each agent should have unique IDs and keys
    const ids = new Set([agent1.agentId, agent2.agentId, agent3.agentId]);
    expect(ids.size).toBe(3);

    // Each should authenticate with their own keys
    const res1 = await request(app, "GET", "/api/data", undefined, {
      Authorization: `Bearer ${agent1.apiKey}`,
    });
    const res2 = await request(app, "GET", "/api/data", undefined, {
      Authorization: `Bearer ${agent2.apiKey}`,
    });

    expect(res1.body.agent.scopes).toEqual(["data.read"]);
    expect(res2.body.agent.scopes).toEqual(["data.write"]);
  });

  it("duplicate public key registration returns 409", async () => {
    const { app } = createApp();
    const keypair = generateKeypair();

    // First registration succeeds
    const reg1 = await request(app, "POST", "/agentdoor/register", {
      public_key: keypair.publicKey,
      scopes_requested: ["data.read"],
    });
    expect(reg1.status).toBe(201);

    // Verify it
    const sig = signChallenge(reg1.body.challenge.message, keypair.secretKey);
    await request(app, "POST", "/agentdoor/register/verify", {
      agent_id: reg1.body.agent_id,
      signature: sig,
    });

    // Second registration with same key returns 409
    const reg2 = await request(app, "POST", "/agentdoor/register", {
      public_key: keypair.publicKey,
      scopes_requested: ["data.write"],
    });
    expect(reg2.status).toBe(409);
    expect(reg2.body.agent_id).toBe(reg1.body.agent_id);
  });

  it("agent metadata is preserved through registration", async () => {
    const { app, store } = createApp();
    const keypair = generateKeypair();

    const regRes = await request(app, "POST", "/agentdoor/register", {
      public_key: keypair.publicKey,
      scopes_requested: ["data.read"],
      metadata: { framework: "LangChain", version: "0.3.14", name: "Test Agent" },
    });

    const sig = signChallenge(regRes.body.challenge.message, keypair.secretKey);
    await request(app, "POST", "/agentdoor/register/verify", {
      agent_id: regRes.body.agent_id,
      signature: sig,
    });

    const stored = await store.getAgent(regRes.body.agent_id);
    expect(stored!.metadata.framework).toBe("LangChain");
    expect(stored!.metadata.version).toBe("0.3.14");
    expect(stored!.metadata.name).toBe("Test Agent");
  });

  it("invalid scope requests are rejected at registration", async () => {
    const { app } = createApp();
    const keypair = generateKeypair();

    const res = await request(app, "POST", "/agentdoor/register", {
      public_key: keypair.publicKey,
      scopes_requested: ["nonexistent.scope"],
    });

    expect(res.status).toBe(400);
  });

  it("health endpoint reports healthy status", async () => {
    const { app } = createApp();

    const res = await request(app, "GET", "/agentdoor/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
  });
});

describe("AgentDoor E2E: Store Persistence", () => {
  it("challenges are cleaned up after verification", async () => {
    const { app, store } = createApp();
    const reg = await fullRegistration(app, ["data.read"]);

    // Challenge should be deleted after verification
    const challenge = await store.getChallenge(reg.agentId);
    expect(challenge).toBeNull();
  });

  it("agent can be retrieved by public key after registration", async () => {
    const { app, store } = createApp();
    const reg = await fullRegistration(app, ["data.read"]);

    const agent = await store.getAgentByPublicKey(reg.keypair.publicKey);
    expect(agent).toBeDefined();
    expect(agent!.id).toBe(reg.agentId);
  });
});
