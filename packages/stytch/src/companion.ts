/**
 * @agentdoor/stytch - Stytch Companion
 *
 * Creates and manages Stytch user records for AgentDoor agents.
 * Bridges AgentDoor agent registrations with Stytch Connected Apps
 * so that agents appear as users in the Stytch dashboard.
 */

import type { Agent } from "@agentdoor/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the Stytch companion plugin. */
export interface StytchCompanionConfig {
  /** Stytch project ID */
  projectId: string;
  /** Stytch project secret */
  secret: string;
  /** Stytch environment. Default: "test" */
  environment?: "test" | "live";
}

/** Interface for Stytch API operations. */
export interface StytchClientInterface {
  createUser(data: Record<string, unknown>): Promise<{ user_id: string }>;
  updateUser(id: string, data: Record<string, unknown>): Promise<void>;
  deleteUser(id: string): Promise<void>;
  getUser(id: string): Promise<Record<string, unknown> | null>;
}

/** Result of a Stytch sync operation. */
export interface StytchSyncResult {
  /** Stytch user ID for the synced agent */
  stytchUserId: string;
  /** AgentDoor agent ID */
  agentId: string;
  /** Whether the sync succeeded */
  synced: boolean;
}

// ---------------------------------------------------------------------------
// StytchCompanion Class
// ---------------------------------------------------------------------------

/**
 * Stytch companion plugin for AgentDoor.
 *
 * When agents register through AgentDoor, this plugin automatically
 * creates corresponding user records in Stytch. Agent users include
 * trusted metadata marking them as agents with their granted scopes.
 *
 * Usage:
 * ```ts
 * const stytch = new StytchCompanion(
 *   { projectId: "project-xxx", secret: "secret-yyy" },
 *   stytchClient,
 * );
 *
 * const result = await stytch.onAgentRegistered(agent);
 * ```
 */
export class StytchCompanion {
  private config: StytchCompanionConfig;
  private client: StytchClientInterface;
  private agentUserMap: Map<string, string>;

  constructor(config: StytchCompanionConfig, client: StytchClientInterface) {
    this.config = {
      ...config,
      environment: config.environment ?? "test",
    };
    this.client = client;
    this.agentUserMap = new Map();
  }

  /**
   * Handle a new agent registration by creating a Stytch user.
   *
   * The Stytch user includes trusted metadata with agent identity
   * and scope information.
   */
  async onAgentRegistered(agent: Agent): Promise<StytchSyncResult> {
    try {
      const result = await this.client.createUser({
        email: `${agent.id}@agents.agentdoor.stytch.io`,
        name: {
          first_name: agent.metadata.name ?? "Agent",
          last_name: agent.id,
        },
        trusted_metadata: {
          is_agent: true,
          agent_id: agent.id,
          scopes: agent.scopesGranted,
          wallet: agent.x402Wallet ?? null,
          public_key: agent.publicKey,
          environment: this.config.environment,
        },
      });

      this.agentUserMap.set(agent.id, result.user_id);

      return {
        stytchUserId: result.user_id,
        agentId: agent.id,
        synced: true,
      };
    } catch (err) {
      return {
        stytchUserId: "",
        agentId: agent.id,
        synced: false,
      };
    }
  }

  /**
   * Handle agent revocation by deleting the Stytch user.
   */
  async onAgentRevoked(agentId: string): Promise<void> {
    const stytchUserId = this.agentUserMap.get(agentId);
    if (!stytchUserId) {
      return;
    }

    await this.client.deleteUser(stytchUserId);
    this.agentUserMap.delete(agentId);
  }

  /**
   * Get the Stytch user ID for a given agent.
   */
  async getStytchUserId(agentId: string): Promise<string | null> {
    return this.agentUserMap.get(agentId) ?? null;
  }

  /**
   * Sync an existing agent to Stytch. Updates the Stytch user with
   * current agent data if a mapping exists, otherwise creates a new user.
   */
  async syncAgent(agent: Agent): Promise<StytchSyncResult> {
    const existingUserId = this.agentUserMap.get(agent.id);

    if (existingUserId) {
      try {
        await this.client.updateUser(existingUserId, {
          name: {
            first_name: agent.metadata.name ?? "Agent",
            last_name: agent.id,
          },
          trusted_metadata: {
            is_agent: true,
            agent_id: agent.id,
            scopes: agent.scopesGranted,
            wallet: agent.x402Wallet ?? null,
            public_key: agent.publicKey,
            environment: this.config.environment,
          },
        });

        return {
          stytchUserId: existingUserId,
          agentId: agent.id,
          synced: true,
        };
      } catch (err) {
        return {
          stytchUserId: existingUserId,
          agentId: agent.id,
          synced: false,
        };
      }
    }

    return this.onAgentRegistered(agent);
  }
}
