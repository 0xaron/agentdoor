import { describe, it, expect, vi, beforeEach } from "vitest";
import { SupabasePlugin } from "../plugin.js";
import { AGENT_TABLE_SQL, AGENT_RLS_SQL } from "../sql.js";
import type { SupabaseClientInterface } from "../plugin.js";

/** Creates a mock Supabase client for testing. */
function createMockSupabaseClient(): SupabaseClientInterface {
  const store = new Map<string, Record<string, unknown>>();

  const createFilterBuilder = () => ({
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockImplementation(async function (this: any) {
      return { data: null, error: null };
    }),
    then: vi.fn(),
  });

  const createQueryResult = () => ({
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockImplementation(async () => {
      return { data: {}, error: null };
    }),
    then: vi.fn(),
  });

  return {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue(createQueryResult()),
      upsert: vi.fn().mockImplementation((data: Record<string, unknown>[]) => {
        for (const item of data) {
          store.set(item.id as string, item);
        }
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: data[0],
              error: null,
            }),
          }),
        };
      }),
      update: vi.fn().mockReturnValue(createFilterBuilder()),
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: {}, error: null }),
          then: vi.fn(),
        }),
      }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockImplementation(async () => {
            return { data: null, error: null };
          }),
          then: vi.fn(),
        }),
      }),
    }),
  };
}

describe("SupabasePlugin", () => {
  let plugin: SupabasePlugin;
  let mockClient: SupabaseClientInterface;

  beforeEach(() => {
    plugin = new SupabasePlugin({
      supabaseUrl: "https://test.supabase.co",
      supabaseServiceKey: "service_key_test",
    });
    mockClient = createMockSupabaseClient();
    plugin.setClient(mockClient);
  });

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("creates a plugin with default config", () => {
      expect(plugin.getTableName()).toBe("agentgate_agents");
      expect(plugin.isAutoSyncEnabled()).toBe(true);
    });

    it("accepts custom table name", () => {
      const p = new SupabasePlugin({
        supabaseUrl: "https://test.supabase.co",
        supabaseServiceKey: "key",
        tableName: "custom_agents",
      });
      expect(p.getTableName()).toBe("custom_agents");
    });

    it("accepts autoSync override", () => {
      const p = new SupabasePlugin({
        supabaseUrl: "https://test.supabase.co",
        supabaseServiceKey: "key",
        autoSync: false,
      });
      expect(p.isAutoSyncEnabled()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // syncAgent
  // -------------------------------------------------------------------------

  describe("syncAgent", () => {
    it("upserts an agent record", async () => {
      const result = await plugin.syncAgent({
        id: "ag_test_1",
        publicKey: "pubkey_base64",
        scopesGranted: ["data.read"],
        status: "active",
        reputation: 50,
        metadata: { name: "Test Agent" },
      });

      expect(result.success).toBe(true);
      expect(result.agentId).toBe("ag_test_1");
      expect(mockClient.from).toHaveBeenCalledWith("agentgate_agents");
    });

    it("includes all agent data in the record", async () => {
      await plugin.syncAgent({
        id: "ag_test_1",
        publicKey: "pubkey_base64",
        scopesGranted: ["data.read", "data.write"],
        status: "active",
        reputation: 75,
        x402Wallet: "0xwallet",
        metadata: { framework: "langchain" },
      });

      const fromResult = mockClient.from("agentgate_agents");
      expect(fromResult.upsert).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "ag_test_1",
          public_key: "pubkey_base64",
          scopes_granted: ["data.read", "data.write"],
          status: "active",
          reputation: 75,
          x402_wallet: "0xwallet",
          metadata: { framework: "langchain" },
        }),
      ]);
    });

    it("fails without Supabase client", async () => {
      const noClient = new SupabasePlugin({
        supabaseUrl: "https://test.supabase.co",
        supabaseServiceKey: "key",
      });

      const result = await noClient.syncAgent({
        id: "ag_test_1",
        publicKey: "pk",
        scopesGranted: [],
        status: "active",
        reputation: 50,
        metadata: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Supabase client not configured");
    });
  });

  // -------------------------------------------------------------------------
  // removeAgent
  // -------------------------------------------------------------------------

  describe("removeAgent", () => {
    it("deletes an agent record", async () => {
      const result = await plugin.removeAgent("ag_test_1");
      expect(result.success).toBe(true);
      expect(result.agentId).toBe("ag_test_1");
    });

    it("fails without Supabase client", async () => {
      const noClient = new SupabasePlugin({
        supabaseUrl: "https://test.supabase.co",
        supabaseServiceKey: "key",
      });

      const result = await noClient.removeAgent("ag_test_1");
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getAgent
  // -------------------------------------------------------------------------

  describe("getAgent", () => {
    it("returns null without client", async () => {
      const noClient = new SupabasePlugin({
        supabaseUrl: "https://test.supabase.co",
        supabaseServiceKey: "key",
      });
      const result = await noClient.getAgent("ag_test_1");
      expect(result).toBeNull();
    });

    it("returns null when agent not found", async () => {
      const result = await plugin.getAgent("ag_nonexistent");
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // SQL exports
  // -------------------------------------------------------------------------

  describe("SQL exports", () => {
    it("exports AGENT_TABLE_SQL with CREATE TABLE", () => {
      expect(AGENT_TABLE_SQL).toContain("CREATE TABLE");
      expect(AGENT_TABLE_SQL).toContain("agentgate_agents");
      expect(AGENT_TABLE_SQL).toContain("public_key");
      expect(AGENT_TABLE_SQL).toContain("scopes_granted");
      expect(AGENT_TABLE_SQL).toContain("reputation");
    });

    it("exports AGENT_RLS_SQL with RLS policies", () => {
      expect(AGENT_RLS_SQL).toContain("ROW LEVEL SECURITY");
      expect(AGENT_RLS_SQL).toContain("CREATE POLICY");
      expect(AGENT_RLS_SQL).toContain("service_role");
    });
  });
});
