/**
 * Integration / E2E tests for the AgentGate Hono middleware.
 *
 * Exercises the complete agent lifecycle through the Hono adapter:
 *   Discovery -> Register -> Verify -> Auth Guard -> Authenticated Request
 *
 * Uses real Ed25519 crypto (via crypto.subtle) for signature verification.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { agentgate } from "@agentgate/hono";
import type { AgentGateVariables } from "@agentgate/hono";
import { MemoryStore } from "@agentgate/core";

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
  const app = new Hono<{ Variables: AgentGateVariables }>();
  agentgate(app, {
    scopes: TEST_SCOPES,
    store,
    service: { name: "Hono E2E Test API", description: "E2E test service" },
    ...overrides,
  });
  app.get("/api/data", (c) =>
    c.json({ isAgent: c.get("isAgent"), agent: c.get("agent"), ok: true }),
  );
  app.post("/api/data", (c) =>
    c.json({ isAgent: c.get("isAgent"), ok: true }),
  );
  return { app, store };
}

/**
 * Register and verify an agent using real Ed25519 crypto.
 */
async function fullRegistration(
  app: Hono<{ Variables: AgentGateVariables }>,
  scopes: string[] = ["data.read"],
) {
  // Generate real Ed25519 key pair
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const pubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyB64 = btoa(
    String.fromCharCode(...new Uint8Array(pubRaw)),
  );

  // Register
  const regRes = await app.request("/agentgate/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      public_key: publicKeyB64,
      scopes_requested: scopes,
      metadata: { framework: "vitest", version: "1.0.0", name: "E2E Hono Agent" },
    }),
  });
  expect(regRes.status).toBe(201);
  const regBody = await regRes.json();

  // Sign the challenge
  const sigBytes = await crypto.subtle.sign(
    "Ed25519",
    keyPair.privateKey,
    new TextEncoder().encode(regBody.challenge.message),
  );
  const signatureB64 = btoa(
    String.fromCharCode(...new Uint8Array(sigBytes)),
  );

  // Verify
  const verifyRes = await app.request("/agentgate/register/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: regBody.agent_id,
      signature: signatureB64,
    }),
  });
  expect(verifyRes.status).toBe(200);
  const verifyBody = await verifyRes.json();

  return {
    publicKey: publicKeyB64,
    privateKey: keyPair.privateKey,
    agentId: regBody.agent_id as string,
    apiKey: verifyBody.api_key as string,
    token: verifyBody.token as string,
    scopesGranted: verifyBody.scopes_granted as string[],
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("AgentGate E2E: Hono Full Agent Lifecycle", () => {
  it("completes the full lifecycle: discovery -> register -> verify -> auth guard -> re-auth", async () => {
    const { app, store } = createApp();

    // 1. Discovery
    const discovery = await app.request("/.well-known/agentgate.json");
    expect(discovery.status).toBe(200);
    const discoveryBody = await discovery.json();
    expect(discoveryBody.agentgate_version).toBe("1.0");
    expect(discoveryBody.service_name).toBe("Hono E2E Test API");
    expect(discoveryBody.scopes_available).toHaveLength(3);

    // 2-3. Register + Verify
    const agent = await fullRegistration(app, ["data.read", "data.write"]);
    expect(agent.agentId).toMatch(/^ag_/);
    expect(agent.apiKey).toMatch(/^agk_live_/);
    expect(agent.scopesGranted).toEqual(["data.read", "data.write"]);

    // 4. Auth guard with API key
    const apiRes = await app.request("/api/data", {
      headers: { Authorization: `Bearer ${agent.apiKey}` },
    });
    expect(apiRes.status).toBe(200);
    const apiBody = await apiRes.json();
    expect(apiBody.isAgent).toBe(true);
    expect(apiBody.agent.id).toBe(agent.agentId);
    expect(apiBody.agent.scopes).toEqual(["data.read", "data.write"]);

    // 5. Re-auth with signature
    const ts = new Date().toISOString();
    const authMsg = `agentgate:auth:${agent.agentId}:${ts}`;
    const authSigBytes = await crypto.subtle.sign(
      "Ed25519",
      agent.privateKey,
      new TextEncoder().encode(authMsg),
    );
    const authSigB64 = btoa(String.fromCharCode(...new Uint8Array(authSigBytes)));

    const authRes = await app.request("/agentgate/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: agent.agentId,
        signature: authSigB64,
        timestamp: ts,
      }),
    });
    expect(authRes.status).toBe(200);
    const authBody = await authRes.json();
    expect(authBody.token).toBeDefined();
    expect(authBody.expires_at).toBeDefined();

    // 6. Verify agent persisted in store
    const stored = await store.getAgent(agent.agentId);
    expect(stored).toBeDefined();
    expect(stored!.publicKey).toBe(agent.publicKey);
    expect(stored!.scopesGranted).toEqual(["data.read", "data.write"]);
  });

  it("rejects unauthenticated requests on protected paths", async () => {
    const { app } = createApp();
    const res = await app.request("/api/data");
    expect(res.status).toBe(401);
  });

  it("allows unauthenticated with passthrough=true", async () => {
    const { app } = createApp({ passthrough: true });
    const res = await app.request("/api/data");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isAgent).toBe(false);
  });

  it("multiple agents can coexist independently", async () => {
    const { app } = createApp();

    const agent1 = await fullRegistration(app, ["data.read"]);
    const agent2 = await fullRegistration(app, ["data.write"]);
    const agent3 = await fullRegistration(app, ["data.read", "analytics.read"]);

    const ids = new Set([agent1.agentId, agent2.agentId, agent3.agentId]);
    expect(ids.size).toBe(3);

    const res1 = await app.request("/api/data", {
      headers: { Authorization: `Bearer ${agent1.apiKey}` },
    });
    const res2 = await app.request("/api/data", {
      headers: { Authorization: `Bearer ${agent2.apiKey}` },
    });

    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.agent.scopes).toEqual(["data.read"]);
    expect(body2.agent.scopes).toEqual(["data.write"]);
  });

  it("duplicate public key registration returns 409", async () => {
    const { app } = createApp();
    const agent = await fullRegistration(app, ["data.read"]);

    // Try to register with the same public key
    const res = await app.request("/agentgate/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        public_key: agent.publicKey,
        scopes_requested: ["data.write"],
      }),
    });
    expect(res.status).toBe(409);
  });

  it("agent metadata is preserved through registration", async () => {
    const { app, store } = createApp();
    const agent = await fullRegistration(app, ["data.read"]);

    const stored = await store.getAgent(agent.agentId);
    expect(stored!.metadata.framework).toBe("vitest");
    expect(stored!.metadata.name).toBe("E2E Hono Agent");
  });

  it("challenges are cleaned up after verification", async () => {
    const { app, store } = createApp();
    const agent = await fullRegistration(app, ["data.read"]);

    const challenge = await store.getChallenge(agent.agentId);
    expect(challenge).toBeNull();
  });

  it("invalid scope requests are rejected at registration", async () => {
    const { app } = createApp();

    const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const pubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const publicKeyB64 = btoa(String.fromCharCode(...new Uint8Array(pubRaw)));

    const res = await app.request("/agentgate/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        public_key: publicKeyB64,
        scopes_requested: ["nonexistent.scope"],
      }),
    });
    expect(res.status).toBe(400);
  });
});
