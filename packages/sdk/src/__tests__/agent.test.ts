import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentDoor, AgentDoorError } from "../agent.js";
import type { AgentDoorDiscoveryDocument } from "../discovery.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal discovery document. */
const mockDiscovery: AgentDoorDiscoveryDocument = {
  agentdoor_version: "1.0",
  service_name: "Test Service",
  registration_endpoint: "/agentdoor/register",
  auth_endpoint: "/agentdoor/auth",
  scopes_available: [
    { id: "data.read", description: "Read data" },
    { id: "data.write", description: "Write data" },
  ],
};

/** Create a temporary directory for test keys/credentials. */
function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentdoor-test-"));
}

/** Clean up temp directory. */
function cleanupTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Build a mock fetch that returns different responses for different URL patterns.
 */
function createMockFetch(options: {
  discoveryDoc?: AgentDoorDiscoveryDocument;
  registerResponse?: Record<string, unknown>;
  verifyResponse?: Record<string, unknown>;
  authResponse?: Record<string, unknown>;
  failStatus?: number;
  failUrl?: string;
}) {
  const {
    discoveryDoc = mockDiscovery,
    registerResponse = {
      agent_id: "ag_testAgent123",
      challenge: {
        nonce: "testnonce123",
        message: "agentdoor:register:ag_testAgent123:2024-01-01T00:00:00Z:testnonce123",
        expires_at: new Date(Date.now() + 300_000).toISOString(),
      },
    },
    verifyResponse = {
      agent_id: "ag_testAgent123",
      api_key: "agk_live_testkey1234567890abcdef",
      scopes_granted: ["data.read", "data.write"],
      token: "jwt.token.here",
      token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      rate_limit: { requests: 1000, window: "1h" },
    },
    authResponse = {
      token: "jwt.refreshed.token",
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    },
    failStatus,
    failUrl,
  } = options;

  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const fetchFn: typeof globalThis.fetch = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const urlStr = typeof url === "string" ? url : url.toString();
    calls.push({ url: urlStr, init });

    // Check for forced failure
    if (failStatus && failUrl && urlStr.includes(failUrl)) {
      return new Response(JSON.stringify({ error: "forced error" }), {
        status: failStatus,
      });
    }

    // Route based on URL
    if (urlStr.includes(".well-known/agentdoor.json")) {
      return new Response(JSON.stringify(discoveryDoc), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (urlStr.includes("/agentdoor/register/verify")) {
      return new Response(JSON.stringify(verifyResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (urlStr.includes("/agentdoor/register")) {
      return new Response(JSON.stringify(registerResponse), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (urlStr.includes("/agentdoor/auth")) {
      return new Response(JSON.stringify(authResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  };

  return { fetchFn, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentDoor", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  describe("constructor", () => {
    it("creates an instance with default options", () => {
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        ephemeral: true,
      });
      expect(agent).toBeInstanceOf(AgentDoor);
    });

    it("exposes the public key", () => {
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        ephemeral: true,
      });
      expect(typeof agent.publicKey).toBe("string");
      expect(agent.publicKey.length).toBeGreaterThan(0);
    });

    it("generates a keypair on disk if none exists", () => {
      const keyPath = path.join(tmpDir, "newkeys.json");
      expect(fs.existsSync(keyPath)).toBe(false);

      new AgentDoor({ keyPath });
      expect(fs.existsSync(keyPath)).toBe(true);
    });

    it("reuses existing keypair from disk", () => {
      const keyPath = path.join(tmpDir, "keys.json");
      const agent1 = new AgentDoor({ keyPath, ephemeral: true });
      const agent2 = new AgentDoor({ keyPath, ephemeral: true });
      expect(agent1.publicKey).toBe(agent2.publicKey);
    });
  });

  describe("connect - full discovery → register → verify → session flow", () => {
    it("completes the full registration flow", async () => {
      const { fetchFn, calls } = createMockFetch({});
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        ephemeral: true,
        fetchFn,
      });

      const session = await agent.connect("https://api.example.com");

      expect(session).toBeDefined();
      // Should have made 3 calls: discovery, register, verify
      const discoveryCall = calls.find((c) =>
        c.url.includes("agentdoor.json"),
      );
      const registerCall = calls.find(
        (c) => c.url.includes("/register") && !c.url.includes("/verify"),
      );
      const verifyCall = calls.find((c) => c.url.includes("/verify"));

      expect(discoveryCall).toBeDefined();
      expect(registerCall).toBeDefined();
      expect(verifyCall).toBeDefined();
    });

    it("normalizes URL without scheme to https", async () => {
      const { fetchFn, calls } = createMockFetch({});
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        ephemeral: true,
        fetchFn,
      });

      await agent.connect("api.example.com");

      expect(calls[0].url).toContain("https://api.example.com");
    });

    it("strips trailing slashes from URL", async () => {
      const { fetchFn, calls } = createMockFetch({});
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        ephemeral: true,
        fetchFn,
      });

      await agent.connect("https://api.example.com///");

      expect(calls[0].url).not.toMatch(/\/\/\//);
    });
  });

  describe("credential caching", () => {
    it("caches credentials after registration in non-ephemeral mode", async () => {
      const { fetchFn } = createMockFetch({});
      const credPath = path.join(tmpDir, "creds.json");
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        credentialsPath: credPath,
        fetchFn,
      });

      await agent.connect("https://api.example.com");

      expect(fs.existsSync(credPath)).toBe(true);
    });

    it("does not cache credentials in ephemeral mode", async () => {
      const { fetchFn } = createMockFetch({});
      const credPath = path.join(tmpDir, "creds.json");
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        credentialsPath: credPath,
        ephemeral: true,
        fetchFn,
      });

      await agent.connect("https://api.example.com");

      expect(fs.existsSync(credPath)).toBe(false);
    });

    it("second connect() uses cached credentials (skips registration)", async () => {
      const { fetchFn, calls } = createMockFetch({});
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        credentialsPath: path.join(tmpDir, "creds.json"),
        fetchFn,
      });

      await agent.connect("https://api.example.com");
      const callsAfterFirst = calls.length;

      await agent.connect("https://api.example.com");

      // Second connect should only make the discovery call, not register + verify
      const additionalCalls = calls.length - callsAfterFirst;
      // Should reuse cached credentials (only discovery or no calls at all)
      expect(additionalCalls).toBeLessThan(3);
    });
  });

  describe("error handling", () => {
    it("throws on 409 (already registered)", async () => {
      const { fetchFn } = createMockFetch({
        failStatus: 409,
        failUrl: "/register",
      });
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        ephemeral: true,
        fetchFn,
      });

      await expect(agent.connect("https://api.example.com")).rejects.toThrow(
        AgentDoorError,
      );

      try {
        await agent.connect("https://api.example.com");
      } catch (e) {
        expect((e as AgentDoorError).code).toBe("ALREADY_REGISTERED");
      }
    });

    it("throws on 429 (rate limited)", async () => {
      const { fetchFn } = createMockFetch({
        failStatus: 429,
        failUrl: "/register",
      });
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        ephemeral: true,
        fetchFn,
      });

      try {
        await agent.connect("https://api.example.com");
      } catch (e) {
        expect(e).toBeInstanceOf(AgentDoorError);
        expect((e as AgentDoorError).code).toBe("RATE_LIMITED");
      }
    });

    it("throws on 410 (challenge expired)", async () => {
      const { fetchFn } = createMockFetch({
        failStatus: 410,
        failUrl: "/verify",
      });
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        ephemeral: true,
        fetchFn,
      });

      try {
        await agent.connect("https://api.example.com");
      } catch (e) {
        expect(e).toBeInstanceOf(AgentDoorError);
        expect((e as AgentDoorError).code).toBe("CHALLENGE_EXPIRED");
      }
    });

    it("throws on invalid registration response", async () => {
      const { fetchFn } = createMockFetch({
        registerResponse: { some: "invalid response" },
      });
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        ephemeral: true,
        fetchFn,
      });

      await expect(agent.connect("https://api.example.com")).rejects.toThrow(
        "missing agent_id or challenge",
      );
    });

    it("throws on invalid verify response", async () => {
      const { fetchFn } = createMockFetch({
        verifyResponse: { agent_id: "ag_test" }, // missing api_key
      });
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        ephemeral: true,
        fetchFn,
      });

      await expect(agent.connect("https://api.example.com")).rejects.toThrow(
        "missing api_key",
      );
    });
  });

  describe("ephemeral mode", () => {
    it("does not persist credentials when ephemeral is true", async () => {
      const { fetchFn } = createMockFetch({});
      const credPath = path.join(tmpDir, "ephemeral-creds.json");
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        credentialsPath: credPath,
        ephemeral: true,
        fetchFn,
      });

      await agent.connect("https://api.example.com");

      expect(fs.existsSync(credPath)).toBe(false);
    });
  });

  describe("x402 wallet identity registration", () => {
    it("includes wallet address in registration body", async () => {
      const { fetchFn, calls } = createMockFetch({});
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        ephemeral: true,
        fetchFn,
        x402Wallet: {
          address: "0xABCD1234",
          network: "base",
          currency: "USDC",
        },
      });

      await agent.connect("https://api.example.com");

      const registerCall = calls.find(
        (c) => c.url.includes("/register") && !c.url.includes("/verify"),
      );
      const body = JSON.parse(registerCall?.init?.body as string);
      expect(body.x402_wallet).toBe("0xABCD1234");
    });

    it("accepts a string wallet address shorthand", async () => {
      const { fetchFn, calls } = createMockFetch({});
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        ephemeral: true,
        fetchFn,
        x402Wallet: "0xABCD1234",
      });

      await agent.connect("https://api.example.com");

      const registerCall = calls.find(
        (c) => c.url.includes("/register") && !c.url.includes("/verify"),
      );
      const body = JSON.parse(registerCall?.init?.body as string);
      expect(body.x402_wallet).toBe("0xABCD1234");
    });
  });

  describe("scope filtering", () => {
    it("requests only specified scopes when scopesRequested is set", async () => {
      const { fetchFn, calls } = createMockFetch({});
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        ephemeral: true,
        fetchFn,
        scopesRequested: ["data.read"],
      });

      await agent.connect("https://api.example.com");

      const registerCall = calls.find(
        (c) => c.url.includes("/register") && !c.url.includes("/verify"),
      );
      const body = JSON.parse(registerCall?.init?.body as string);
      expect(body.scopes_requested).toEqual(["data.read"]);
    });

    it("throws when no matching scopes found", async () => {
      const { fetchFn } = createMockFetch({});
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        ephemeral: true,
        fetchFn,
        scopesRequested: ["nonexistent.scope"],
      });

      await expect(
        agent.connect("https://api.example.com"),
      ).rejects.toThrow("No matching scopes");
    });

    it("requests all available scopes when scopesRequested is not set", async () => {
      const { fetchFn, calls } = createMockFetch({});
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        ephemeral: true,
        fetchFn,
      });

      await agent.connect("https://api.example.com");

      const registerCall = calls.find(
        (c) => c.url.includes("/register") && !c.url.includes("/verify"),
      );
      const body = JSON.parse(registerCall?.init?.body as string);
      expect(body.scopes_requested).toEqual(["data.read", "data.write"]);
    });
  });

  describe("metadata", () => {
    it("sends default SDK metadata", async () => {
      const { fetchFn, calls } = createMockFetch({});
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        ephemeral: true,
        fetchFn,
      });

      await agent.connect("https://api.example.com");

      const registerCall = calls.find(
        (c) => c.url.includes("/register") && !c.url.includes("/verify"),
      );
      const body = JSON.parse(registerCall?.init?.body as string);
      expect(body.metadata.sdk).toBe("agentdoor-sdk");
    });

    it("merges custom metadata with defaults", async () => {
      const { fetchFn, calls } = createMockFetch({});
      const agent = new AgentDoor({
        keyPath: path.join(tmpDir, "keys.json"),
        ephemeral: true,
        fetchFn,
        metadata: { agent_name: "my-agent" },
      });

      await agent.connect("https://api.example.com");

      const registerCall = calls.find(
        (c) => c.url.includes("/register") && !c.url.includes("/verify"),
      );
      const body = JSON.parse(registerCall?.init?.body as string);
      expect(body.metadata.agent_name).toBe("my-agent");
      expect(body.metadata.sdk).toBe("agentdoor-sdk");
    });
  });
});

// We need the afterEach import
import { afterEach } from "vitest";
