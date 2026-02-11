import { describe, it, expect, beforeEach } from "vitest";
import {
  MemoryStore,
  DuplicateAgentError,
  AgentNotFoundError,
  generateKeypair,
  hashApiKey,
  generateAgentId,
  generateApiKey,
} from "../index.js";
import type { CreateAgentInput, ChallengeData } from "../index.js";

function makeCreateInput(overrides?: Partial<CreateAgentInput>): CreateAgentInput {
  const kp = generateKeypair();
  const apiKey = generateApiKey("test");
  return {
    id: generateAgentId(),
    publicKey: kp.publicKey,
    apiKeyHash: hashApiKey(apiKey),
    scopesGranted: ["test.read"],
    rateLimit: { requests: 100, window: "1h" },
    metadata: { framework: "vitest" },
    ...overrides,
  };
}

describe("MemoryStore - Agent CRUD", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it("createAgent returns an Agent with all fields", async () => {
    const input = makeCreateInput();
    const agent = await store.createAgent(input);

    expect(agent.id).toBe(input.id);
    expect(agent.publicKey).toBe(input.publicKey);
    expect(agent.apiKeyHash).toBe(input.apiKeyHash);
    expect(agent.scopesGranted).toEqual(input.scopesGranted);
    expect(agent.rateLimit).toEqual(input.rateLimit);
    expect(agent.metadata).toEqual(input.metadata);
    expect(agent.status).toBe("active");
    expect(agent.reputation).toBe(50);
    expect(agent.createdAt).toBeInstanceOf(Date);
    expect(agent.lastAuthAt).toBeInstanceOf(Date);
    expect(agent.totalRequests).toBe(0);
  });

  it("getAgent retrieves an agent by id", async () => {
    const input = makeCreateInput();
    await store.createAgent(input);
    const agent = await store.getAgent(input.id);
    expect(agent).not.toBeNull();
    expect(agent!.id).toBe(input.id);
  });

  it("getAgent returns null for unknown id", async () => {
    const agent = await store.getAgent("ag_nonexistent");
    expect(agent).toBeNull();
  });

  it("getAgentByPublicKey retrieves by public key", async () => {
    const input = makeCreateInput();
    await store.createAgent(input);
    const agent = await store.getAgentByPublicKey(input.publicKey);
    expect(agent).not.toBeNull();
    expect(agent!.publicKey).toBe(input.publicKey);
  });

  it("getAgentByApiKeyHash retrieves by API key hash", async () => {
    const input = makeCreateInput();
    await store.createAgent(input);
    const agent = await store.getAgentByApiKeyHash(input.apiKeyHash);
    expect(agent).not.toBeNull();
    expect(agent!.apiKeyHash).toBe(input.apiKeyHash);
  });

  it("updateAgent updates specific fields", async () => {
    const input = makeCreateInput();
    await store.createAgent(input);
    const updated = await store.updateAgent(input.id, { reputation: 75 });
    expect(updated.reputation).toBe(75);
    // Other fields should be unchanged
    expect(updated.publicKey).toBe(input.publicKey);
  });

  it("updateAgent throws AgentNotFoundError for unknown id", async () => {
    await expect(
      store.updateAgent("ag_nonexistent", { reputation: 10 }),
    ).rejects.toThrow(AgentNotFoundError);
  });

  it("deleteAgent removes the agent", async () => {
    const input = makeCreateInput();
    await store.createAgent(input);
    const deleted = await store.deleteAgent(input.id);
    expect(deleted).toBe(true);
    const agent = await store.getAgent(input.id);
    expect(agent).toBeNull();
  });

  it("deleteAgent returns false for unknown id", async () => {
    const deleted = await store.deleteAgent("ag_nonexistent");
    expect(deleted).toBe(false);
  });

  it("throws DuplicateAgentError for duplicate public key", async () => {
    const input = makeCreateInput();
    await store.createAgent(input);
    const input2 = makeCreateInput({ publicKey: input.publicKey });
    await expect(store.createAgent(input2)).rejects.toThrow(DuplicateAgentError);
  });
});

describe("MemoryStore - Challenge Management", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  function makeChallenge(agentId: string, expiresInMs: number = 60_000): ChallengeData {
    return {
      agentId,
      nonce: "test-nonce",
      message: `agentdoor:register:${agentId}:1700000000:test-nonce`,
      expiresAt: new Date(Date.now() + expiresInMs),
      createdAt: new Date(),
    };
  }

  it("createChallenge stores a challenge", async () => {
    const challenge = makeChallenge("ag_test1");
    await store.createChallenge(challenge);
    const retrieved = await store.getChallenge("ag_test1");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.agentId).toBe("ag_test1");
    expect(retrieved!.nonce).toBe("test-nonce");
  });

  it("getChallenge returns null for unknown agentId", async () => {
    const result = await store.getChallenge("ag_unknown");
    expect(result).toBeNull();
  });

  it("getChallenge returns expired challenges for caller to handle", async () => {
    const challenge = makeChallenge("ag_expired", -1000); // already expired
    await store.createChallenge(challenge);
    const result = await store.getChallenge("ag_expired");
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("ag_expired");
    expect(result!.expiresAt.getTime()).toBeLessThan(Date.now());
  });

  it("deleteChallenge removes a challenge", async () => {
    const challenge = makeChallenge("ag_todelete");
    await store.createChallenge(challenge);
    await store.deleteChallenge("ag_todelete");
    const result = await store.getChallenge("ag_todelete");
    expect(result).toBeNull();
  });

  it("cleanExpiredChallenges removes only expired entries", async () => {
    const validChallenge = makeChallenge("ag_valid", 60_000);
    const expiredChallenge = makeChallenge("ag_old", -1000);
    await store.createChallenge(validChallenge);
    await store.createChallenge(expiredChallenge);

    const cleaned = await store.cleanExpiredChallenges();
    expect(cleaned).toBe(1);

    // Valid challenge should still exist
    const valid = await store.getChallenge("ag_valid");
    expect(valid).not.toBeNull();
  });
});
