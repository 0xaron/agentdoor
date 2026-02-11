import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryStore, ReputationManager } from "@agentdoor/core";

// ---------------------------------------------------------------------------
// Mock next/server -- must be declared before any imports that trigger it.
// The middleware dynamically imports next/server via getNextResponse(); the
// vi.mock() call is hoisted and intercepts that dynamic import.
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

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import { createAgentDoorMiddleware, buildDiscoveryDocument } from "../middleware.js";
import {
  createRouteHandlers,
  createDiscoveryHandler,
  createRegisterHandler,
  createVerifyHandler,
  createAuthHandler,
  getAgentContext,
} from "../route-handlers.js";

// ---------------------------------------------------------------------------
// Shared test configuration
// ---------------------------------------------------------------------------

const TEST_CONFIG = {
  scopes: [
    { id: "data.read", description: "Read data" },
    { id: "data.write", description: "Write data" },
  ],
  service: { name: "Test Service", description: "A test service" },
};

const TEST_CONFIG_WITH_X402 = {
  ...TEST_CONFIG,
  x402: {
    network: "base" as const,
    currency: "USDC" as const,
    paymentAddress: "0x1234567890abcdef",
    facilitator: "https://x402.org/facilitator",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal object that satisfies the NextRequest shape expected by the
 * edge middleware.
 */
function createMockRequest(
  method: string,
  pathname: string,
  options?: {
    body?: unknown;
    headers?: Record<string, string>;
  },
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

/** Monotonically increasing counter so every test gets a unique public key. */
let keyCounter = 0;
function uniquePublicKey(): string {
  keyCounter++;
  return btoa(`test-public-key-${keyCounter}-${Date.now()}-${Math.random()}`);
}

/**
 * Helper that drives the full register -> verify flow through the middleware
 * and returns the agent_id + api_key.  Temporarily stubs crypto.subtle so
 * Ed25519 verification succeeds.
 */
async function registerAndVerifyAgent(
  middleware: (req: any) => Promise<any>,
  publicKey?: string,
  scopes?: string[],
): Promise<{ agentId: string; apiKey: string }> {
  const importKeySpy = vi
    .spyOn(crypto.subtle, "importKey")
    .mockResolvedValue({} as CryptoKey);
  const verifySpy = vi
    .spyOn(crypto.subtle, "verify")
    .mockResolvedValue(true);

  try {
    const pk = publicKey ?? uniquePublicKey();

    // Step 1 -- register
    const registerReq = createMockRequest("POST", "/agentdoor/register", {
      body: {
        public_key: pk,
        scopes_requested: scopes ?? ["data.read"],
        metadata: { framework: "test" },
      },
    });
    const registerRes = await middleware(registerReq);
    const registerBody = await registerRes.json();

    // Step 2 -- verify
    const verifyReq = createMockRequest("POST", "/agentdoor/register/verify", {
      body: {
        agent_id: registerBody.agent_id,
        signature: btoa("fake-signature"),
      },
    });
    const verifyRes = await middleware(verifyReq);
    const verifyBody = await verifyRes.json();

    return { agentId: verifyBody.agent_id, apiKey: verifyBody.api_key };
  } finally {
    importKeySpy.mockRestore();
    verifySpy.mockRestore();
  }
}

// ===========================================================================
//  MIDDLEWARE  (createAgentDoorMiddleware)
// ===========================================================================

describe("createAgentDoorMiddleware", () => {
  // ----- Discovery ---------------------------------------------------------

  describe("discovery endpoint (GET /.well-known/agentdoor.json)", () => {
    it("returns 200 with discovery document", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const req = createMockRequest("GET", "/.well-known/agentdoor.json");
      const res = await mw(req);

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.agentdoor_version).toBe("1.0");
      expect(body.service_name).toBe("Test Service");
      expect(body.service_description).toBe("A test service");
      expect(body.registration_endpoint).toBe("/agentdoor/register");
      expect(body.auth_endpoint).toBe("/agentdoor/auth");
      expect(body.auth_methods).toContain("ed25519-challenge");
      expect(body.auth_methods).toContain("x402-wallet");
      expect(body.auth_methods).toContain("jwt");
    });

    it("includes available scopes", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(
        createMockRequest("GET", "/.well-known/agentdoor.json"),
      );
      const body = await res.json();

      expect(body.scopes_available).toHaveLength(2);
      expect(body.scopes_available[0]).toEqual({
        id: "data.read",
        description: "Read data",
        price: undefined,
        rate_limit: undefined,
      });
      expect(body.scopes_available[1]).toEqual({
        id: "data.write",
        description: "Write data",
        price: undefined,
        rate_limit: undefined,
      });
    });

    it("sets Cache-Control header", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(
        createMockRequest("GET", "/.well-known/agentdoor.json"),
      );

      expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    });

    it("includes x402 payment section when configured", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG_WITH_X402);
      const res = await mw(
        createMockRequest("GET", "/.well-known/agentdoor.json"),
      );
      const body = await res.json();

      expect(body.payment).toBeDefined();
      expect(body.payment.protocol).toBe("x402");
      expect(body.payment.version).toBe("2.0");
      expect(body.payment.networks).toEqual(["base"]);
      expect(body.payment.currency).toEqual(["USDC"]);
      expect(body.payment.facilitator).toBe("https://x402.org/facilitator");
    });

    it("omits payment section when x402 is not configured", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(
        createMockRequest("GET", "/.well-known/agentdoor.json"),
      );
      const body = await res.json();

      expect(body.payment).toBeUndefined();
    });

    it("uses default service name when not provided", async () => {
      const mw = createAgentDoorMiddleware({ scopes: [] });
      const res = await mw(
        createMockRequest("GET", "/.well-known/agentdoor.json"),
      );
      const body = await res.json();

      expect(body.service_name).toBe("AgentDoor Service");
      expect(body.service_description).toBe("");
    });

    it("includes rate limit info from config", async () => {
      const mw = createAgentDoorMiddleware({
        ...TEST_CONFIG,
        rateLimit: { requests: 500, window: "1h" },
      });
      const res = await mw(
        createMockRequest("GET", "/.well-known/agentdoor.json"),
      );
      const body = await res.json();

      expect(body.rate_limits.default).toBe("500/1h");
      expect(body.rate_limits.registration).toBe("10/hour");
    });

    it("uses default rate limit when not configured", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(
        createMockRequest("GET", "/.well-known/agentdoor.json"),
      );
      const body = await res.json();

      expect(body.rate_limits.default).toBe("1000/1h");
    });
  });

  // ----- Registration ------------------------------------------------------

  describe("registration endpoint (POST /agentdoor/register)", () => {
    it("returns 201 with challenge for valid registration", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const req = createMockRequest("POST", "/agentdoor/register", {
        body: {
          public_key: uniquePublicKey(),
          scopes_requested: ["data.read"],
        },
      });
      const res = await mw(req);

      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.agent_id).toBeDefined();
      expect(body.agent_id).toMatch(/^ag_/);
      expect(body.challenge).toBeDefined();
      expect(body.challenge.nonce).toBeDefined();
      expect(body.challenge.message).toContain("agentdoor:register:");
      expect(body.challenge.expires_at).toBeDefined();
      // expires_at should be a valid ISO timestamp
      expect(new Date(body.challenge.expires_at).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it("returns 400 when public_key is missing", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(
        createMockRequest("POST", "/agentdoor/register", {
          body: { scopes_requested: ["data.read"] },
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("public_key");
    });

    it("returns 400 when public_key is not a string", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(
        createMockRequest("POST", "/agentdoor/register", {
          body: { public_key: 12345, scopes_requested: ["data.read"] },
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("public_key");
    });

    it("returns 400 when scopes_requested is missing", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(
        createMockRequest("POST", "/agentdoor/register", {
          body: { public_key: uniquePublicKey() },
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("scopes_requested");
    });

    it("returns 400 when scopes_requested is an empty array", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(
        createMockRequest("POST", "/agentdoor/register", {
          body: { public_key: uniquePublicKey(), scopes_requested: [] },
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("scopes_requested");
    });

    it("returns 400 when requested scopes are not in the available set", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(
        createMockRequest("POST", "/agentdoor/register", {
          body: {
            public_key: uniquePublicKey(),
            scopes_requested: ["data.read", "nonexistent.scope"],
          },
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid scopes");
      expect(body.error).toContain("nonexistent.scope");
    });

    it("returns 409 for duplicate public key", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const pk = uniquePublicKey();

      // Complete the full flow so the key is stored in registeredAgents.
      await registerAndVerifyAgent(mw, pk);

      // Attempt to register with the same key.
      const res = await mw(
        createMockRequest("POST", "/agentdoor/register", {
          body: { public_key: pk, scopes_requested: ["data.read"] },
        }),
      );

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain("already registered");
      expect(body.agent_id).toBeDefined();
    });

    it("accepts optional metadata and x402_wallet", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(
        createMockRequest("POST", "/agentdoor/register", {
          body: {
            public_key: uniquePublicKey(),
            scopes_requested: ["data.read"],
            metadata: { framework: "langchain", version: "0.1.0" },
            x402_wallet: "0xABCDEF",
          },
        }),
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.agent_id).toBeDefined();
    });

    it("returns 400 for invalid JSON body", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const req = createMockRequest("POST", "/agentdoor/register");
      req.json = async () => {
        throw new Error("Invalid JSON");
      };
      const res = await mw(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid JSON");
    });
  });

  // ----- Register Verify ---------------------------------------------------

  describe("register verify endpoint (POST /agentdoor/register/verify)", () => {
    it("returns 400 when agent_id is missing", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(
        createMockRequest("POST", "/agentdoor/register/verify", {
          body: { signature: "some-sig" },
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("agent_id");
      expect(body.error).toContain("signature");
    });

    it("returns 400 when signature is missing", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(
        createMockRequest("POST", "/agentdoor/register/verify", {
          body: { agent_id: "ag_test123" },
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("agent_id");
      expect(body.error).toContain("signature");
    });

    it("returns 404 for unknown agent_id", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(
        createMockRequest("POST", "/agentdoor/register/verify", {
          body: { agent_id: "ag_nonexistent", signature: btoa("sig") },
        }),
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("Unknown agent_id");
    });

    it("returns 200 with api_key on successful verification", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);

      // Register first.
      const pk = uniquePublicKey();
      const registerRes = await mw(
        createMockRequest("POST", "/agentdoor/register", {
          body: {
            public_key: pk,
            scopes_requested: ["data.read", "data.write"],
          },
        }),
      );
      const { agent_id: agentId } = await registerRes.json();

      // Verify with mocked crypto.
      const importKeySpy = vi
        .spyOn(crypto.subtle, "importKey")
        .mockResolvedValue({} as CryptoKey);
      const verifySpy = vi
        .spyOn(crypto.subtle, "verify")
        .mockResolvedValue(true);

      const verifyRes = await mw(
        createMockRequest("POST", "/agentdoor/register/verify", {
          body: { agent_id: agentId, signature: btoa("test-signature") },
        }),
      );

      expect(verifyRes.status).toBe(200);

      const verifyBody = await verifyRes.json();
      expect(verifyBody.agent_id).toBe(agentId);
      expect(verifyBody.api_key).toBeDefined();
      expect(verifyBody.api_key).toMatch(/^agk_live_/);
      expect(verifyBody.scopes_granted).toEqual(["data.read", "data.write"]);
      expect(verifyBody.rate_limit).toEqual({
        requests: 1000,
        window: "1h",
      });

      importKeySpy.mockRestore();
      verifySpy.mockRestore();
    });

    it("includes x402 in verify response when configured", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG_WITH_X402);

      const importKeySpy = vi
        .spyOn(crypto.subtle, "importKey")
        .mockResolvedValue({} as CryptoKey);
      const verifySpy = vi
        .spyOn(crypto.subtle, "verify")
        .mockResolvedValue(true);

      const pk = uniquePublicKey();
      const registerRes = await mw(
        createMockRequest("POST", "/agentdoor/register", {
          body: { public_key: pk, scopes_requested: ["data.read"] },
        }),
      );
      const registerBody = await registerRes.json();

      const verifyRes = await mw(
        createMockRequest("POST", "/agentdoor/register/verify", {
          body: {
            agent_id: registerBody.agent_id,
            signature: btoa("sig"),
          },
        }),
      );
      const verifyBody = await verifyRes.json();

      expect(verifyBody.x402).toBeDefined();
      expect(verifyBody.x402.payment_address).toBe("0x1234567890abcdef");
      expect(verifyBody.x402.network).toBe("base");
      expect(verifyBody.x402.currency).toBe("USDC");

      importKeySpy.mockRestore();
      verifySpy.mockRestore();
    });

    it("does not include x402 when not configured", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);

      const importKeySpy = vi
        .spyOn(crypto.subtle, "importKey")
        .mockResolvedValue({} as CryptoKey);
      const verifySpy = vi
        .spyOn(crypto.subtle, "verify")
        .mockResolvedValue(true);

      const pk = uniquePublicKey();
      const registerRes = await mw(
        createMockRequest("POST", "/agentdoor/register", {
          body: { public_key: pk, scopes_requested: ["data.read"] },
        }),
      );
      const registerBody = await registerRes.json();

      const verifyRes = await mw(
        createMockRequest("POST", "/agentdoor/register/verify", {
          body: {
            agent_id: registerBody.agent_id,
            signature: btoa("sig"),
          },
        }),
      );
      const verifyBody = await verifyRes.json();

      expect(verifyBody.x402).toBeUndefined();

      importKeySpy.mockRestore();
      verifySpy.mockRestore();
    });

    it("calls onAgentRegistered callback on successful verification", async () => {
      const onRegistered = vi.fn();
      const mw = createAgentDoorMiddleware({
        ...TEST_CONFIG,
        onAgentRegistered: onRegistered,
      });

      const importKeySpy = vi
        .spyOn(crypto.subtle, "importKey")
        .mockResolvedValue({} as CryptoKey);
      const verifySpy = vi
        .spyOn(crypto.subtle, "verify")
        .mockResolvedValue(true);

      const pk = uniquePublicKey();
      const registerRes = await mw(
        createMockRequest("POST", "/agentdoor/register", {
          body: {
            public_key: pk,
            scopes_requested: ["data.read"],
            metadata: { framework: "test-agent" },
          },
        }),
      );
      const registerBody = await registerRes.json();

      await mw(
        createMockRequest("POST", "/agentdoor/register/verify", {
          body: {
            agent_id: registerBody.agent_id,
            signature: btoa("sig"),
          },
        }),
      );

      expect(onRegistered).toHaveBeenCalledOnce();
      expect(onRegistered).toHaveBeenCalledWith(
        expect.objectContaining({
          id: registerBody.agent_id,
          publicKey: pk,
          scopesGranted: ["data.read"],
          metadata: { framework: "test-agent" },
          status: "active",
          reputation: 50,
        }),
      );

      importKeySpy.mockRestore();
      verifySpy.mockRestore();
    });

    it("succeeds even when onAgentRegistered callback throws", async () => {
      const onRegistered = vi
        .fn()
        .mockRejectedValue(new Error("callback boom"));
      const mw = createAgentDoorMiddleware({
        ...TEST_CONFIG,
        onAgentRegistered: onRegistered,
      });

      const importKeySpy = vi
        .spyOn(crypto.subtle, "importKey")
        .mockResolvedValue({} as CryptoKey);
      const verifySpy = vi
        .spyOn(crypto.subtle, "verify")
        .mockResolvedValue(true);

      const pk = uniquePublicKey();
      const registerRes = await mw(
        createMockRequest("POST", "/agentdoor/register", {
          body: { public_key: pk, scopes_requested: ["data.read"] },
        }),
      );
      const registerBody = await registerRes.json();

      const verifyRes = await mw(
        createMockRequest("POST", "/agentdoor/register/verify", {
          body: {
            agent_id: registerBody.agent_id,
            signature: btoa("sig"),
          },
        }),
      );

      // The endpoint should still succeed despite the callback error.
      expect(verifyRes.status).toBe(200);
      const verifyBody = await verifyRes.json();
      expect(verifyBody.api_key).toBeDefined();

      importKeySpy.mockRestore();
      verifySpy.mockRestore();
    });

    it("returns 400 for invalid JSON body", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const req = createMockRequest("POST", "/agentdoor/register/verify");
      req.json = async () => {
        throw new Error("bad json");
      };
      const res = await mw(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid JSON");
    });

    it("returns 400 when Ed25519 verification naturally fails", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);

      // Register to create a pending challenge.
      const pk = uniquePublicKey();
      const registerRes = await mw(
        createMockRequest("POST", "/agentdoor/register", {
          body: { public_key: pk, scopes_requested: ["data.read"] },
        }),
      );
      const registerBody = await registerRes.json();

      // Attempt verify without mocking crypto -- Ed25519 not available in
      // the test runtime so verifyEd25519 returns false.
      const verifyRes = await mw(
        createMockRequest("POST", "/agentdoor/register/verify", {
          body: {
            agent_id: registerBody.agent_id,
            signature: btoa("invalid"),
          },
        }),
      );

      expect(verifyRes.status).toBe(400);
      const verifyBody = await verifyRes.json();
      expect(verifyBody.error).toContain("Invalid signature");
    });

    it("returns 410 for expired challenge", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);

      const pk = uniquePublicKey();
      const registerRes = await mw(
        createMockRequest("POST", "/agentdoor/register", {
          body: { public_key: pk, scopes_requested: ["data.read"] },
        }),
      );
      const registerBody = await registerRes.json();

      // Fast-forward time past the 5-minute challenge expiry window.
      const realDateNow = Date.now;
      Date.now = () => realDateNow() + 6 * 60 * 1000;

      try {
        const verifyRes = await mw(
          createMockRequest("POST", "/agentdoor/register/verify", {
            body: {
              agent_id: registerBody.agent_id,
              signature: btoa("sig"),
            },
          }),
        );

        expect(verifyRes.status).toBe(410);
        const verifyBody = await verifyRes.json();
        expect(verifyBody.error).toContain("expired");
      } finally {
        Date.now = realDateNow;
      }
    });
  });

  // ----- Auth endpoint -----------------------------------------------------

  describe("auth endpoint (POST /agentdoor/auth)", () => {
    it("returns 400 when required fields are missing", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(
        createMockRequest("POST", "/agentdoor/auth", {
          body: { agent_id: "ag_test" },
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("agent_id");
      expect(body.error).toContain("signature");
      expect(body.error).toContain("timestamp");
    });

    it("returns 400 when agent_id is missing", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(
        createMockRequest("POST", "/agentdoor/auth", {
          body: { signature: "sig", timestamp: "2024-01-01T00:00:00Z" },
        }),
      );

      expect(res.status).toBe(400);
    });

    it("returns 400 when signature is missing", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(
        createMockRequest("POST", "/agentdoor/auth", {
          body: {
            agent_id: "ag_test",
            timestamp: "2024-01-01T00:00:00Z",
          },
        }),
      );

      expect(res.status).toBe(400);
    });

    it("returns 400 when timestamp is missing", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(
        createMockRequest("POST", "/agentdoor/auth", {
          body: { agent_id: "ag_test", signature: "sig" },
        }),
      );

      expect(res.status).toBe(400);
    });

    it("returns 404 for unknown agent_id", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(
        createMockRequest("POST", "/agentdoor/auth", {
          body: {
            agent_id: "ag_does_not_exist",
            signature: "sig",
            timestamp: "2024-01-01T00:00:00Z",
          },
        }),
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("Unknown agent_id");
    });

    it("returns 400 for invalid JSON body", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const req = createMockRequest("POST", "/agentdoor/auth");
      req.json = async () => {
        throw new Error("parse error");
      };
      const res = await mw(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid JSON");
    });

    it("returns token for registered agent with valid signature", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);

      // Register + verify an agent so it exists in the store.
      const { agentId } = await registerAndVerifyAgent(mw);

      // Mock crypto for the auth step.
      const importKeySpy = vi
        .spyOn(crypto.subtle, "importKey")
        .mockResolvedValue({} as CryptoKey);
      const verifySpy = vi
        .spyOn(crypto.subtle, "verify")
        .mockResolvedValue(true);

      const res = await mw(
        createMockRequest("POST", "/agentdoor/auth", {
          body: {
            agent_id: agentId,
            signature: btoa("auth-sig"),
            timestamp: new Date().toISOString(),
          },
        }),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBeDefined();
      // Token should be a JWT (base64url.base64url.base64url) now
      expect(body.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(body.expires_at).toBeDefined();
      // Token should expire roughly 1 hour from now.
      const expiresAt = new Date(body.expires_at).getTime();
      expect(expiresAt).toBeGreaterThan(Date.now());

      importKeySpy.mockRestore();
      verifySpy.mockRestore();
    });
  });

  // ----- Auth guard --------------------------------------------------------

  describe("auth guard (protected routes)", () => {
    it("returns 401 when no Authorization header and passthrough=false", async () => {
      const mw = createAgentDoorMiddleware({
        ...TEST_CONFIG,
        passthrough: false,
      });
      const res = await mw(createMockRequest("GET", "/api/data"));

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("Authorization header required");
    });

    it("passes through with x-agentdoor-authenticated=false when passthrough=true and no auth header", async () => {
      const mw = createAgentDoorMiddleware({
        ...TEST_CONFIG,
        passthrough: true,
      });
      const res = await mw(createMockRequest("GET", "/api/data"));

      expect(res.status).toBe(200);
      expect(res.headers.get("x-agentdoor-authenticated")).toBe("false");
    });

    it("returns 401 for invalid bearer token and passthrough=false", async () => {
      const mw = createAgentDoorMiddleware({
        ...TEST_CONFIG,
        passthrough: false,
      });
      const res = await mw(
        createMockRequest("GET", "/api/data", {
          headers: { Authorization: "Bearer invalid_token_xyz" },
        }),
      );

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("Invalid or expired token");
    });

    it("passes through with x-agentdoor-authenticated=false for invalid token and passthrough=true", async () => {
      const mw = createAgentDoorMiddleware({
        ...TEST_CONFIG,
        passthrough: true,
      });
      const res = await mw(
        createMockRequest("GET", "/api/data", {
          headers: { Authorization: "Bearer invalid_token_xyz" },
        }),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("x-agentdoor-authenticated")).toBe("false");
    });

    it("sets agent context headers for valid API key", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);

      // Register an agent to get a valid API key.
      const { agentId, apiKey } = await registerAndVerifyAgent(mw);

      // Access a protected route with the API key.
      const res = await mw(
        createMockRequest("GET", "/api/data", {
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("x-agentdoor-authenticated")).toBe("true");
      expect(res.headers.get("x-agentdoor-agent-id")).toBe(agentId);

      const rawCtx = res.headers.get("x-agentdoor-agent");
      expect(rawCtx).toBeDefined();

      const ctx = JSON.parse(rawCtx!);
      expect(ctx.id).toBe(agentId);
      expect(ctx.publicKey).toBeDefined();
      expect(ctx.scopes).toContain("data.read");
      expect(ctx.rateLimit).toEqual({ requests: 1000, window: "1h" });
      expect(ctx.metadata).toEqual({ framework: "test" });
    });

    it("matches api key without Bearer prefix", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const { apiKey } = await registerAndVerifyAgent(mw);

      // The middleware does: token = authHeader.replace(/^Bearer\s+/i, "")
      // So passing just the key (no Bearer prefix) should still work.
      const res = await mw(
        createMockRequest("GET", "/api/resource", {
          headers: { Authorization: apiKey },
        }),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("x-agentdoor-authenticated")).toBe("true");
    });

    it("defaults to /api/ as protected path prefix", async () => {
      const mw = createAgentDoorMiddleware({
        ...TEST_CONFIG,
        passthrough: false,
      });

      // /api/* should be protected.
      const res1 = await mw(createMockRequest("GET", "/api/anything"));
      expect(res1.status).toBe(401);

      // Non-api paths should pass through.
      const res2 = await mw(createMockRequest("GET", "/not-api/route"));
      expect(res2.status).toBe(200);
    });

    it("supports custom protectedPaths", async () => {
      const mw = createAgentDoorMiddleware({
        ...TEST_CONFIG,
        protectedPaths: ["/secure/", "/private/"],
        passthrough: false,
      });

      // /secure/* should be protected.
      const res1 = await mw(createMockRequest("GET", "/secure/data"));
      expect(res1.status).toBe(401);

      // /private/* should be protected.
      const res2 = await mw(createMockRequest("GET", "/private/info"));
      expect(res2.status).toBe(401);

      // /api/* should NOT be protected (not in the custom list).
      const res3 = await mw(createMockRequest("GET", "/api/data"));
      expect(res3.status).toBe(200);
    });

    it("defaults passthrough to false", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(createMockRequest("GET", "/api/data"));

      // Default passthrough is false, so unauthenticated request gets 401.
      expect(res.status).toBe(401);
    });
  });

  // ----- Non-protected routes ----------------------------------------------

  describe("non-protected routes", () => {
    it("passes through for non-protected paths", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(createMockRequest("GET", "/about"));

      expect(res.status).toBe(200);
      expect(res._body).toBeNull();
    });

    it("passes through for root path", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(createMockRequest("GET", "/"));

      expect(res.status).toBe(200);
    });

    it("passes through for static file paths", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(createMockRequest("GET", "/static/style.css"));

      expect(res.status).toBe(200);
    });

    it("does not intercept POST to non-agentdoor paths", async () => {
      const mw = createAgentDoorMiddleware(TEST_CONFIG);
      const res = await mw(createMockRequest("POST", "/contact"));

      expect(res.status).toBe(200);
      expect(res._body).toBeNull();
    });
  });

  // ----- buildDiscoveryDocument (exported) ---------------------------------

  describe("buildDiscoveryDocument", () => {
    it("generates a correct discovery structure", () => {
      const doc = buildDiscoveryDocument(TEST_CONFIG);

      expect(doc.agentdoor_version).toBe("1.0");
      expect(doc.service_name).toBe("Test Service");
      expect(doc.service_description).toBe("A test service");
      expect(doc.registration_endpoint).toBe("/agentdoor/register");
      expect(doc.auth_endpoint).toBe("/agentdoor/auth");
      expect(doc.auth_methods).toEqual([
        "ed25519-challenge",
        "x402-wallet",
        "jwt",
      ]);
    });

    it("handles scopes with price and rateLimit", () => {
      const doc = buildDiscoveryDocument({
        scopes: [
          {
            id: "premium",
            description: "Premium access",
            price: "$0.01/req",
            rateLimit: "100/hour",
          },
        ],
      });

      expect(doc.scopes_available).toHaveLength(1);
      const scope = (doc.scopes_available as any[])[0];
      expect(scope.id).toBe("premium");
      expect(scope.price).toBe("$0.01/req");
      expect(scope.rate_limit).toBe("100/hour");
    });

    it("handles empty scopes array", () => {
      const doc = buildDiscoveryDocument({ scopes: [] });

      expect(doc.scopes_available).toEqual([]);
    });
  });
});

// ===========================================================================
//  ROUTE HANDLERS  (route-handlers.ts)
// ===========================================================================

describe("route-handlers", () => {
  // ----- createRouteHandlers -----------------------------------------------

  describe("createRouteHandlers", () => {
    it("GET returns the discovery document", async () => {
      const { GET } = createRouteHandlers(TEST_CONFIG);
      const req = new Request(
        "http://localhost:3000/.well-known/agentdoor.json",
      );
      const res = await GET(req);

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.agentdoor_version).toBe("1.0");
      expect(body.service_name).toBe("Test Service");
      expect(body.scopes_available).toHaveLength(2);
    });

    it("GET sets proper Content-Type and Cache-Control headers", async () => {
      const { GET } = createRouteHandlers(TEST_CONFIG);
      const res = await GET(
        new Request("http://localhost:3000/.well-known/agentdoor.json"),
      );

      expect(res.headers.get("Content-Type")).toBe("application/json");
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    });

    it("POST to /agentdoor/register returns challenge", async () => {
      const { POST } = createRouteHandlers(TEST_CONFIG);
      const req = new Request("http://localhost:3000/agentdoor/register", {
        method: "POST",
        body: JSON.stringify({
          public_key: uniquePublicKey(),
          scopes_requested: ["data.read"],
        }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await POST(req);

      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.agent_id).toMatch(/^ag_/);
      expect(body.challenge).toBeDefined();
      expect(body.challenge.nonce).toBeDefined();
      expect(body.challenge.message).toContain("agentdoor:register:");
    });

    it("POST to /agentdoor/register/verify completes verification", async () => {
      const { POST } = createRouteHandlers(TEST_CONFIG);

      // Register.
      const pk = uniquePublicKey();
      const registerRes = await POST(
        new Request("http://localhost:3000/agentdoor/register", {
          method: "POST",
          body: JSON.stringify({
            public_key: pk,
            scopes_requested: ["data.read"],
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );
      const registerBody = await registerRes.json();

      // Mock crypto, then verify.
      const importKeySpy = vi
        .spyOn(crypto.subtle, "importKey")
        .mockResolvedValue({} as CryptoKey);
      const verifySpy = vi
        .spyOn(crypto.subtle, "verify")
        .mockResolvedValue(true);

      const verifyRes = await POST(
        new Request("http://localhost:3000/agentdoor/register/verify", {
          method: "POST",
          body: JSON.stringify({
            agent_id: registerBody.agent_id,
            signature: btoa("test-sig"),
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );

      expect(verifyRes.status).toBe(200);
      const verifyBody = await verifyRes.json();
      expect(verifyBody.agent_id).toBe(registerBody.agent_id);
      expect(verifyBody.api_key).toMatch(/^agk_live_/);
      expect(verifyBody.scopes_granted).toEqual(["data.read"]);

      importKeySpy.mockRestore();
      verifySpy.mockRestore();
    });

    it("POST to /agentdoor/auth returns token for registered agent", async () => {
      const { POST } = createRouteHandlers(TEST_CONFIG);

      const importKeySpy = vi
        .spyOn(crypto.subtle, "importKey")
        .mockResolvedValue({} as CryptoKey);
      const verifySpy = vi
        .spyOn(crypto.subtle, "verify")
        .mockResolvedValue(true);

      // Register + verify.
      const pk = uniquePublicKey();
      const registerRes = await POST(
        new Request("http://localhost:3000/agentdoor/register", {
          method: "POST",
          body: JSON.stringify({
            public_key: pk,
            scopes_requested: ["data.read"],
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );
      const registerBody = await registerRes.json();

      await POST(
        new Request("http://localhost:3000/agentdoor/register/verify", {
          method: "POST",
          body: JSON.stringify({
            agent_id: registerBody.agent_id,
            signature: btoa("sig"),
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );

      // Authenticate.
      const authRes = await POST(
        new Request("http://localhost:3000/agentdoor/auth", {
          method: "POST",
          body: JSON.stringify({
            agent_id: registerBody.agent_id,
            signature: btoa("auth-sig"),
            timestamp: new Date().toISOString(),
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );

      expect(authRes.status).toBe(200);
      const authBody = await authRes.json();
      expect(authBody.token).toMatch(/^agt_/);
      expect(authBody.expires_at).toBeDefined();

      importKeySpy.mockRestore();
      verifySpy.mockRestore();
    });

    it("POST to unknown path returns 404", async () => {
      const { POST } = createRouteHandlers(TEST_CONFIG);
      const res = await POST(
        new Request("http://localhost:3000/agentdoor/unknown", {
          method: "POST",
          body: JSON.stringify({}),
          headers: { "Content-Type": "application/json" },
        }),
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("Not found");
    });
  });

  // ----- createDiscoveryHandler --------------------------------------------

  describe("createDiscoveryHandler", () => {
    it("returns discovery document with 200", async () => {
      const handler = createDiscoveryHandler(TEST_CONFIG);
      const res = await handler(
        new Request("http://localhost:3000/.well-known/agentdoor.json"),
      );

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.agentdoor_version).toBe("1.0");
      expect(body.service_name).toBe("Test Service");
      expect(body.service_description).toBe("A test service");
    });

    it("includes scopes and auth methods", async () => {
      const handler = createDiscoveryHandler(TEST_CONFIG);
      const res = await handler(
        new Request("http://localhost:3000/.well-known/agentdoor.json"),
      );
      const body = await res.json();

      expect(body.scopes_available).toHaveLength(2);
      expect(body.auth_methods).toContain("ed25519-challenge");
      expect(body.auth_methods).toContain("x402-wallet");
      expect(body.auth_methods).toContain("jwt");
    });

    it("includes x402 payment info when configured", async () => {
      const handler = createDiscoveryHandler(TEST_CONFIG_WITH_X402);
      const res = await handler(
        new Request("http://localhost:3000/.well-known/agentdoor.json"),
      );
      const body = await res.json();

      expect(body.payment).toBeDefined();
      expect(body.payment.protocol).toBe("x402");
    });
  });

  // ----- createRegisterHandler ---------------------------------------------

  describe("createRegisterHandler", () => {
    it("handles valid registration request", async () => {
      const handler = createRegisterHandler(TEST_CONFIG);
      const res = await handler(
        new Request("http://localhost:3000/agentdoor/register", {
          method: "POST",
          body: JSON.stringify({
            public_key: uniquePublicKey(),
            scopes_requested: ["data.read"],
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.agent_id).toMatch(/^ag_/);
      expect(body.challenge).toBeDefined();
    });

    it("returns 400 for missing public_key", async () => {
      const handler = createRegisterHandler(TEST_CONFIG);
      const res = await handler(
        new Request("http://localhost:3000/agentdoor/register", {
          method: "POST",
          body: JSON.stringify({ scopes_requested: ["data.read"] }),
          headers: { "Content-Type": "application/json" },
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("public_key");
    });

    it("returns 400 for invalid scopes", async () => {
      const handler = createRegisterHandler(TEST_CONFIG);
      const res = await handler(
        new Request("http://localhost:3000/agentdoor/register", {
          method: "POST",
          body: JSON.stringify({
            public_key: uniquePublicKey(),
            scopes_requested: ["nonexistent.scope"],
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid scopes");
      expect(body.error).toContain("nonexistent.scope");
    });

    it("returns 400 for empty scopes array", async () => {
      const handler = createRegisterHandler(TEST_CONFIG);
      const res = await handler(
        new Request("http://localhost:3000/agentdoor/register", {
          method: "POST",
          body: JSON.stringify({
            public_key: uniquePublicKey(),
            scopes_requested: [],
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );

      expect(res.status).toBe(400);
    });
  });

  // ----- createVerifyHandler -----------------------------------------------

  describe("createVerifyHandler", () => {
    it("returns 400 when required fields are missing", async () => {
      const handler = createVerifyHandler(TEST_CONFIG);
      const res = await handler(
        new Request("http://localhost:3000/agentdoor/register/verify", {
          method: "POST",
          body: JSON.stringify({ agent_id: "ag_test" }),
          headers: { "Content-Type": "application/json" },
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("agent_id");
      expect(body.error).toContain("signature");
    });

    it("returns 404 for unknown agent_id", async () => {
      const handler = createVerifyHandler(TEST_CONFIG);
      const res = await handler(
        new Request("http://localhost:3000/agentdoor/register/verify", {
          method: "POST",
          body: JSON.stringify({
            agent_id: "ag_unknown_verify",
            signature: btoa("sig"),
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );

      expect(res.status).toBe(404);
    });

    it("completes verification with mocked crypto", async () => {
      const registerHandler = createRegisterHandler(TEST_CONFIG);
      const verifyHandler = createVerifyHandler(TEST_CONFIG);

      // Register through the register handler.
      const registerRes = await registerHandler(
        new Request("http://localhost:3000/agentdoor/register", {
          method: "POST",
          body: JSON.stringify({
            public_key: uniquePublicKey(),
            scopes_requested: ["data.read"],
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );
      const registerBody = await registerRes.json();

      // Mock crypto.
      const importKeySpy = vi
        .spyOn(crypto.subtle, "importKey")
        .mockResolvedValue({} as CryptoKey);
      const verifySpy = vi
        .spyOn(crypto.subtle, "verify")
        .mockResolvedValue(true);

      // Verify through the verify handler (shared module-level challenges map).
      const verifyRes = await verifyHandler(
        new Request("http://localhost:3000/agentdoor/register/verify", {
          method: "POST",
          body: JSON.stringify({
            agent_id: registerBody.agent_id,
            signature: btoa("valid-sig"),
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );

      expect(verifyRes.status).toBe(200);
      const verifyBody = await verifyRes.json();
      expect(verifyBody.api_key).toMatch(/^agk_live_/);
      expect(verifyBody.scopes_granted).toEqual(["data.read"]);
      expect(verifyBody.rate_limit).toEqual({
        requests: 1000,
        window: "1h",
      });

      importKeySpy.mockRestore();
      verifySpy.mockRestore();
    });

    it("includes x402 in verify response when configured", async () => {
      const registerHandler = createRegisterHandler(TEST_CONFIG_WITH_X402);
      const verifyHandler = createVerifyHandler(TEST_CONFIG_WITH_X402);

      const registerRes = await registerHandler(
        new Request("http://localhost:3000/agentdoor/register", {
          method: "POST",
          body: JSON.stringify({
            public_key: uniquePublicKey(),
            scopes_requested: ["data.read"],
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );
      const registerBody = await registerRes.json();

      const importKeySpy = vi
        .spyOn(crypto.subtle, "importKey")
        .mockResolvedValue({} as CryptoKey);
      const verifySpy = vi
        .spyOn(crypto.subtle, "verify")
        .mockResolvedValue(true);

      const verifyRes = await verifyHandler(
        new Request("http://localhost:3000/agentdoor/register/verify", {
          method: "POST",
          body: JSON.stringify({
            agent_id: registerBody.agent_id,
            signature: btoa("sig"),
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );
      const verifyBody = await verifyRes.json();

      expect(verifyBody.x402).toBeDefined();
      expect(verifyBody.x402.payment_address).toBe("0x1234567890abcdef");
      expect(verifyBody.x402.network).toBe("base");
      expect(verifyBody.x402.currency).toBe("USDC");

      importKeySpy.mockRestore();
      verifySpy.mockRestore();
    });

    it("calls onAgentRegistered callback", async () => {
      const onRegistered = vi.fn();
      const config = { ...TEST_CONFIG, onAgentRegistered: onRegistered };

      const registerHandler = createRegisterHandler(config);
      const verifyHandler = createVerifyHandler(config);

      const pk = uniquePublicKey();
      const registerRes = await registerHandler(
        new Request("http://localhost:3000/agentdoor/register", {
          method: "POST",
          body: JSON.stringify({
            public_key: pk,
            scopes_requested: ["data.read"],
            metadata: { agent_name: "test-bot" },
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );
      const registerBody = await registerRes.json();

      const importKeySpy = vi
        .spyOn(crypto.subtle, "importKey")
        .mockResolvedValue({} as CryptoKey);
      const verifySpy = vi
        .spyOn(crypto.subtle, "verify")
        .mockResolvedValue(true);

      await verifyHandler(
        new Request("http://localhost:3000/agentdoor/register/verify", {
          method: "POST",
          body: JSON.stringify({
            agent_id: registerBody.agent_id,
            signature: btoa("sig"),
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );

      expect(onRegistered).toHaveBeenCalledOnce();
      expect(onRegistered).toHaveBeenCalledWith(
        expect.objectContaining({
          id: registerBody.agent_id,
          publicKey: pk,
          scopesGranted: ["data.read"],
          status: "active",
        }),
      );

      importKeySpy.mockRestore();
      verifySpy.mockRestore();
    });
  });

  // ----- createAuthHandler -------------------------------------------------

  describe("createAuthHandler", () => {
    it("returns 400 for missing fields", async () => {
      const handler = createAuthHandler();
      const res = await handler(
        new Request("http://localhost:3000/agentdoor/auth", {
          method: "POST",
          body: JSON.stringify({ agent_id: "ag_test" }),
          headers: { "Content-Type": "application/json" },
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("agent_id");
      expect(body.error).toContain("signature");
      expect(body.error).toContain("timestamp");
    });

    it("returns 404 for unknown agent_id", async () => {
      const handler = createAuthHandler();
      const res = await handler(
        new Request("http://localhost:3000/agentdoor/auth", {
          method: "POST",
          body: JSON.stringify({
            agent_id: "ag_unknown_auth_handler",
            signature: btoa("sig"),
            timestamp: new Date().toISOString(),
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("Unknown agent_id");
    });

    it("returns 400 for invalid JSON body", async () => {
      const handler = createAuthHandler();
      // Create a Request with non-JSON body.
      const res = await handler(
        new Request("http://localhost:3000/agentdoor/auth", {
          method: "POST",
          body: "not json at all",
          headers: { "Content-Type": "text/plain" },
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid JSON");
    });

    it("returns token for a fully registered agent", async () => {
      // Use the register and verify handlers to create a registered agent
      // in the shared module-level agents map.
      const registerHandler = createRegisterHandler(TEST_CONFIG);
      const verifyHandler = createVerifyHandler(TEST_CONFIG);
      const authHandler = createAuthHandler();

      const importKeySpy = vi
        .spyOn(crypto.subtle, "importKey")
        .mockResolvedValue({} as CryptoKey);
      const verifySpy = vi
        .spyOn(crypto.subtle, "verify")
        .mockResolvedValue(true);

      const pk = uniquePublicKey();
      const registerRes = await registerHandler(
        new Request("http://localhost:3000/agentdoor/register", {
          method: "POST",
          body: JSON.stringify({
            public_key: pk,
            scopes_requested: ["data.read"],
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );
      const registerBody = await registerRes.json();

      await verifyHandler(
        new Request("http://localhost:3000/agentdoor/register/verify", {
          method: "POST",
          body: JSON.stringify({
            agent_id: registerBody.agent_id,
            signature: btoa("sig"),
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );

      // Now authenticate.
      const authRes = await authHandler(
        new Request("http://localhost:3000/agentdoor/auth", {
          method: "POST",
          body: JSON.stringify({
            agent_id: registerBody.agent_id,
            signature: btoa("auth-sig"),
            timestamp: new Date().toISOString(),
          }),
          headers: { "Content-Type": "application/json" },
        }),
      );

      expect(authRes.status).toBe(200);
      const authBody = await authRes.json();
      expect(authBody.token).toMatch(/^agt_/);
      expect(authBody.expires_at).toBeDefined();

      importKeySpy.mockRestore();
      verifySpy.mockRestore();
    });
  });

  // ----- getAgentContext ---------------------------------------------------

  describe("getAgentContext", () => {
    it("parses agent context from x-agentdoor-agent header", () => {
      const context = {
        id: "ag_test123",
        publicKey: "base64-key",
        scopes: ["data.read"],
        rateLimit: { requests: 1000, window: "1h" },
        metadata: { framework: "test" },
      };
      const headers = new Headers({
        "x-agentdoor-agent": JSON.stringify(context),
      });

      const result = getAgentContext(headers);

      expect(result).toEqual(context);
    });

    it("returns null when header is missing", () => {
      const headers = new Headers();
      const result = getAgentContext(headers);

      expect(result).toBeNull();
    });

    it("returns null for invalid JSON in header", () => {
      const headers = new Headers({
        "x-agentdoor-agent": "not-valid-json{{{",
      });
      const result = getAgentContext(headers);

      expect(result).toBeNull();
    });

    it("returns null for empty header value", () => {
      const headers = new Headers({
        "x-agentdoor-agent": "",
      });
      const result = getAgentContext(headers);

      // Empty string is falsy, so the header check returns null.
      expect(result).toBeNull();
    });

    it("preserves all context fields including optional reputation", () => {
      const context = {
        id: "ag_full",
        publicKey: "key-data",
        scopes: ["data.read", "data.write"],
        rateLimit: { requests: 500, window: "1h" },
        reputation: 75,
        metadata: { framework: "langchain", version: "0.1.0" },
      };
      const headers = new Headers({
        "x-agentdoor-agent": JSON.stringify(context),
      });

      const result = getAgentContext(headers);

      expect(result).not.toBeNull();
      expect(result!.id).toBe("ag_full");
      expect(result!.scopes).toHaveLength(2);
      expect(result!.reputation).toBe(75);
      expect(result!.metadata).toEqual({
        framework: "langchain",
        version: "0.1.0",
      });
    });
  });
});

// ===========================================================================
//  PERSISTENCE TESTS (Task 2.4 — verify challenges persist to custom store)
// ===========================================================================

describe("challenge persistence with custom store", () => {
  it("persists challenge to the provided store on registration", async () => {
    const store = new MemoryStore();
    const mw = createAgentDoorMiddleware({ ...TEST_CONFIG, store });

    const pk = uniquePublicKey();
    const registerRes = await mw(
      createMockRequest("POST", "/agentdoor/register", {
        body: {
          public_key: pk,
          scopes_requested: ["data.read"],
          metadata: { framework: "test" },
        },
      }),
    );

    expect(registerRes.status).toBe(201);
    const registerBody = await registerRes.json();

    // Verify the challenge was persisted to the store
    const storedChallenge = await store.getChallenge(registerBody.agent_id);
    expect(storedChallenge).not.toBeNull();
    expect(storedChallenge!.agentId).toBe(registerBody.agent_id);
    expect(storedChallenge!.nonce).toBe(registerBody.challenge.nonce);
    expect(storedChallenge!.message).toBe(registerBody.challenge.message);
  });

  it("stores pendingRegistration data in the challenge", async () => {
    const store = new MemoryStore();
    const mw = createAgentDoorMiddleware({ ...TEST_CONFIG, store });

    const pk = uniquePublicKey();
    const registerRes = await mw(
      createMockRequest("POST", "/agentdoor/register", {
        body: {
          public_key: pk,
          scopes_requested: ["data.read", "data.write"],
          metadata: { framework: "langchain" },
          x402_wallet: "0xTestWallet",
        },
      }),
    );
    const registerBody = await registerRes.json();

    const storedChallenge = await store.getChallenge(registerBody.agent_id);
    expect(storedChallenge).not.toBeNull();
    expect(storedChallenge!.pendingRegistration).toBeDefined();
    expect(storedChallenge!.pendingRegistration.publicKey).toBe(pk);
    expect(storedChallenge!.pendingRegistration.scopesRequested).toEqual(["data.read", "data.write"]);
  });

  it("deletes challenge from store after successful verification", async () => {
    const store = new MemoryStore();
    const mw = createAgentDoorMiddleware({ ...TEST_CONFIG, store });

    const { agentId } = await registerAndVerifyAgent(mw);

    // After verification, the challenge should be deleted
    const storedChallenge = await store.getChallenge(agentId);
    expect(storedChallenge).toBeNull();
  });

  it("persists agent to the store after successful verification", async () => {
    const store = new MemoryStore();
    const mw = createAgentDoorMiddleware({ ...TEST_CONFIG, store });

    const pk = uniquePublicKey();
    const { agentId } = await registerAndVerifyAgent(mw, pk);

    // The agent should be stored
    const storedAgent = await store.getAgent(agentId);
    expect(storedAgent).not.toBeNull();
    expect(storedAgent!.id).toBe(agentId);
    expect(storedAgent!.publicKey).toBe(pk);
    expect(storedAgent!.scopesGranted).toEqual(["data.read"]);
    expect(storedAgent!.status).toBe("active");
  });

  it("can look up agent by public key in the store after verification", async () => {
    const store = new MemoryStore();
    const mw = createAgentDoorMiddleware({ ...TEST_CONFIG, store });

    const pk = uniquePublicKey();
    const { agentId } = await registerAndVerifyAgent(mw, pk);

    const storedAgent = await store.getAgentByPublicKey(pk);
    expect(storedAgent).not.toBeNull();
    expect(storedAgent!.id).toBe(agentId);
  });

  it("challenge has a valid expiration time (approximately 5 minutes)", async () => {
    const store = new MemoryStore();
    const mw = createAgentDoorMiddleware({ ...TEST_CONFIG, store });

    const pk = uniquePublicKey();
    const now = Date.now();
    const registerRes = await mw(
      createMockRequest("POST", "/agentdoor/register", {
        body: {
          public_key: pk,
          scopes_requested: ["data.read"],
        },
      }),
    );
    const registerBody = await registerRes.json();

    const storedChallenge = await store.getChallenge(registerBody.agent_id);
    expect(storedChallenge).not.toBeNull();

    const expiresAt = storedChallenge!.expiresAt.getTime();
    // Should expire roughly 5 minutes from now (allow 10 seconds tolerance)
    expect(expiresAt).toBeGreaterThan(now + 4 * 60 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(now + 6 * 60 * 1000);
  });

  it("separate middleware instances with the same store share state", async () => {
    const store = new MemoryStore();
    const mw1 = createAgentDoorMiddleware({ ...TEST_CONFIG, store });
    const mw2 = createAgentDoorMiddleware({ ...TEST_CONFIG, store });

    // Register through mw1
    const pk = uniquePublicKey();
    const registerRes = await mw1(
      createMockRequest("POST", "/agentdoor/register", {
        body: {
          public_key: pk,
          scopes_requested: ["data.read"],
        },
      }),
    );
    const registerBody = await registerRes.json();

    // Verify through mw2 — should find the challenge in the shared store
    const importKeySpy = vi
      .spyOn(crypto.subtle, "importKey")
      .mockResolvedValue({} as CryptoKey);
    const verifySpy = vi
      .spyOn(crypto.subtle, "verify")
      .mockResolvedValue(true);

    const verifyRes = await mw2(
      createMockRequest("POST", "/agentdoor/register/verify", {
        body: {
          agent_id: registerBody.agent_id,
          signature: btoa("test-sig"),
        },
      }),
    );

    expect(verifyRes.status).toBe(200);
    const verifyBody = await verifyRes.json();
    expect(verifyBody.api_key).toBeDefined();

    importKeySpy.mockRestore();
    verifySpy.mockRestore();
  });
});

// ===========================================================================
//  WEBHOOK EMISSION TESTS (Task 3.7 — verify webhooks fire in Next.js)
// ===========================================================================

describe("webhook emission", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("OK", { status: 200 }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("fires agent.registered webhook after successful verification", async () => {
    const mw = createAgentDoorMiddleware({
      ...TEST_CONFIG,
      webhooks: {
        endpoints: [
          { url: "https://example.com/webhook" },
        ],
      },
    });

    await registerAndVerifyAgent(mw);

    // Allow fire-and-forget fetch to settle
    await new Promise((r) => setTimeout(r, 50));

    // Should have been called with the webhook endpoint
    const webhookCalls = fetchSpy.mock.calls.filter(
      (call) => call[0] === "https://example.com/webhook",
    );
    expect(webhookCalls.length).toBeGreaterThanOrEqual(1);

    // Verify the payload contains agent.registered event
    const registeredCall = webhookCalls.find((call) => {
      const body = JSON.parse(call[1]?.body as string);
      return body.type === "agent.registered";
    });
    expect(registeredCall).toBeDefined();

    const payload = JSON.parse(registeredCall![1]?.body as string);
    expect(payload.type).toBe("agent.registered");
    expect(payload.data.agent_id).toBeDefined();
    expect(payload.timestamp).toBeDefined();
  });

  it("fires agent.authenticated webhook after successful auth", async () => {
    const mw = createAgentDoorMiddleware({
      ...TEST_CONFIG,
      webhooks: {
        endpoints: [
          { url: "https://example.com/webhook" },
        ],
      },
    });

    const { agentId } = await registerAndVerifyAgent(mw);

    // Clear previous fetch calls
    fetchSpy.mockClear();

    // Authenticate the agent
    const importKeySpy = vi
      .spyOn(crypto.subtle, "importKey")
      .mockResolvedValue({} as CryptoKey);
    const verifySpy = vi
      .spyOn(crypto.subtle, "verify")
      .mockResolvedValue(true);

    const authRes = await mw(
      createMockRequest("POST", "/agentdoor/auth", {
        body: {
          agent_id: agentId,
          signature: btoa("auth-sig"),
          timestamp: new Date().toISOString(),
        },
      }),
    );

    expect(authRes.status).toBe(200);

    // Allow fire-and-forget fetch to settle
    await new Promise((r) => setTimeout(r, 50));

    const webhookCalls = fetchSpy.mock.calls.filter(
      (call) => call[0] === "https://example.com/webhook",
    );
    expect(webhookCalls.length).toBeGreaterThanOrEqual(1);

    const authCall = webhookCalls.find((call) => {
      const body = JSON.parse(call[1]?.body as string);
      return body.type === "agent.authenticated";
    });
    expect(authCall).toBeDefined();

    const payload = JSON.parse(authCall![1]?.body as string);
    expect(payload.type).toBe("agent.authenticated");
    expect(payload.data.agent_id).toBe(agentId);

    importKeySpy.mockRestore();
    verifySpy.mockRestore();
  });

  it("does not fire webhooks when no endpoints are configured", async () => {
    const mw = createAgentDoorMiddleware(TEST_CONFIG);

    await registerAndVerifyAgent(mw);

    await new Promise((r) => setTimeout(r, 50));

    // fetch should not have been called for webhooks (only for internal crypto etc.)
    const webhookCalls = fetchSpy.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("webhook"),
    );
    expect(webhookCalls).toHaveLength(0);
  });

  it("respects endpoint event filtering", async () => {
    const mw = createAgentDoorMiddleware({
      ...TEST_CONFIG,
      webhooks: {
        endpoints: [
          {
            url: "https://example.com/auth-only",
            events: ["agent.authenticated"],
          },
        ],
      },
    });

    await registerAndVerifyAgent(mw);

    await new Promise((r) => setTimeout(r, 50));

    // The endpoint only subscribes to agent.authenticated, so
    // agent.registered should NOT be sent to it.
    const webhookCalls = fetchSpy.mock.calls.filter(
      (call) => call[0] === "https://example.com/auth-only",
    );

    for (const call of webhookCalls) {
      const body = JSON.parse(call[1]?.body as string);
      expect(body.type).not.toBe("agent.registered");
    }
  });

  it("silently handles webhook delivery failures", async () => {
    fetchSpy.mockRejectedValue(new Error("Network error"));

    const mw = createAgentDoorMiddleware({
      ...TEST_CONFIG,
      webhooks: {
        endpoints: [
          { url: "https://example.com/webhook" },
        ],
      },
    });

    // Should not throw even when webhook delivery fails
    const { agentId } = await registerAndVerifyAgent(mw);
    expect(agentId).toBeDefined();

    await new Promise((r) => setTimeout(r, 50));
  });

  it("sends correct headers with webhook payload", async () => {
    const mw = createAgentDoorMiddleware({
      ...TEST_CONFIG,
      webhooks: {
        endpoints: [
          { url: "https://example.com/webhook" },
        ],
      },
    });

    await registerAndVerifyAgent(mw);

    await new Promise((r) => setTimeout(r, 50));

    const webhookCalls = fetchSpy.mock.calls.filter(
      (call) => call[0] === "https://example.com/webhook",
    );
    expect(webhookCalls.length).toBeGreaterThanOrEqual(1);

    const headers = webhookCalls[0][1]?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["User-Agent"]).toBe("AgentDoor-Webhooks/1.0");
    expect(headers["X-AgentDoor-Event"]).toBeDefined();
  });
});

// ===========================================================================
//  REPUTATION GATING TESTS (Task 3.8 — ReputationManager integration)
// ===========================================================================

describe("reputation gating with ReputationManager", () => {
  it("blocks agent with reputation below block gate threshold", async () => {
    const store = new MemoryStore();
    const mw = createAgentDoorMiddleware({
      ...TEST_CONFIG,
      store,
      reputation: {
        gates: [{ minReputation: 60, action: "block" as const }],
      },
    });

    // Register an agent
    const { agentId, apiKey } = await registerAndVerifyAgent(mw);

    // Set agent reputation to 30 (below the 60 threshold)
    await store.updateAgent(agentId, { reputation: 30 });

    // Try to access a protected route
    const res = await mw(
      createMockRequest("GET", "/api/data", {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Insufficient reputation");
    expect(body.required).toBe(60);
    expect(body.current).toBe(30);
  });

  it("allows agent with reputation above block gate threshold", async () => {
    const store = new MemoryStore();
    const mw = createAgentDoorMiddleware({
      ...TEST_CONFIG,
      store,
      reputation: {
        gates: [{ minReputation: 30, action: "block" as const }],
      },
    });

    const { agentId, apiKey } = await registerAndVerifyAgent(mw);

    // Agent starts at reputation 50, which is above the 30 threshold
    const res = await mw(
      createMockRequest("GET", "/api/data", {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-agentdoor-authenticated")).toBe("true");
  });

  it("allows agent through with warn action but adds warning header", async () => {
    const store = new MemoryStore();
    const mw = createAgentDoorMiddleware({
      ...TEST_CONFIG,
      store,
      reputation: {
        gates: [{ minReputation: 60, action: "warn" as const }],
      },
    });

    const { agentId, apiKey } = await registerAndVerifyAgent(mw);

    // Set reputation below the warn threshold
    await store.updateAgent(agentId, { reputation: 40 });

    const res = await mw(
      createMockRequest("GET", "/api/data", {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-agentdoor-authenticated")).toBe("true");
    expect(res.headers.get("x-agentdoor-reputation-warning")).toContain("score=40");
    expect(res.headers.get("x-agentdoor-reputation-warning")).toContain("required=60");
  });

  it("does not block when no reputation gates are configured", async () => {
    const store = new MemoryStore();
    const mw = createAgentDoorMiddleware({
      ...TEST_CONFIG,
      store,
    });

    const { agentId, apiKey } = await registerAndVerifyAgent(mw);

    // Set very low reputation
    await store.updateAgent(agentId, { reputation: 5 });

    const res = await mw(
      createMockRequest("GET", "/api/data", {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-agentdoor-authenticated")).toBe("true");
  });

  it("updates reputation on successful authenticated request", async () => {
    const store = new MemoryStore();
    const mw = createAgentDoorMiddleware({
      ...TEST_CONFIG,
      store,
    });

    const { agentId, apiKey } = await registerAndVerifyAgent(mw);

    // Set a known starting reputation
    await store.updateAgent(agentId, { reputation: 50 });

    // Make a successful authenticated request
    const res = await mw(
      createMockRequest("GET", "/api/data", {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
    );

    expect(res.status).toBe(200);

    // Check that reputation increased (request_success weight is +0.1)
    const agent = await store.getAgent(agentId);
    expect(agent!.reputation).toBeCloseTo(50.1, 1);
  });

  it("updates reputation on blocked request (block gate)", async () => {
    const store = new MemoryStore();
    const mw = createAgentDoorMiddleware({
      ...TEST_CONFIG,
      store,
      reputation: {
        gates: [{ minReputation: 60, action: "block" as const }],
      },
    });

    const { agentId, apiKey } = await registerAndVerifyAgent(mw);

    // Set reputation below threshold
    await store.updateAgent(agentId, { reputation: 30 });

    // Make a request that gets blocked
    const res = await mw(
      createMockRequest("GET", "/api/data", {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
    );

    expect(res.status).toBe(403);

    // Check that reputation decreased (request_error weight is -0.5)
    const agent = await store.getAgent(agentId);
    expect(agent!.reputation).toBeCloseTo(29.5, 1);
  });

  it("supports scope-specific gates via ReputationManager", async () => {
    // Verify ReputationManager correctly handles scope-specific gates
    const mgr = new ReputationManager({
      gates: [
        { minReputation: 80, scopes: ["data.write"], action: "block" },
        { minReputation: 20, action: "block" },
      ],
    });

    // Score 50 should pass the global gate (minReputation: 20)
    const globalResult = mgr.checkGate(50);
    expect(globalResult.allowed).toBe(true);

    // Score 50 should fail the scoped gate for data.write (minReputation: 80)
    const scopedResult = mgr.checkGate(50, "data.write");
    expect(scopedResult.allowed).toBe(false);
    expect(scopedResult.requiredScore).toBe(80);
  });
});
