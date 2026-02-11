/**
 * Integration / E2E tests for the AgentDoor Next.js middleware.
 *
 * Exercises the complete agent lifecycle through the Next.js edge middleware:
 *   Discovery -> Register -> Verify -> Auth Guard -> Authenticated Request
 *
 * Uses mocked crypto.subtle (Ed25519 not available in all Node runtimes)
 * and real MemoryStore to test the full stack.
 */

import { describe, it, expect, vi } from "vitest";
import { MemoryStore } from "@agentdoor/core";

// ---------------------------------------------------------------------------
// Mock next/server — must be declared before the middleware import
// ---------------------------------------------------------------------------

vi.mock("next/server", () => ({
  NextResponse: {
    json: (
      body: unknown,
      init?: { status?: number; headers?: Record<string, string> },
    ) => {
      const headers = new Map<string, string>(
        Object.entries(init?.headers ?? {}),
      );
      headers.set("content-type", "application/json");
      return {
        status: init?.status ?? 200,
        headers,
        json: async () => body,
        _body: body,
      };
    },
    next: (init?: { headers?: Headers }) => {
      const headers = init?.headers ?? new Map<string, string>();
      return {
        status: 200,
        headers,
        _body: null,
      };
    },
  },
}));

import { createAgentDoorMiddleware } from "@agentdoor/next";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SCOPES = [
  { id: "data.read", description: "Read data" },
  { id: "data.write", description: "Write data" },
  { id: "analytics.read", description: "Read analytics" },
];

function createMockRequest(
  method: string,
  pathname: string,
  options?: { body?: unknown; headers?: Record<string, string> },
): any {
  const headers = new Headers(options?.headers);
  return {
    nextUrl: { pathname },
    method,
    headers,
    url: `http://localhost:3000${pathname}`,
    json: async () => options?.body,
  };
}

let keyCounter = 0;
function uniquePublicKey(): string {
  keyCounter++;
  return btoa(`test-nextjs-key-${keyCounter}-${Date.now()}-${Math.random()}`);
}

async function fullRegistration(
  mw: (req: any) => Promise<any>,
  scopes: string[] = ["data.read"],
) {
  const importKeySpy = vi
    .spyOn(crypto.subtle, "importKey")
    .mockResolvedValue({} as CryptoKey);
  const verifySpy = vi
    .spyOn(crypto.subtle, "verify")
    .mockResolvedValue(true);

  try {
    const pk = uniquePublicKey();

    // Step 1 — register
    const registerReq = createMockRequest("POST", "/agentdoor/register", {
      body: {
        public_key: pk,
        scopes_requested: scopes,
        metadata: { framework: "vitest", version: "1.0.0", name: "E2E Next.js Agent" },
      },
    });
    const registerRes = await mw(registerReq);
    expect(registerRes.status).toBe(201);
    const registerBody = await registerRes.json();

    // Step 2 — verify
    const verifyReq = createMockRequest("POST", "/agentdoor/register/verify", {
      body: {
        agent_id: registerBody.agent_id,
        signature: btoa("fake-signature"),
      },
    });
    const verifyRes = await mw(verifyReq);
    expect(verifyRes.status).toBe(200);
    const verifyBody = await verifyRes.json();

    return {
      publicKey: pk,
      agentId: verifyBody.agent_id as string,
      apiKey: verifyBody.api_key as string,
      scopesGranted: verifyBody.scopes_granted as string[],
    };
  } finally {
    importKeySpy.mockRestore();
    verifySpy.mockRestore();
  }
}

// ===========================================================================
// Tests
// ===========================================================================

describe("AgentDoor E2E: Next.js Full Agent Lifecycle", () => {
  it("completes the full lifecycle: discovery -> register -> verify -> auth guard -> re-auth", async () => {
    const store = new MemoryStore();
    const mw = createAgentDoorMiddleware({
      scopes: TEST_SCOPES,
      store,
      service: { name: "Next.js E2E Test API", description: "E2E test service" },
    });

    // 1. Discovery
    const discovery = await mw(createMockRequest("GET", "/.well-known/agentdoor.json"));
    expect(discovery.status).toBe(200);
    const discoveryBody = await discovery.json();
    expect(discoveryBody.agentdoor_version).toBe("1.0");
    expect(discoveryBody.service_name).toBe("Next.js E2E Test API");
    expect(discoveryBody.scopes_available).toHaveLength(3);

    // 2. Register
    const pk = uniquePublicKey();
    const regRes = await mw(
      createMockRequest("POST", "/agentdoor/register", {
        body: {
          public_key: pk,
          scopes_requested: ["data.read", "data.write"],
          metadata: { framework: "vitest", version: "1.0.0" },
        },
      }),
    );
    expect(regRes.status).toBe(201);
    const regBody = await regRes.json();
    expect(regBody.agent_id).toMatch(/^ag_/);
    expect(regBody.challenge.message).toContain("agentdoor:register:");

    // 3. Verify (mock crypto.subtle)
    const importKeySpy = vi.spyOn(crypto.subtle, "importKey").mockResolvedValue({} as CryptoKey);
    const verifySpy = vi.spyOn(crypto.subtle, "verify").mockResolvedValue(true);

    const verifyRes = await mw(
      createMockRequest("POST", "/agentdoor/register/verify", {
        body: { agent_id: regBody.agent_id, signature: btoa("test-signature") },
      }),
    );
    expect(verifyRes.status).toBe(200);
    const verifyBody = await verifyRes.json();
    expect(verifyBody.api_key).toBeDefined();
    expect(verifyBody.api_key).toMatch(/^agk_live_/);
    expect(verifyBody.scopes_granted).toEqual(["data.read", "data.write"]);

    // 4. Auth guard with API key
    const apiRes = await mw(
      createMockRequest("GET", "/api/data", {
        headers: { Authorization: `Bearer ${verifyBody.api_key}` },
      }),
    );
    expect(apiRes.status).toBe(200);
    expect(apiRes.headers.get("x-agentdoor-authenticated")).toBe("true");
    expect(apiRes.headers.get("x-agentdoor-agent-id")).toBe(regBody.agent_id);

    // 5. Re-auth with signature
    const authRes = await mw(
      createMockRequest("POST", "/agentdoor/auth", {
        body: {
          agent_id: regBody.agent_id,
          signature: btoa("auth-sig"),
          timestamp: new Date().toISOString(),
        },
      }),
    );
    expect(authRes.status).toBe(200);
    const authBody = await authRes.json();
    expect(authBody.token).toBeDefined();
    expect(authBody.expires_at).toBeDefined();

    // 6. Verify agent persisted in store
    const stored = await store.getAgent(regBody.agent_id);
    expect(stored).toBeDefined();
    expect(stored!.publicKey).toBe(pk);
    expect(stored!.scopesGranted).toEqual(["data.read", "data.write"]);

    importKeySpy.mockRestore();
    verifySpy.mockRestore();
  });

  it("rejects unauthenticated requests on protected paths (passthrough=false)", async () => {
    const mw = createAgentDoorMiddleware({
      scopes: TEST_SCOPES,
      service: { name: "Test" },
      passthrough: false,
    });

    const res = await mw(createMockRequest("GET", "/api/data"));
    expect(res.status).toBe(401);
  });

  it("allows unauthenticated requests with passthrough=true", async () => {
    const mw = createAgentDoorMiddleware({
      scopes: TEST_SCOPES,
      service: { name: "Test" },
      passthrough: true,
    });

    const res = await mw(createMockRequest("GET", "/api/data"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-agentdoor-authenticated")).toBe("false");
  });

  it("multiple agents can coexist independently", async () => {
    const store = new MemoryStore();
    const mw = createAgentDoorMiddleware({
      scopes: TEST_SCOPES,
      store,
      service: { name: "Test" },
    });

    const agent1 = await fullRegistration(mw, ["data.read"]);
    const agent2 = await fullRegistration(mw, ["data.write"]);
    const agent3 = await fullRegistration(mw, ["data.read", "analytics.read"]);

    // Each agent should have unique IDs
    const ids = new Set([agent1.agentId, agent2.agentId, agent3.agentId]);
    expect(ids.size).toBe(3);

    // Each should authenticate with their own keys
    const res1 = await mw(
      createMockRequest("GET", "/api/data", {
        headers: { Authorization: `Bearer ${agent1.apiKey}` },
      }),
    );
    const res2 = await mw(
      createMockRequest("GET", "/api/data", {
        headers: { Authorization: `Bearer ${agent2.apiKey}` },
      }),
    );

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.headers.get("x-agentdoor-agent-id")).toBe(agent1.agentId);
    expect(res2.headers.get("x-agentdoor-agent-id")).toBe(agent2.agentId);
  });

  it("health endpoint reports healthy status", async () => {
    const mw = createAgentDoorMiddleware({
      scopes: TEST_SCOPES,
      service: { name: "Test" },
    });

    // Non-protected path passes through
    const res = await mw(createMockRequest("GET", "/agentdoor/health"));
    // The Next.js middleware passes through non-matching routes
    expect(res.status).toBe(200);
  });

  it("invalid scope requests are rejected at registration", async () => {
    const mw = createAgentDoorMiddleware({
      scopes: TEST_SCOPES,
      service: { name: "Test" },
    });

    const res = await mw(
      createMockRequest("POST", "/agentdoor/register", {
        body: {
          public_key: uniquePublicKey(),
          scopes_requested: ["nonexistent.scope"],
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("agent metadata is preserved through registration", async () => {
    const store = new MemoryStore();
    const mw = createAgentDoorMiddleware({
      scopes: TEST_SCOPES,
      store,
      service: { name: "Test" },
    });

    const agent = await fullRegistration(mw, ["data.read"]);
    const stored = await store.getAgent(agent.agentId);
    expect(stored).toBeDefined();
    expect(stored!.metadata.framework).toBe("vitest");
    expect(stored!.metadata.name).toBe("E2E Next.js Agent");
  });

  it("challenges are cleaned up after verification", async () => {
    const store = new MemoryStore();
    const mw = createAgentDoorMiddleware({
      scopes: TEST_SCOPES,
      store,
      service: { name: "Test" },
    });

    const agent = await fullRegistration(mw, ["data.read"]);
    const challenge = await store.getChallenge(agent.agentId);
    expect(challenge).toBeNull();
  });
});
