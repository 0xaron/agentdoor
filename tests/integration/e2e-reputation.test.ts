/**
 * Integration / E2E tests for the reputation system.
 *
 * Tests the full reputation gating flow: register an agent, lower
 * its reputation score, and verify that gates are enforced.
 *
 * Uses the Hono adapter with real Ed25519 crypto and MemoryStore.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { agentdoor } from "@agentdoor/hono";
import type { AgentDoorVariables } from "@agentdoor/hono";
import { MemoryStore, ReputationManager } from "@agentdoor/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SCOPES = [
  { id: "data.read", description: "Read data" },
  { id: "data.write", description: "Write data" },
];

async function registerAndVerify(app: Hono<{ Variables: AgentDoorVariables }>) {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const pubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyB64 = btoa(String.fromCharCode(...new Uint8Array(pubRaw)));

  const regRes = await app.request("/agentdoor/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      public_key: publicKeyB64,
      scopes_requested: ["data.read"],
      metadata: { framework: "vitest" },
    }),
  });
  expect(regRes.status).toBe(201);
  const regBody = await regRes.json();

  const sigBytes = await crypto.subtle.sign(
    "Ed25519",
    keyPair.privateKey,
    new TextEncoder().encode(regBody.challenge.message),
  );
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));

  const verifyRes = await app.request("/agentdoor/register/verify", {
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
    agentId: regBody.agent_id as string,
    apiKey: verifyBody.api_key as string,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("AgentDoor E2E: Reputation Gating", () => {
  it("blocks agent with reputation below the block gate threshold", async () => {
    const store = new MemoryStore();
    const app = new Hono<{ Variables: AgentDoorVariables }>();
    agentdoor(app, {
      scopes: TEST_SCOPES,
      store,
      service: { name: "Reputation Test" },
      reputation: {
        gates: [{ minReputation: 60, action: "block" as const }],
      },
    });
    app.get("/api/data", (c) => c.json({ ok: true }));

    const { agentId, apiKey } = await registerAndVerify(app);

    // Lower reputation below the threshold
    await store.updateAgent(agentId, { reputation: 25 });

    const res = await app.request("/api/data", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Insufficient reputation");
    expect(body.required).toBe(60);
    expect(body.current).toBe(25);
  });

  it("allows agent with reputation above the block gate threshold", async () => {
    const store = new MemoryStore();
    const app = new Hono<{ Variables: AgentDoorVariables }>();
    agentdoor(app, {
      scopes: TEST_SCOPES,
      store,
      service: { name: "Reputation Test" },
      reputation: {
        gates: [{ minReputation: 30, action: "block" as const }],
      },
    });
    app.get("/api/data", (c) =>
      c.json({ isAgent: c.get("isAgent"), ok: true }),
    );

    const { apiKey } = await registerAndVerify(app);

    // Agent starts at reputation 50, above 30 threshold
    const res = await app.request("/api/data", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isAgent).toBe(true);
  });

  it("warns agent with low reputation via header (warn action)", async () => {
    const store = new MemoryStore();
    const app = new Hono<{ Variables: AgentDoorVariables }>();
    agentdoor(app, {
      scopes: TEST_SCOPES,
      store,
      service: { name: "Reputation Test" },
      reputation: {
        gates: [{ minReputation: 60, action: "warn" as const }],
      },
    });
    app.get("/api/data", (c) => c.json({ ok: true }));

    const { agentId, apiKey } = await registerAndVerify(app);
    await store.updateAgent(agentId, { reputation: 40 });

    const res = await app.request("/api/data", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("x-agentdoor-reputation-warning")).toContain("score=40");
    expect(res.headers.get("x-agentdoor-reputation-warning")).toContain("required=60");
  });

  it("allows all agents when no reputation gates are configured", async () => {
    const store = new MemoryStore();
    const app = new Hono<{ Variables: AgentDoorVariables }>();
    agentdoor(app, {
      scopes: TEST_SCOPES,
      store,
      service: { name: "Reputation Test" },
    });
    app.get("/api/data", (c) =>
      c.json({ isAgent: c.get("isAgent") }),
    );

    const { agentId, apiKey } = await registerAndVerify(app);
    await store.updateAgent(agentId, { reputation: 1 });

    const res = await app.request("/api/data", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isAgent).toBe(true);
  });

  it("reputation updates on successful request (+0.1)", async () => {
    const store = new MemoryStore();
    const app = new Hono<{ Variables: AgentDoorVariables }>();
    agentdoor(app, {
      scopes: TEST_SCOPES,
      store,
      service: { name: "Reputation Test" },
    });
    app.get("/api/data", (c) => c.json({ ok: true }));

    const { agentId, apiKey } = await registerAndVerify(app);
    await store.updateAgent(agentId, { reputation: 50 });

    await app.request("/api/data", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const agent = await store.getAgent(agentId);
    expect(agent!.reputation).toBeCloseTo(50.1, 1);
  });

  it("reputation decreases on blocked request (-0.5)", async () => {
    const store = new MemoryStore();
    const app = new Hono<{ Variables: AgentDoorVariables }>();
    agentdoor(app, {
      scopes: TEST_SCOPES,
      store,
      service: { name: "Reputation Test" },
      reputation: {
        gates: [{ minReputation: 60, action: "block" as const }],
      },
    });
    app.get("/api/data", (c) => c.json({ ok: true }));

    const { agentId, apiKey } = await registerAndVerify(app);
    await store.updateAgent(agentId, { reputation: 30 });

    const res = await app.request("/api/data", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).toBe(403);

    // Wait for async reputation update
    await new Promise((r) => setTimeout(r, 50));

    const agent = await store.getAgent(agentId);
    expect(agent!.reputation).toBeCloseTo(29.5, 1);
  });

  it("ReputationManager correctly enforces scope-specific gates", () => {
    const mgr = new ReputationManager({
      gates: [
        { minReputation: 80, scopes: ["data.write"], action: "block" },
        { minReputation: 20, action: "block" },
      ],
    });

    // Score 50 passes global gate (minReputation: 20)
    expect(mgr.checkGate(50).allowed).toBe(true);

    // Score 50 fails scoped gate for data.write (minReputation: 80)
    const scopedResult = mgr.checkGate(50, "data.write");
    expect(scopedResult.allowed).toBe(false);
    expect(scopedResult.requiredScore).toBe(80);

    // Score 90 passes the scoped gate too
    expect(mgr.checkGate(90, "data.write").allowed).toBe(true);
  });

  it("ReputationManager correctly calculates score changes", () => {
    const mgr = new ReputationManager();

    expect(mgr.calculateScore(50, "request_success")).toBeCloseTo(50.1);
    expect(mgr.calculateScore(50, "request_error")).toBeCloseTo(49.5);
    expect(mgr.calculateScore(50, "payment_success")).toBe(52);
    expect(mgr.calculateScore(50, "payment_failure")).toBe(45);
    expect(mgr.calculateScore(50, "rate_limit_hit")).toBe(49);
  });
});
