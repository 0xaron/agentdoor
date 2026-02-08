/**
 * Integration Test — Full AgentGate Lifecycle
 *
 * Tests the complete flow in a single coherent sequence:
 *   config → store → challenge → verify → token
 *
 * Uses MemoryStore and exercises the real crypto, challenge,
 * config, and token modules together (no mocks).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  // Config
  resolveConfig,
  // Crypto
  generateKeypair,
  generateAgentId,
  generateApiKey,
  hashApiKey,
  signChallenge,
  verifySignature,
  // Challenge
  createChallenge,
  verifyChallenge,
  // Tokens
  issueToken,
  verifyToken,
  // Storage
  MemoryStore,
  // Discovery
  generateDiscoveryDocument,
  // Constants
  AGENTGATE_VERSION,
} from "../index.js";

import type { ResolvedConfig } from "../config.js";

describe("Integration: config → store → challenge → verify → token", () => {
  let config: ResolvedConfig;
  let store: MemoryStore;

  beforeEach(() => {
    config = resolveConfig({
      scopes: [
        { id: "data.read", description: "Read data" },
        { id: "data.write", description: "Write data" },
      ],
      service: {
        name: "Integration Test Service",
        description: "A service used in integration tests",
      },
      rateLimit: { requests: 1000, window: "1h" },
      jwt: { secret: "integration-test-secret-at-least-32-bytes!!" },
    });

    store = new MemoryStore();
  });

  it("runs the complete agent lifecycle end-to-end", async () => {
    // ---------------------------------------------------------------
    // Step 1: Config — verify the resolved config has all defaults
    // ---------------------------------------------------------------
    expect(config.scopes).toHaveLength(2);
    expect(config.service.name).toBe("Integration Test Service");
    expect(config.rateLimit.requests).toBe(1000);
    expect(config.jwt.secret).toBe(
      "integration-test-secret-at-least-32-bytes!!",
    );
    expect(config.signing.algorithm).toBe("ed25519");
    expect(config.mode).toBe("live");

    // ---------------------------------------------------------------
    // Step 2: Discovery — generate a discovery document from config
    // ---------------------------------------------------------------
    const discoveryDoc = generateDiscoveryDocument(config);
    expect(discoveryDoc.agentgate_version).toBe(AGENTGATE_VERSION);
    expect(discoveryDoc.service_name).toBe("Integration Test Service");
    expect(discoveryDoc.scopes_available).toHaveLength(2);
    expect(discoveryDoc.registration_endpoint).toBe("/agentgate/register");
    expect(discoveryDoc.auth_endpoint).toBe("/agentgate/auth");

    // ---------------------------------------------------------------
    // Step 3: Agent generates a keypair (client side)
    // ---------------------------------------------------------------
    const keypair = generateKeypair();
    expect(keypair.publicKey).toBeDefined();
    expect(keypair.secretKey).toBeDefined();

    // ---------------------------------------------------------------
    // Step 4: Server creates agent ID and challenge
    // ---------------------------------------------------------------
    const agentId = generateAgentId();
    expect(agentId).toMatch(/^ag_/);

    const challenge = createChallenge(agentId);
    expect(challenge.agentId).toBe(agentId);
    expect(challenge.nonce).toBeDefined();
    expect(challenge.message).toContain("agentgate:register:");
    expect(challenge.message).toContain(agentId);
    expect(challenge.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Store the challenge
    await store.createChallenge(challenge);
    const storedChallenge = await store.getChallenge(agentId);
    expect(storedChallenge).not.toBeNull();
    expect(storedChallenge!.message).toBe(challenge.message);

    // ---------------------------------------------------------------
    // Step 5: Agent signs the challenge (client side)
    // ---------------------------------------------------------------
    const signature = signChallenge(challenge.message, keypair.secretKey);
    expect(typeof signature).toBe("string");

    // ---------------------------------------------------------------
    // Step 6: Server verifies the challenge signature
    // ---------------------------------------------------------------
    // Raw verification
    const isValid = verifySignature(
      challenge.message,
      signature,
      keypair.publicKey,
    );
    expect(isValid).toBe(true);

    // Full challenge verification (checks expiry + signature)
    expect(() =>
      verifyChallenge(challenge, signature, keypair.publicKey),
    ).not.toThrow();

    // Wrong signature should fail
    const otherKeypair = generateKeypair();
    const wrongSig = signChallenge(challenge.message, otherKeypair.secretKey);
    expect(() =>
      verifyChallenge(challenge, wrongSig, keypair.publicKey),
    ).toThrow();

    // ---------------------------------------------------------------
    // Step 7: Server registers the agent in the store
    // ---------------------------------------------------------------
    const apiKey = generateApiKey(config.mode);
    expect(apiKey).toMatch(/^agk_live_/);

    const apiKeyHash = hashApiKey(apiKey);

    const agentRecord = await store.createAgent({
      id: agentId,
      publicKey: keypair.publicKey,
      scopesGranted: ["data.read", "data.write"],
      apiKeyHash,
      rateLimit: config.rateLimit,
      metadata: { sdk: "integration-test" },
    });

    expect(agentRecord.id).toBe(agentId);
    expect(agentRecord.publicKey).toBe(keypair.publicKey);
    expect(agentRecord.scopesGranted).toEqual(["data.read", "data.write"]);
    expect(agentRecord.status).toBe("active");
    expect(agentRecord.reputation).toBe(50); // default

    // Clean up the used challenge
    await store.deleteChallenge(agentId);
    expect(await store.getChallenge(agentId)).toBeNull();

    // ---------------------------------------------------------------
    // Step 8: Server issues a JWT token
    // ---------------------------------------------------------------
    const token = await issueToken(
      {
        id: agentId,
        publicKey: keypair.publicKey,
        scopes: ["data.read", "data.write"],
        rateLimit: config.rateLimit,
        metadata: { sdk: "integration-test" },
      },
      config.jwt.secret,
      config.jwt.expiresIn,
    );

    expect(token).toBeDefined();
    expect(typeof token).toBe("string");

    // ---------------------------------------------------------------
    // Step 9: Token verification (on subsequent requests)
    // ---------------------------------------------------------------
    const tokenResult = await verifyToken(token, config.jwt.secret);

    expect(tokenResult.agent.id).toBe(agentId);
    expect(tokenResult.agent.scopes).toEqual(["data.read", "data.write"]);
    expect(tokenResult.agent.publicKey).toBe(keypair.publicKey);
    expect(tokenResult.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(tokenResult.issuedAt.getTime()).toBeLessThanOrEqual(Date.now());

    // ---------------------------------------------------------------
    // Step 10: Verify agent lookup works via store indexes
    // ---------------------------------------------------------------
    const byId = await store.getAgent(agentId);
    expect(byId).not.toBeNull();
    expect(byId!.id).toBe(agentId);

    const byApiKeyHash = await store.getAgentByApiKeyHash(apiKeyHash);
    expect(byApiKeyHash).not.toBeNull();
    expect(byApiKeyHash!.id).toBe(agentId);

    const byPublicKey = await store.getAgentByPublicKey(keypair.publicKey);
    expect(byPublicKey).not.toBeNull();
    expect(byPublicKey!.id).toBe(agentId);

    // ---------------------------------------------------------------
    // Step 11: Wrong secret rejects the token
    // ---------------------------------------------------------------
    await expect(
      verifyToken(token, "wrong-secret-that-is-long-enough-32bytes!!!"),
    ).rejects.toThrow();
  });

  it("rejects registration with duplicate public key", async () => {
    const keypair = generateKeypair();
    const agentId1 = generateAgentId();
    const agentId2 = generateAgentId();
    const apiKey1 = generateApiKey();
    const apiKey2 = generateApiKey();

    await store.createAgent({
      id: agentId1,
      publicKey: keypair.publicKey,
      scopesGranted: ["data.read"],
      apiKeyHash: hashApiKey(apiKey1),
      rateLimit: config.rateLimit,
      metadata: {},
    });

    // Second agent with the same public key should be rejected
    await expect(
      store.createAgent({
        id: agentId2,
        publicKey: keypair.publicKey,
        scopesGranted: ["data.read"],
        apiKeyHash: hashApiKey(apiKey2),
        rateLimit: config.rateLimit,
        metadata: {},
      }),
    ).rejects.toThrow(/already registered/);
  });

  it("issues separate tokens with different scopes", async () => {
    const keypair = generateKeypair();

    const tokenRead = await issueToken(
      {
        id: "ag_reader",
        publicKey: keypair.publicKey,
        scopes: ["data.read"],
        rateLimit: config.rateLimit,
        metadata: {},
      },
      config.jwt.secret,
      "1h",
    );

    const tokenWrite = await issueToken(
      {
        id: "ag_writer",
        publicKey: keypair.publicKey,
        scopes: ["data.read", "data.write"],
        rateLimit: config.rateLimit,
        metadata: {},
      },
      config.jwt.secret,
      "1h",
    );

    const readResult = await verifyToken(tokenRead, config.jwt.secret);
    const writeResult = await verifyToken(tokenWrite, config.jwt.secret);

    expect(readResult.agent.scopes).toEqual(["data.read"]);
    expect(writeResult.agent.scopes).toEqual(["data.read", "data.write"]);
    expect(readResult.agent.id).toBe("ag_reader");
    expect(writeResult.agent.id).toBe("ag_writer");
  });

  it("handles agent update and deletion", async () => {
    const keypair = generateKeypair();
    const agentId = generateAgentId();
    const apiKey = generateApiKey();

    await store.createAgent({
      id: agentId,
      publicKey: keypair.publicKey,
      scopesGranted: ["data.read"],
      apiKeyHash: hashApiKey(apiKey),
      rateLimit: config.rateLimit,
      metadata: {},
    });

    expect(store.agentCount).toBe(1);

    // Update agent
    const updated = await store.updateAgent(agentId, {
      scopesGranted: ["data.read", "data.write"],
      reputation: 75,
      incrementRequests: 10,
    });
    expect(updated.scopesGranted).toEqual(["data.read", "data.write"]);
    expect(updated.reputation).toBe(75);
    expect(updated.totalRequests).toBe(10);

    // Delete agent
    const deleted = await store.deleteAgent(agentId);
    expect(deleted).toBe(true);
    expect(store.agentCount).toBe(0);

    const gone = await store.getAgent(agentId);
    expect(gone).toBeNull();
  });

  it("expires short-lived tokens", async () => {
    const keypair = generateKeypair();

    const shortToken = await issueToken(
      {
        id: "ag_short",
        publicKey: keypair.publicKey,
        scopes: ["data.read"],
        rateLimit: config.rateLimit,
        metadata: {},
      },
      config.jwt.secret,
      "1s", // 1 second expiry
    );

    // Should verify immediately
    const result = await verifyToken(shortToken, config.jwt.secret);
    expect(result.agent.id).toBe("ag_short");

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 1500));

    // Should now be rejected
    await expect(
      verifyToken(shortToken, config.jwt.secret),
    ).rejects.toThrow();
  });
});
