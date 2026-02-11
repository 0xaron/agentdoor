import { describe, it, expect, vi, beforeEach } from "vitest";
import { StytchCompanion } from "../companion.js";
import type { StytchClientInterface } from "../companion.js";
import type { Agent } from "@agentdoor/core";

/** Creates a mock Stytch client for testing. */
function createMockStytchClient(): StytchClientInterface {
  let userCounter = 0;
  const users = new Map<string, Record<string, unknown>>();

  return {
    createUser: vi.fn().mockImplementation(async (data) => {
      userCounter++;
      const userId = `user-stytch-${userCounter}`;
      users.set(userId, { ...data, user_id: userId });
      return { user_id: userId };
    }),
    updateUser: vi.fn().mockImplementation(async (id, data) => {
      const existing = users.get(id);
      if (existing) {
        users.set(id, { ...existing, ...data });
      }
    }),
    deleteUser: vi.fn().mockImplementation(async (id) => {
      users.delete(id);
    }),
    getUser: vi.fn().mockImplementation(async (id) => {
      return users.get(id) ?? null;
    }),
  };
}

/** Creates a mock Agent for testing. */
function createMockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "ag_test_1",
    publicKey: "base64_pub_key",
    scopesGranted: ["data.read"],
    apiKeyHash: "hash_abc",
    rateLimit: { windowMs: 60000, maxRequests: 100 },
    reputation: 80,
    metadata: { name: "TestAgent", framework: "langchain" },
    status: "active",
    createdAt: new Date("2025-01-01"),
    lastAuthAt: new Date("2025-01-01"),
    totalRequests: 0,
    totalX402Paid: 0,
    ...overrides,
  };
}

describe("StytchCompanion", () => {
  let companion: StytchCompanion;
  let mockClient: StytchClientInterface;

  beforeEach(() => {
    mockClient = createMockStytchClient();
    companion = new StytchCompanion(
      { projectId: "project-test-123", secret: "secret-test-456" },
      mockClient,
    );
  });

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("creates a companion with required config", () => {
      const c = new StytchCompanion(
        { projectId: "proj", secret: "sec" },
        mockClient,
      );
      expect(c).toBeDefined();
    });

    it("creates a companion with live environment", () => {
      const c = new StytchCompanion(
        { projectId: "proj", secret: "sec", environment: "live" },
        mockClient,
      );
      expect(c).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // onAgentRegistered
  // -------------------------------------------------------------------------

  describe("onAgentRegistered", () => {
    it("creates a Stytch user for a new agent", async () => {
      const agent = createMockAgent();
      const result = await companion.onAgentRegistered(agent);

      expect(result.synced).toBe(true);
      expect(result.stytchUserId).toBe("user-stytch-1");
      expect(result.agentId).toBe("ag_test_1");
      expect(mockClient.createUser).toHaveBeenCalledTimes(1);
    });

    it("includes trusted metadata with agent info", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);

      expect(mockClient.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          trusted_metadata: expect.objectContaining({
            is_agent: true,
            agent_id: "ag_test_1",
            scopes: ["data.read"],
            wallet: null,
            public_key: "base64_pub_key",
          }),
        }),
      );
    });

    it("includes wallet address when agent has x402Wallet", async () => {
      const agent = createMockAgent({ x402Wallet: "0xDEF456" });
      await companion.onAgentRegistered(agent);

      expect(mockClient.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          trusted_metadata: expect.objectContaining({
            wallet: "0xDEF456",
          }),
        }),
      );
    });

    it("creates email using agent ID", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);

      expect(mockClient.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "ag_test_1@agents.agentdoor.stytch.io",
        }),
      );
    });

    it("uses agent metadata name as first_name", async () => {
      const agent = createMockAgent({ metadata: { name: "SmartBot", framework: "langchain" } });
      await companion.onAgentRegistered(agent);

      expect(mockClient.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          name: { first_name: "SmartBot", last_name: "ag_test_1" },
        }),
      );
    });

    it("uses fallback name when metadata has no name", async () => {
      const agent = createMockAgent({ metadata: { framework: "langchain" } });
      await companion.onAgentRegistered(agent);

      expect(mockClient.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          name: { first_name: "Agent", last_name: "ag_test_1" },
        }),
      );
    });

    it("includes environment in trusted metadata", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);

      expect(mockClient.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          trusted_metadata: expect.objectContaining({
            environment: "test",
          }),
        }),
      );
    });

    it("uses live environment when configured", async () => {
      const liveCompanion = new StytchCompanion(
        { projectId: "proj", secret: "sec", environment: "live" },
        mockClient,
      );
      const agent = createMockAgent();
      await liveCompanion.onAgentRegistered(agent);

      expect(mockClient.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          trusted_metadata: expect.objectContaining({
            environment: "live",
          }),
        }),
      );
    });

    it("stores the agent-to-user mapping", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);

      const userId = await companion.getStytchUserId("ag_test_1");
      expect(userId).toBe("user-stytch-1");
    });

    it("handles Stytch client errors gracefully", async () => {
      const errorClient: StytchClientInterface = {
        createUser: vi.fn().mockRejectedValue(new Error("Stytch API error")),
        updateUser: vi.fn(),
        deleteUser: vi.fn(),
        getUser: vi.fn(),
      };
      const errorCompanion = new StytchCompanion(
        { projectId: "proj", secret: "sec" },
        errorClient,
      );

      const agent = createMockAgent();
      const result = await errorCompanion.onAgentRegistered(agent);

      expect(result.synced).toBe(false);
      expect(result.stytchUserId).toBe("");
      expect(result.agentId).toBe("ag_test_1");
    });
  });

  // -------------------------------------------------------------------------
  // onAgentRevoked
  // -------------------------------------------------------------------------

  describe("onAgentRevoked", () => {
    it("deletes the Stytch user for a registered agent", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);

      await companion.onAgentRevoked("ag_test_1");

      expect(mockClient.deleteUser).toHaveBeenCalledWith("user-stytch-1");
      const userId = await companion.getStytchUserId("ag_test_1");
      expect(userId).toBeNull();
    });

    it("does nothing when agent has no mapping", async () => {
      await companion.onAgentRevoked("ag_nonexistent");

      expect(mockClient.deleteUser).not.toHaveBeenCalled();
    });

    it("removes the mapping after deletion", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);
      await companion.onAgentRevoked("ag_test_1");

      const userId = await companion.getStytchUserId("ag_test_1");
      expect(userId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getStytchUserId
  // -------------------------------------------------------------------------

  describe("getStytchUserId", () => {
    it("returns the Stytch user ID for a registered agent", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);

      const userId = await companion.getStytchUserId("ag_test_1");
      expect(userId).toBe("user-stytch-1");
    });

    it("returns null for an unregistered agent", async () => {
      const userId = await companion.getStytchUserId("ag_unknown");
      expect(userId).toBeNull();
    });

    it("returns null after agent is revoked", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);
      await companion.onAgentRevoked("ag_test_1");

      const userId = await companion.getStytchUserId("ag_test_1");
      expect(userId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // syncAgent
  // -------------------------------------------------------------------------

  describe("syncAgent", () => {
    it("updates an existing Stytch user when mapping exists", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);

      const updatedAgent = createMockAgent({
        scopesGranted: ["data.read", "data.write"],
        reputation: 95,
      });
      const result = await companion.syncAgent(updatedAgent);

      expect(result.synced).toBe(true);
      expect(result.stytchUserId).toBe("user-stytch-1");
      expect(mockClient.updateUser).toHaveBeenCalledTimes(1);
    });

    it("creates a new Stytch user when no mapping exists", async () => {
      const agent = createMockAgent();
      const result = await companion.syncAgent(agent);

      expect(result.synced).toBe(true);
      expect(result.stytchUserId).toBe("user-stytch-1");
      expect(mockClient.createUser).toHaveBeenCalledTimes(1);
    });

    it("passes updated trusted metadata during sync", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);

      const updatedAgent = createMockAgent({
        scopesGranted: ["data.read", "data.write", "admin"],
        x402Wallet: "0xNEW_WALLET",
      });
      await companion.syncAgent(updatedAgent);

      expect(mockClient.updateUser).toHaveBeenCalledWith(
        "user-stytch-1",
        expect.objectContaining({
          trusted_metadata: expect.objectContaining({
            scopes: ["data.read", "data.write", "admin"],
            wallet: "0xNEW_WALLET",
          }),
        }),
      );
    });

    it("handles sync update errors gracefully", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);

      // Replace the client with one that fails on update
      const failClient: StytchClientInterface = {
        createUser: vi.fn(),
        updateUser: vi.fn().mockRejectedValue(new Error("Update failed")),
        deleteUser: vi.fn(),
        getUser: vi.fn(),
      };

      // Create a new companion with the failing client, register the agent first
      const failCompanion = new StytchCompanion(
        { projectId: "proj", secret: "sec" },
        mockClient, // use working client for registration
      );
      await failCompanion.onAgentRegistered(agent);

      // Now swap to failing client by creating a companion that will have the mapping
      // We test the error path by noting the original companion has the mapping
      // and we mock the client to fail
      const originalClient = mockClient;
      // We can test by creating a scenario where updateUser fails
      vi.mocked(originalClient.updateUser).mockRejectedValueOnce(new Error("Update failed"));

      const result = await companion.syncAgent(
        createMockAgent({ scopesGranted: ["data.read", "data.write"] }),
      );

      expect(result.synced).toBe(false);
      expect(result.stytchUserId).toBe("user-stytch-1");
      expect(result.agentId).toBe("ag_test_1");
    });

    it("registers multiple agents independently", async () => {
      const agent1 = createMockAgent({ id: "ag_1" });
      const agent2 = createMockAgent({ id: "ag_2" });

      await companion.onAgentRegistered(agent1);
      await companion.onAgentRegistered(agent2);

      const userId1 = await companion.getStytchUserId("ag_1");
      const userId2 = await companion.getStytchUserId("ag_2");

      expect(userId1).toBe("user-stytch-1");
      expect(userId2).toBe("user-stytch-2");
    });
  });
});
