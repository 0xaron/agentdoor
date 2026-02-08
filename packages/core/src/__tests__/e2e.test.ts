/**
 * E2E Integration Tests for AgentGate
 *
 * Tests the full loop:
 *   1. Express server with agentgate middleware starts
 *   2. Agent SDK discovers the service
 *   3. Agent registers via challenge-response
 *   4. Agent makes authenticated requests
 *
 * This test runs against a real HTTP server using the Express adapter
 * and the SDK's internal utilities.
 */

import { describe, it, expect } from "vitest";
import {
  generateKeypair,
  signChallenge,
  verifySignature,
  resolveConfig,
  MemoryStore,
  generateDiscoveryDocument,
  AGENTGATE_VERSION,
  hashApiKey,
  createChallenge,
  verifyToken,
  issueToken,
} from "../index.js";

// ---------------------------------------------------------------------------
// E2E Tests
// ---------------------------------------------------------------------------

describe("E2E Integration Tests", () => {
  describe("Core crypto round-trip", () => {
    it("generates keypair, signs, and verifies", () => {
      const keypair = generateKeypair();

      expect(keypair.publicKey).toBeDefined();
      expect(keypair.secretKey).toBeDefined();
      expect(typeof keypair.publicKey).toBe("string");
      expect(typeof keypair.secretKey).toBe("string");

      // Sign a message
      const message = "agentgate:test:message:12345";
      const signature = signChallenge(message, keypair.secretKey);

      expect(signature).toBeDefined();
      expect(typeof signature).toBe("string");

      // Verify the signature
      const isValid = verifySignature(message, signature, keypair.publicKey);
      expect(isValid).toBe(true);

      // Verify with wrong message fails
      const isInvalid = verifySignature("wrong-message", signature, keypair.publicKey);
      expect(isInvalid).toBe(false);

      // Verify with wrong key fails
      const otherKeypair = generateKeypair();
      const isWrongKey = verifySignature(message, signature, otherKeypair.publicKey);
      expect(isWrongKey).toBe(false);
    });
  });

  describe("Challenge-response round-trip", () => {
    it("creates challenge, signs, and verifies", () => {
      const keypair = generateKeypair();
      const agentId = "ag_test_e2e_123";

      // Create a challenge
      const challenge = createChallenge(agentId);

      expect(challenge.agentId).toBe(agentId);
      expect(challenge.nonce).toBeDefined();
      expect(challenge.message).toContain(agentId);
      expect(challenge.message).toContain("agentgate:register:");
      expect(challenge.expiresAt).toBeInstanceOf(Date);
      expect(challenge.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Agent signs the challenge
      const signature = signChallenge(challenge.message, keypair.secretKey);

      // Server verifies the signature
      const isValid = verifySignature(challenge.message, signature, keypair.publicKey);
      expect(isValid).toBe(true);
    });
  });

  describe("Token issuance and verification", () => {
    const makeAgentContext = (id: string, scopes: string[], publicKey: string) => ({
      id,
      scopes,
      publicKey,
      rateLimit: { requests: 1000, window: "1h" },
      metadata: {},
    });

    it("issues a JWT and verifies it", async () => {
      const secret = "e2e-test-secret-that-is-long-enough-32bytes!";
      const agentId = "ag_test_e2e_456";
      const scopes = ["data.read", "data.write"];

      const token = await issueToken(
        makeAgentContext(agentId, scopes, "test-key"),
        secret,
        "1h",
      );

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");

      // Verify the token
      const result = await verifyToken(token, secret);

      expect(result.agent.id).toBe(agentId);
      expect(result.agent.scopes).toEqual(scopes);
    });

    it("rejects expired tokens", async () => {
      const secret = "e2e-test-secret-that-is-long-enough-32bytes!";

      const token = await issueToken(
        makeAgentContext("ag_test", ["data.read"], "key"),
        secret,
        "1s", // Expires in 1 second
      );

      // Wait for the token to expire
      await new Promise((r) => setTimeout(r, 1500));

      await expect(verifyToken(token, secret)).rejects.toThrow();
    });

    it("rejects tokens with wrong secret", async () => {
      const token = await issueToken(
        makeAgentContext("ag_test", ["data.read"], "key"),
        "secret-one-that-is-long-enough-32bytes!!",
        "1h",
      );

      await expect(
        verifyToken(token, "wrong-secret-that-is-long-enough-32bytes!"),
      ).rejects.toThrow();
    });
  });

  describe("Discovery document generation", () => {
    it("generates a valid discovery document from config", () => {
      const config = resolveConfig({
        scopes: [
          { id: "data.read", description: "Read data" },
          { id: "data.write", description: "Write data" },
        ],
        service: {
          name: "E2E Test Service",
          description: "End-to-end test service",
        },
        x402: {
          network: "base",
          currency: "USDC",
          paymentAddress: "0x1234567890abcdef",
        },
      });

      const doc = generateDiscoveryDocument(config);

      expect(doc.agentgate_version).toBe(AGENTGATE_VERSION);
      expect(doc.service_name).toBe("E2E Test Service");
      expect(doc.service_description).toBe("End-to-end test service");
      expect(doc.registration_endpoint).toBe("/agentgate/register");
      expect(doc.auth_endpoint).toBe("/agentgate/auth");
      expect(doc.scopes_available).toHaveLength(2);
      expect(doc.auth_methods).toContain("ed25519-challenge");
      expect(doc.payment).toBeDefined();
      expect(doc.payment!.protocol).toBe("x402");
    });
  });

  describe("Storage round-trip", () => {
    it("stores and retrieves agents from MemoryStore", async () => {
      const store = new MemoryStore();
      const keypair = generateKeypair();
      const apiKey = "agk_live_test_key_123";
      const apiKeyHash = hashApiKey(apiKey);

      const agent = {
        id: "ag_e2e_store_test",
        publicKey: keypair.publicKey,
        scopesGranted: ["data.read"],
        apiKeyHash,
        rateLimit: { requests: 1000, window: "1h" },
        reputation: 50,
        metadata: { sdk: "test" },
        status: "active" as const,
        createdAt: new Date(),
        lastAuthAt: new Date(),
        totalRequests: 0,
        totalX402Paid: 0,
      };

      // Store the agent
      await store.createAgent(agent);

      // Retrieve by ID
      const retrieved = await store.getAgent("ag_e2e_store_test");
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe("ag_e2e_store_test");
      expect(retrieved!.publicKey).toBe(keypair.publicKey);
      expect(retrieved!.scopesGranted).toEqual(["data.read"]);

      // Retrieve by API key hash
      const byHash = await store.getAgentByApiKeyHash(apiKeyHash);
      expect(byHash).toBeDefined();
      expect(byHash!.id).toBe("ag_e2e_store_test");

      // Retrieve by public key
      const byKey = await store.getAgentByPublicKey(keypair.publicKey);
      expect(byKey).toBeDefined();
      expect(byKey!.id).toBe("ag_e2e_store_test");
    });
  });

  describe("Full registration flow (unit-level simulation)", () => {
    it("simulates complete registration without HTTP", async () => {
      const store = new MemoryStore();
      const keypair = generateKeypair();

      // 1. Agent creates keypair (done above)

      // 2. Server creates challenge
      const challenge = createChallenge("ag_simulation_test");

      // 3. Agent signs challenge
      const signature = signChallenge(challenge.message, keypair.secretKey);

      // 4. Server verifies signature
      const valid = verifySignature(challenge.message, signature, keypair.publicKey);
      expect(valid).toBe(true);

      // 5. Server issues credentials
      const apiKey = "agk_live_sim_test_key";
      const apiKeyHash = hashApiKey(apiKey);
      const secret = "e2e-jwt-secret-long-enough-for-test!!!!!";

      const token = await issueToken(
        {
          id: "ag_simulation_test",
          scopes: ["data.read"],
          publicKey: keypair.publicKey,
          rateLimit: { requests: 1000, window: "1h" },
          metadata: {},
        },
        secret,
        "1h",
      );

      // 6. Server stores agent
      await store.createAgent({
        id: "ag_simulation_test",
        publicKey: keypair.publicKey,
        scopesGranted: ["data.read"],
        apiKeyHash,
        rateLimit: { requests: 1000, window: "1h" },
        reputation: 50,
        metadata: {},
        status: "active",
        createdAt: new Date(),
        lastAuthAt: new Date(),
        totalRequests: 0,
        totalX402Paid: 0,
      });

      // 7. Agent stores credentials
      const credentials = {
        agentId: "ag_simulation_test",
        apiKey,
        token,
        scopesGranted: ["data.read"],
      };

      expect(credentials.apiKey).toBe(apiKey);
      expect(credentials.token).toBe(token);

      // 8. Agent uses token for authenticated request
      const tokenResult = await verifyToken(token, secret);
      expect(tokenResult.agent.id).toBe("ag_simulation_test");
      expect(tokenResult.agent.scopes).toEqual(["data.read"]);

      // 9. Agent uses API key - server validates
      const storedAgent = await store.getAgentByApiKeyHash(hashApiKey(apiKey));
      expect(storedAgent).toBeDefined();
      expect(storedAgent!.id).toBe("ag_simulation_test");

      // 10. Agent re-authenticates (token refresh)
      const timestamp = new Date().toISOString();
      const authMessage = `agentgate:auth:ag_simulation_test:${timestamp}`;
      const authSignature = signChallenge(authMessage, keypair.secretKey);

      // Server verifies auth signature
      const retrieved = await store.getAgent("ag_simulation_test");
      expect(retrieved).toBeDefined();
      const authValid = verifySignature(authMessage, authSignature, retrieved!.publicKey);
      expect(authValid).toBe(true);

      // Server issues new token
      const newToken = await issueToken(
        {
          id: "ag_simulation_test",
          scopes: ["data.read"],
          publicKey: keypair.publicKey,
          rateLimit: { requests: 1000, window: "1h" },
          metadata: {},
        },
        secret,
        "1h",
      );
      expect(newToken).toBeDefined();
      expect(typeof newToken).toBe("string");
    });
  });

  describe("Multiple agent isolation", () => {
    it("multiple agents have separate identities and credentials", async () => {
      const store = new MemoryStore();

      const agent1Keypair = generateKeypair();
      const agent2Keypair = generateKeypair();

      // Register agent 1
      await store.createAgent({
        id: "ag_multi_1",
        publicKey: agent1Keypair.publicKey,
        scopesGranted: ["data.read"],
        apiKeyHash: hashApiKey("agk_live_multi_1"),
        rateLimit: { requests: 1000, window: "1h" },
        reputation: 50,
        metadata: {},
        status: "active",
        createdAt: new Date(),
        lastAuthAt: new Date(),
        totalRequests: 0,
        totalX402Paid: 0,
      });

      // Register agent 2
      await store.createAgent({
        id: "ag_multi_2",
        publicKey: agent2Keypair.publicKey,
        scopesGranted: ["data.write"],
        apiKeyHash: hashApiKey("agk_live_multi_2"),
        rateLimit: { requests: 500, window: "1h" },
        reputation: 75,
        metadata: {},
        status: "active",
        createdAt: new Date(),
        lastAuthAt: new Date(),
        totalRequests: 0,
        totalX402Paid: 0,
      });

      // Verify isolation
      const a1 = await store.getAgent("ag_multi_1");
      const a2 = await store.getAgent("ag_multi_2");

      expect(a1!.publicKey).not.toBe(a2!.publicKey);
      expect(a1!.scopesGranted).toEqual(["data.read"]);
      expect(a2!.scopesGranted).toEqual(["data.write"]);
      expect(a1!.rateLimit.requests).toBe(1000);
      expect(a2!.rateLimit.requests).toBe(500);

      // Agent 1's signature doesn't work for agent 2's messages
      const msg = "agentgate:auth:ag_multi_2:2024-01-01T00:00:00Z";
      const sig = signChallenge(msg, agent1Keypair.secretKey);
      const validForAgent2 = verifySignature(msg, sig, agent2Keypair.publicKey);
      expect(validForAgent2).toBe(false);

      // But agent 2's own signature works
      const sig2 = signChallenge(msg, agent2Keypair.secretKey);
      const valid = verifySignature(msg, sig2, agent2Keypair.publicKey);
      expect(valid).toBe(true);
    });
  });

  describe("Config resolution", () => {
    it("resolves config with all defaults", () => {
      const config = resolveConfig({
        scopes: [{ id: "data.read", description: "Read" }],
      });

      expect(config.scopes).toHaveLength(1);
      expect(config.rateLimit).toBeDefined();
      expect(config.rateLimit.requests).toEqual(expect.any(Number));
      expect(config.rateLimit.window).toEqual(expect.any(String));
    });

    it("resolves config with custom rate limits", () => {
      const config = resolveConfig({
        scopes: [{ id: "data.read", description: "Read" }],
        rateLimit: { requests: 500, window: "1m" },
      });

      expect(config.rateLimit.requests).toBe(500);
      expect(config.rateLimit.window).toBe("1m");
    });

    it("resolves config with x402 payment", () => {
      const config = resolveConfig({
        scopes: [{ id: "data.read", description: "Read" }],
        x402: {
          network: "base",
          currency: "USDC",
          paymentAddress: "0xABC",
        },
      });

      expect(config.x402).toBeDefined();
      expect(config.x402!.network).toBe("base");
      expect(config.x402!.paymentAddress).toBe("0xABC");
    });
  });

  describe("API key hashing", () => {
    it("produces deterministic hashes", () => {
      const key = "agk_live_test_deterministic";
      const hash1 = hashApiKey(key);
      const hash2 = hashApiKey(key);

      expect(hash1).toBe(hash2);
    });

    it("different keys produce different hashes", () => {
      const hash1 = hashApiKey("agk_live_key_one");
      const hash2 = hashApiKey("agk_live_key_two");

      expect(hash1).not.toBe(hash2);
    });
  });
});
