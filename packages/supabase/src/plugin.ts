/**
 * @agentdoor/supabase - Supabase Plugin
 *
 * Syncs AgentDoor agents to Supabase. Creates records in a dedicated
 * agentdoor_agents table with RLS policies that agents can use to
 * access resources through Supabase.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the Supabase plugin. */
export interface SupabasePluginConfig {
  /** Supabase project URL */
  supabaseUrl: string;
  /** Supabase service role key (for admin operations) */
  supabaseServiceKey: string;
  /** Table name for agent records. Default: "agentdoor_agents" */
  tableName?: string;
  /** Whether to auto-create records for new agents. Default: true */
  autoSync?: boolean;
}

/** Agent record stored in Supabase. */
export interface SupabaseAgentRecord {
  /** AgentDoor agent ID (primary key) */
  id: string;
  /** Agent's public key */
  public_key: string;
  /** Granted scopes as JSON array */
  scopes_granted: string[];
  /** Agent status */
  status: string;
  /** Reputation score */
  reputation: number;
  /** x402 wallet address */
  x402_wallet?: string;
  /** Additional metadata as JSON */
  metadata: Record<string, string>;
  /** When the agent was created */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
}

/** Result of a Supabase sync operation. */
export interface SupabaseSyncResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** The agent record ID */
  agentId?: string;
  /** Whether a new record was created (vs updated) */
  created?: boolean;
  /** Error message (if failed) */
  error?: string;
}

/** Minimal interface for Supabase client operations. */
export interface SupabaseClientInterface {
  from(table: string): SupabaseQueryBuilder;
}

/** Minimal query builder interface. */
export interface SupabaseQueryBuilder {
  insert(data: Record<string, unknown>[]): SupabaseQueryResult;
  upsert(data: Record<string, unknown>[]): SupabaseQueryResult;
  update(data: Record<string, unknown>): SupabaseFilterBuilder;
  delete(): SupabaseFilterBuilder;
  select(columns?: string): SupabaseFilterBuilder;
}

/** Query result interface. */
export interface SupabaseQueryResult {
  select(columns?: string): SupabaseQueryResult;
  single(): Promise<{ data: Record<string, unknown> | null; error: SupabaseError | null }>;
  then(
    resolve: (value: { data: Record<string, unknown>[] | null; error: SupabaseError | null }) => void,
  ): void;
}

/** Filter builder interface. */
export interface SupabaseFilterBuilder {
  eq(column: string, value: unknown): SupabaseFilterBuilder;
  single(): Promise<{ data: Record<string, unknown> | null; error: SupabaseError | null }>;
  then(
    resolve: (value: { data: Record<string, unknown>[] | null; error: SupabaseError | null }) => void,
  ): void;
}

/** Supabase error interface. */
export interface SupabaseError {
  message: string;
  code?: string;
}

// ---------------------------------------------------------------------------
// SupabasePlugin Class
// ---------------------------------------------------------------------------

/**
 * Supabase plugin for AgentDoor.
 *
 * Stores agent data in a Supabase table with RLS support, allowing
 * agents to be treated as first-class entities in Supabase applications.
 *
 * Usage:
 * ```ts
 * const plugin = new SupabasePlugin({
 *   supabaseUrl: process.env.SUPABASE_URL!,
 *   supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY!,
 * });
 *
 * plugin.setClient(supabaseClient);
 *
 * await plugin.syncAgent({
 *   id: "ag_xxx",
 *   publicKey: "base64...",
 *   scopesGranted: ["data.read"],
 *   status: "active",
 *   reputation: 50,
 *   metadata: {},
 * });
 * ```
 */
export class SupabasePlugin {
  private config: Required<Pick<SupabasePluginConfig, "tableName" | "autoSync">> & SupabasePluginConfig;
  private client: SupabaseClientInterface | null = null;

  constructor(config: SupabasePluginConfig) {
    this.config = {
      ...config,
      tableName: config.tableName ?? "agentdoor_agents",
      autoSync: config.autoSync ?? true,
    };
  }

  /**
   * Set the Supabase client instance.
   */
  setClient(client: SupabaseClientInterface): void {
    this.client = client;
  }

  /**
   * Sync an agent to Supabase (upsert).
   */
  async syncAgent(agent: {
    id: string;
    publicKey: string;
    scopesGranted: string[];
    status: string;
    reputation: number;
    x402Wallet?: string;
    metadata: Record<string, string>;
  }): Promise<SupabaseSyncResult> {
    if (!this.client) {
      return { success: false, error: "Supabase client not configured. Call setClient() first." };
    }

    try {
      const record = {
        id: agent.id,
        public_key: agent.publicKey,
        scopes_granted: agent.scopesGranted,
        status: agent.status,
        reputation: agent.reputation,
        x402_wallet: agent.x402Wallet ?? null,
        metadata: agent.metadata,
        updated_at: new Date().toISOString(),
      };

      const result = await this.client
        .from(this.config.tableName)
        .upsert([record])
        .select()
        .single();

      if (result.error) {
        return { success: false, error: result.error.message, agentId: agent.id };
      }

      return { success: true, agentId: agent.id, created: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        agentId: agent.id,
      };
    }
  }

  /**
   * Get an agent record from Supabase.
   */
  async getAgent(agentId: string): Promise<SupabaseAgentRecord | null> {
    if (!this.client) return null;

    try {
      const result = await this.client
        .from(this.config.tableName)
        .select("*")
        .eq("id", agentId)
        .single();

      if (result.error || !result.data) return null;
      return result.data as unknown as SupabaseAgentRecord;
    } catch {
      return null;
    }
  }

  /**
   * Remove an agent record from Supabase.
   */
  async removeAgent(agentId: string): Promise<SupabaseSyncResult> {
    if (!this.client) {
      return { success: false, error: "Supabase client not configured." };
    }

    try {
      const result = await this.client
        .from(this.config.tableName)
        .delete()
        .eq("id", agentId)
        .single();

      if (result.error) {
        return { success: false, error: result.error.message, agentId };
      }

      return { success: true, agentId };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        agentId,
      };
    }
  }

  /**
   * Get the configured table name.
   */
  getTableName(): string {
    return this.config.tableName;
  }

  /**
   * Check if auto-sync is enabled.
   */
  isAutoSyncEnabled(): boolean {
    return this.config.autoSync;
  }
}
