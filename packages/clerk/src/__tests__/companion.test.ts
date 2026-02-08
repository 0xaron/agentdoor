import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClerkCompanion } from "../companion.js";
import type { ClerkClientInterface, ClerkUser } from "../companion.js";

/** Creates a mock Clerk client for testing. */
function createMockClerkClient(): ClerkClientInterface {
  let userCounter = 0;
  const users = new Map<string, ClerkUser>();

  return {
    createUser: vi.fn().mockImplementation(async (params) => {
      userCounter++;
      const user: ClerkUser = {
        id: `user_test_${userCounter}`,
        username: params.username,
        publicMetadata: params.publicMetadata,
        privateMetadata: params.privateMetadata,
      };
      users.set(user.id, user);
      return user;
    }),
    updateUser: vi.fn().mockImplementation(async (userId, params) => {
      const user = users.get(userId) ?? { id: userId };
      return {
        ...user,
        publicMetadata: params.publicMetadata,
        privateMetadata: params.privateMetadata,
      };
    }),
    deleteUser: vi.fn().mockImplementation(async (userId) => {
      users.delete(userId);
    }),
  };
}

describe("ClerkCompanion", () => {
  let companion: ClerkCompanion;
  let mockClient: ClerkClientInterface;

  beforeEach(() => {
    companion = new ClerkCompanion({ clerkSecretKey: "sk_test_xxx" });
    mockClient = createMockClerkClient();
    companion.setClerkClient(mockClient);
  });

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("creates a companion with default config", () => {
      const c = new ClerkCompanion({ clerkSecretKey: "sk_test" });
      expect(c).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // syncAgent
  // -------------------------------------------------------------------------

  describe("syncAgent", () => {
    it("creates a new Clerk user for a new agent", async () => {
      const result = await companion.syncAgent({
        agentId: "ag_test_1",
        publicKey: "pubkey_base64",
        scopes: ["data.read"],
      });

      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
      expect(result.clerkUserId).toBe("user_test_1");
      expect(mockClient.createUser).toHaveBeenCalledTimes(1);
    });

    it("creates username with agent_ prefix by default", async () => {
      await companion.syncAgent({
        agentId: "ag_test_1",
        publicKey: "pubkey_base64",
        scopes: ["data.read"],
      });

      expect(mockClient.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          username: "agent_test_1",
        }),
      );
    });

    it("includes agentgate metadata in public metadata", async () => {
      await companion.syncAgent({
        agentId: "ag_test_1",
        publicKey: "pubkey_base64",
        scopes: ["data.read", "data.write"],
        reputation: 75,
      });

      expect(mockClient.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          publicMetadata: expect.objectContaining({
            agentgate: true,
            agentgate_id: "ag_test_1",
            scopes: ["data.read", "data.write"],
            reputation: 75,
          }),
        }),
      );
    });

    it("includes public key in private metadata", async () => {
      await companion.syncAgent({
        agentId: "ag_test_1",
        publicKey: "pubkey_base64",
        scopes: ["data.read"],
      });

      expect(mockClient.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          privateMetadata: expect.objectContaining({
            agentgate_public_key: "pubkey_base64",
          }),
        }),
      );
    });

    it("updates existing Clerk user on re-sync", async () => {
      await companion.syncAgent({
        agentId: "ag_test_1",
        publicKey: "pubkey_base64",
        scopes: ["data.read"],
      });

      const result = await companion.syncAgent({
        agentId: "ag_test_1",
        publicKey: "pubkey_base64",
        scopes: ["data.read", "data.write"],
        reputation: 80,
      });

      expect(result.success).toBe(true);
      expect(result.created).toBe(false);
      expect(mockClient.updateUser).toHaveBeenCalledTimes(1);
    });

    it("fails gracefully without a Clerk client", async () => {
      const noClient = new ClerkCompanion({ clerkSecretKey: "sk_test" });
      const result = await noClient.syncAgent({
        agentId: "ag_test_1",
        publicKey: "pubkey_base64",
        scopes: ["data.read"],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Clerk client not configured");
    });

    it("fails when auto-create is disabled and no mapping", async () => {
      const noAuto = new ClerkCompanion({
        clerkSecretKey: "sk_test",
        autoCreateUsers: false,
      });
      noAuto.setClerkClient(mockClient);

      const result = await noAuto.syncAgent({
        agentId: "ag_test_1",
        publicKey: "pubkey_base64",
        scopes: ["data.read"],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Auto-create disabled");
    });

    it("handles Clerk API errors gracefully", async () => {
      const errorClient: ClerkClientInterface = {
        createUser: vi.fn().mockRejectedValue(new Error("Clerk API error")),
        updateUser: vi.fn(),
        deleteUser: vi.fn(),
      };
      companion.setClerkClient(errorClient);

      const result = await companion.syncAgent({
        agentId: "ag_test_1",
        publicKey: "pubkey_base64",
        scopes: ["data.read"],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Clerk API error");
    });

    it("uses custom username prefix", async () => {
      const custom = new ClerkCompanion({
        clerkSecretKey: "sk_test",
        usernamePrefix: "bot_",
      });
      custom.setClerkClient(mockClient);

      await custom.syncAgent({
        agentId: "ag_test_1",
        publicKey: "pubkey_base64",
        scopes: ["data.read"],
      });

      expect(mockClient.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          username: "bot_test_1",
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // removeAgent
  // -------------------------------------------------------------------------

  describe("removeAgent", () => {
    it("removes a Clerk user for an agent", async () => {
      await companion.syncAgent({
        agentId: "ag_test_1",
        publicKey: "pubkey_base64",
        scopes: ["data.read"],
      });

      const result = await companion.removeAgent("ag_test_1");

      expect(result.success).toBe(true);
      expect(mockClient.deleteUser).toHaveBeenCalledWith("user_test_1");
    });

    it("fails when no mapping exists", async () => {
      const result = await companion.removeAgent("ag_nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("No Clerk user found");
    });

    it("fails without Clerk client", async () => {
      const noClient = new ClerkCompanion({ clerkSecretKey: "sk_test" });
      const result = await noClient.removeAgent("ag_test_1");
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Mapping management
  // -------------------------------------------------------------------------

  describe("mapUser / getMapping / getAllMappings / clearMappings", () => {
    it("manually maps an agent to a Clerk user", () => {
      companion.mapUser("ag_test_1", "user_existing");
      const mapping = companion.getMapping("ag_test_1");
      expect(mapping).toBeDefined();
      expect(mapping!.clerkUserId).toBe("user_existing");
      expect(mapping!.synced).toBe(false);
    });

    it("returns undefined for unmapped agent", () => {
      expect(companion.getMapping("ag_none")).toBeUndefined();
    });

    it("returns all mappings", async () => {
      await companion.syncAgent({ agentId: "ag_1", publicKey: "pk1", scopes: ["data.read"] });
      await companion.syncAgent({ agentId: "ag_2", publicKey: "pk2", scopes: ["data.read"] });
      expect(companion.getAllMappings()).toHaveLength(2);
    });

    it("clears all mappings", async () => {
      await companion.syncAgent({ agentId: "ag_1", publicKey: "pk1", scopes: ["data.read"] });
      companion.clearMappings();
      expect(companion.getAllMappings()).toHaveLength(0);
    });
  });
});
