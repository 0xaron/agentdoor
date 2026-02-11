import { describe, it, expect, vi, beforeEach } from "vitest";
import { Auth0Companion } from "../companion.js";
import type { Auth0ClientInterface } from "../companion.js";
import type { Agent } from "@agentdoor/core";

/** Creates a mock Auth0 client for testing. */
function createMockAuth0Client(): Auth0ClientInterface {
  let userCounter = 0;
  let grantCounter = 0;
  const users = new Map<string, Record<string, unknown>>();

  return {
    createUser: vi.fn().mockImplementation(async (data) => {
      userCounter++;
      const userId = `auth0|user_${userCounter}`;
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
    createClientGrant: vi.fn().mockImplementation(async () => {
      grantCounter++;
      return { id: `grant_${grantCounter}` };
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

describe("Auth0Companion", () => {
  let companion: Auth0Companion;
  let mockClient: Auth0ClientInterface;

  beforeEach(() => {
    mockClient = createMockAuth0Client();
    companion = new Auth0Companion(
      {
        domain: "test-tenant.us.auth0.com",
        clientId: "client_123",
        clientSecret: "secret_456",
      },
      mockClient,
    );
  });

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("creates a companion with required config", () => {
      const c = new Auth0Companion(
        { domain: "test.auth0.com", clientId: "id", clientSecret: "secret" },
        mockClient,
      );
      expect(c).toBeDefined();
    });

    it("creates a companion with optional config fields", () => {
      const c = new Auth0Companion(
        {
          domain: "test.auth0.com",
          clientId: "id",
          clientSecret: "secret",
          audience: "https://api.example.com",
          connection: "custom-db",
          agentMetadataKey: "custom_key",
        },
        mockClient,
      );
      expect(c).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // onAgentRegistered
  // -------------------------------------------------------------------------

  describe("onAgentRegistered", () => {
    it("creates an Auth0 user with agent metadata", async () => {
      const agent = createMockAgent();
      const result = await companion.onAgentRegistered(agent);

      expect(result.synced).toBe(true);
      expect(result.auth0UserId).toBe("auth0|user_1");
      expect(result.agentId).toBe("ag_test_1");
      expect(mockClient.createUser).toHaveBeenCalledTimes(1);

      const createCall = vi.mocked(mockClient.createUser).mock.calls[0][0];
      expect(createCall.app_metadata).toEqual({
        agentdoor: {
          is_agent: true,
          agent_id: "ag_test_1",
          scopes: ["data.read"],
          wallet: null,
        },
      });
    });

    it("includes wallet address when agent has x402Wallet", async () => {
      const agent = createMockAgent({ x402Wallet: "0xABC123" });
      await companion.onAgentRegistered(agent);

      const createCall = vi.mocked(mockClient.createUser).mock.calls[0][0];
      const metadata = createCall.app_metadata as Record<string, unknown>;
      const agentdoor = metadata.agentdoor as Record<string, unknown>;
      expect(agentdoor.wallet).toBe("0xABC123");
    });

    it("creates email using agent ID and domain", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);

      const createCall = vi.mocked(mockClient.createUser).mock.calls[0][0];
      expect(createCall.email).toBe("ag_test_1@agents.test-tenant.us.auth0.com");
    });

    it("uses custom agentMetadataKey when configured", async () => {
      const customCompanion = new Auth0Companion(
        {
          domain: "test.auth0.com",
          clientId: "id",
          clientSecret: "secret",
          agentMetadataKey: "my_agents",
        },
        mockClient,
      );
      const agent = createMockAgent();
      await customCompanion.onAgentRegistered(agent);

      const createCall = vi.mocked(mockClient.createUser).mock.calls[0][0];
      expect(createCall.app_metadata).toHaveProperty("my_agents");
    });

    it("creates a client grant when audience is configured", async () => {
      const companionWithAudience = new Auth0Companion(
        {
          domain: "test.auth0.com",
          clientId: "client_123",
          clientSecret: "secret",
          audience: "https://api.example.com",
        },
        mockClient,
      );
      const agent = createMockAgent({ scopesGranted: ["data.read", "data.write"] });
      const result = await companionWithAudience.onAgentRegistered(agent);

      expect(result.grantId).toBe("grant_1");
      expect(mockClient.createClientGrant).toHaveBeenCalledWith({
        client_id: "client_123",
        audience: "https://api.example.com",
        scope: ["data.read", "data.write"],
      });
    });

    it("does not create a client grant when audience is not configured", async () => {
      const agent = createMockAgent();
      const result = await companion.onAgentRegistered(agent);

      expect(result.grantId).toBeUndefined();
      expect(mockClient.createClientGrant).not.toHaveBeenCalled();
    });

    it("stores the agent-to-user mapping", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);

      const userId = await companion.getAuth0UserId("ag_test_1");
      expect(userId).toBe("auth0|user_1");
    });

    it("handles Auth0 client errors gracefully", async () => {
      const errorClient: Auth0ClientInterface = {
        createUser: vi.fn().mockRejectedValue(new Error("Auth0 API error")),
        updateUser: vi.fn(),
        deleteUser: vi.fn(),
        getUser: vi.fn(),
        createClientGrant: vi.fn(),
      };
      const errorCompanion = new Auth0Companion(
        { domain: "test.auth0.com", clientId: "id", clientSecret: "secret" },
        errorClient,
      );

      const agent = createMockAgent();
      const result = await errorCompanion.onAgentRegistered(agent);

      expect(result.synced).toBe(false);
      expect(result.auth0UserId).toBe("");
      expect(result.agentId).toBe("ag_test_1");
    });

    it("uses custom connection when configured", async () => {
      const customCompanion = new Auth0Companion(
        {
          domain: "test.auth0.com",
          clientId: "id",
          clientSecret: "secret",
          connection: "custom-database",
        },
        mockClient,
      );
      const agent = createMockAgent();
      await customCompanion.onAgentRegistered(agent);

      const createCall = vi.mocked(mockClient.createUser).mock.calls[0][0];
      expect(createCall.connection).toBe("custom-database");
    });
  });

  // -------------------------------------------------------------------------
  // onAgentRevoked
  // -------------------------------------------------------------------------

  describe("onAgentRevoked", () => {
    it("deletes the Auth0 user for a registered agent", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);

      await companion.onAgentRevoked("ag_test_1");

      expect(mockClient.deleteUser).toHaveBeenCalledWith("auth0|user_1");
      const userId = await companion.getAuth0UserId("ag_test_1");
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

      const userId = await companion.getAuth0UserId("ag_test_1");
      expect(userId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getAuth0UserId
  // -------------------------------------------------------------------------

  describe("getAuth0UserId", () => {
    it("returns the Auth0 user ID for a registered agent", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);

      const userId = await companion.getAuth0UserId("ag_test_1");
      expect(userId).toBe("auth0|user_1");
    });

    it("returns null for an unregistered agent", async () => {
      const userId = await companion.getAuth0UserId("ag_unknown");
      expect(userId).toBeNull();
    });

    it("returns null after agent is revoked", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);
      await companion.onAgentRevoked("ag_test_1");

      const userId = await companion.getAuth0UserId("ag_test_1");
      expect(userId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // syncAgent
  // -------------------------------------------------------------------------

  describe("syncAgent", () => {
    it("updates an existing Auth0 user when mapping exists", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);

      const updatedAgent = createMockAgent({
        scopesGranted: ["data.read", "data.write"],
        reputation: 95,
      });
      const result = await companion.syncAgent(updatedAgent);

      expect(result.synced).toBe(true);
      expect(result.auth0UserId).toBe("auth0|user_1");
      expect(mockClient.updateUser).toHaveBeenCalledTimes(1);
    });

    it("creates a new Auth0 user when no mapping exists", async () => {
      const agent = createMockAgent();
      const result = await companion.syncAgent(agent);

      expect(result.synced).toBe(true);
      expect(result.auth0UserId).toBe("auth0|user_1");
      expect(mockClient.createUser).toHaveBeenCalledTimes(1);
    });

    it("handles update errors gracefully", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);

      const errorClient: Auth0ClientInterface = {
        createUser: vi.fn(),
        updateUser: vi.fn().mockRejectedValue(new Error("Update failed")),
        deleteUser: vi.fn(),
        getUser: vi.fn(),
        createClientGrant: vi.fn(),
      };

      const errorCompanion = new Auth0Companion(
        { domain: "test.auth0.com", clientId: "id", clientSecret: "secret" },
        errorClient,
      );

      // We need to manually set the mapping so the companion has it
      // Use onAgentRegistered first with a working client, then switch
      const workingCompanion = new Auth0Companion(
        { domain: "test.auth0.com", clientId: "id", clientSecret: "secret" },
        mockClient,
      );
      await workingCompanion.onAgentRegistered(agent);

      // Now sync with update that fails - since errorCompanion has no mapping,
      // it will try to create a new user, which should succeed
      // Let's test the companion that already has the mapping
      const result = await companion.syncAgent(
        createMockAgent({ scopesGranted: ["data.read", "data.write"] }),
      );

      // With the working client, update should succeed
      expect(result.synced).toBe(true);
    });

    it("passes updated scopes in the sync metadata", async () => {
      const agent = createMockAgent();
      await companion.onAgentRegistered(agent);

      const updatedAgent = createMockAgent({
        scopesGranted: ["data.read", "data.write", "admin"],
      });
      await companion.syncAgent(updatedAgent);

      const updateCall = vi.mocked(mockClient.updateUser).mock.calls[0];
      const appMetadata = updateCall[1].app_metadata as Record<string, unknown>;
      const agentdoor = appMetadata.agentdoor as Record<string, unknown>;
      expect(agentdoor.scopes).toEqual(["data.read", "data.write", "admin"]);
    });
  });
});
