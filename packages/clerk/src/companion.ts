/**
 * @agentdoor/clerk - Clerk Companion
 *
 * Creates and manages Clerk user records for AgentDoor agents.
 * Agent accounts appear in the Clerk dashboard with special metadata
 * to distinguish them from human users.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the Clerk companion plugin. */
export interface ClerkCompanionConfig {
  /** Clerk secret key for Backend API calls */
  clerkSecretKey: string;
  /** Whether to auto-create Clerk users for new agents. Default: true */
  autoCreateUsers?: boolean;
  /** Custom metadata to add to Clerk user profiles */
  metadata?: Record<string, string>;
  /** Prefix for agent usernames in Clerk. Default: "agent_" */
  usernamePrefix?: string;
}

/** Mapping between an AgentDoor agent and a Clerk user. */
export interface ClerkUserMapping {
  /** AgentDoor agent ID */
  agentId: string;
  /** Clerk user ID */
  clerkUserId: string;
  /** When this mapping was created */
  createdAt: Date;
  /** Whether the Clerk user is synced with latest agent data */
  synced: boolean;
}

/** Result of a Clerk sync operation. */
export interface ClerkSyncResult {
  /** Whether the sync succeeded */
  success: boolean;
  /** Clerk user ID (if created/updated) */
  clerkUserId?: string;
  /** Whether a new user was created (vs updated) */
  created?: boolean;
  /** Error message (if failed) */
  error?: string;
}

/** Minimal Clerk user object. */
export interface ClerkUser {
  id: string;
  username?: string;
  publicMetadata?: Record<string, unknown>;
  privateMetadata?: Record<string, unknown>;
}

/** Interface for Clerk API operations we need. */
export interface ClerkClientInterface {
  createUser(params: {
    username: string;
    publicMetadata?: Record<string, unknown>;
    privateMetadata?: Record<string, unknown>;
  }): Promise<ClerkUser>;

  updateUser(userId: string, params: {
    publicMetadata?: Record<string, unknown>;
    privateMetadata?: Record<string, unknown>;
  }): Promise<ClerkUser>;

  deleteUser(userId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// ClerkCompanion Class
// ---------------------------------------------------------------------------

/**
 * Clerk companion plugin for AgentDoor.
 *
 * When agents register through AgentDoor, this plugin automatically
 * creates corresponding user records in Clerk. This allows SaaS owners
 * to manage both human and agent accounts from the Clerk dashboard.
 *
 * Usage:
 * ```ts
 * const clerk = new ClerkCompanion({
 *   clerkSecretKey: process.env.CLERK_SECRET_KEY!,
 * });
 *
 * // Set the Clerk client (real or mock)
 * clerk.setClerkClient(clerkClient);
 *
 * // When an agent registers:
 * const result = await clerk.syncAgent({
 *   agentId: "ag_xxx",
 *   publicKey: "base64...",
 *   scopes: ["data.read"],
 *   metadata: { name: "MyAgent" },
 * });
 * ```
 */
export class ClerkCompanion {
  private config: Required<Pick<ClerkCompanionConfig, "autoCreateUsers" | "usernamePrefix">> & ClerkCompanionConfig;
  private userMappings: Map<string, ClerkUserMapping> = new Map();
  private clerkClient: ClerkClientInterface | null = null;

  constructor(config: ClerkCompanionConfig) {
    this.config = {
      ...config,
      autoCreateUsers: config.autoCreateUsers ?? true,
      usernamePrefix: config.usernamePrefix ?? "agent_",
    };
  }

  /**
   * Set the Clerk client instance.
   */
  setClerkClient(client: ClerkClientInterface): void {
    this.clerkClient = client;
  }

  /**
   * Sync an agent to Clerk. Creates a new user or updates an existing one.
   *
   * @param agent - Agent data to sync
   * @returns Sync result
   */
  async syncAgent(agent: {
    agentId: string;
    publicKey: string;
    scopes: string[];
    metadata?: Record<string, string>;
    reputation?: number;
  }): Promise<ClerkSyncResult> {
    if (!this.clerkClient) {
      return { success: false, error: "Clerk client not configured. Call setClerkClient() first." };
    }

    try {
      const existing = this.userMappings.get(agent.agentId);

      if (existing) {
        // Update existing Clerk user
        const user = await this.clerkClient.updateUser(existing.clerkUserId, {
          publicMetadata: {
            agentdoor: true,
            agentdoor_id: agent.agentId,
            scopes: agent.scopes,
            reputation: agent.reputation,
            ...this.config.metadata,
          },
          privateMetadata: {
            agentdoor_public_key: agent.publicKey,
            agentdoor_metadata: agent.metadata,
          },
        });

        existing.synced = true;

        return {
          success: true,
          clerkUserId: user.id,
          created: false,
        };
      }

      if (!this.config.autoCreateUsers) {
        return { success: false, error: "Auto-create disabled and no existing mapping found." };
      }

      // Create new Clerk user for this agent
      const username = `${this.config.usernamePrefix}${agent.agentId.replace(/^ag_/, "")}`;

      const user = await this.clerkClient.createUser({
        username,
        publicMetadata: {
          agentdoor: true,
          agentdoor_id: agent.agentId,
          scopes: agent.scopes,
          reputation: agent.reputation,
          ...this.config.metadata,
        },
        privateMetadata: {
          agentdoor_public_key: agent.publicKey,
          agentdoor_metadata: agent.metadata,
        },
      });

      this.userMappings.set(agent.agentId, {
        agentId: agent.agentId,
        clerkUserId: user.id,
        createdAt: new Date(),
        synced: true,
      });

      return {
        success: true,
        clerkUserId: user.id,
        created: true,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Remove an agent's Clerk user record.
   *
   * @param agentId - AgentDoor agent ID
   * @returns Whether the deletion succeeded
   */
  async removeAgent(agentId: string): Promise<ClerkSyncResult> {
    if (!this.clerkClient) {
      return { success: false, error: "Clerk client not configured." };
    }

    const mapping = this.userMappings.get(agentId);
    if (!mapping) {
      return { success: false, error: `No Clerk user found for agent ${agentId}.` };
    }

    try {
      await this.clerkClient.deleteUser(mapping.clerkUserId);
      this.userMappings.delete(agentId);
      return { success: true, clerkUserId: mapping.clerkUserId };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Manually map an agent to a Clerk user.
   */
  mapUser(agentId: string, clerkUserId: string): void {
    this.userMappings.set(agentId, {
      agentId,
      clerkUserId,
      createdAt: new Date(),
      synced: false,
    });
  }

  /**
   * Get the mapping for an agent.
   */
  getMapping(agentId: string): ClerkUserMapping | undefined {
    return this.userMappings.get(agentId);
  }

  /**
   * Get all mappings.
   */
  getAllMappings(): ClerkUserMapping[] {
    return Array.from(this.userMappings.values());
  }

  /**
   * Clear all mappings.
   */
  clearMappings(): void {
    this.userMappings.clear();
  }
}
