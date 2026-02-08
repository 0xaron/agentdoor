/**
 * @agentgate/auth0 - Auth0 Companion
 *
 * Creates and manages Auth0 user records for AgentGate agents.
 * Agents are registered as M2M clients with special metadata
 * to distinguish them from human users.
 */

import type { Agent } from "@agentgate/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the Auth0 companion plugin. */
export interface Auth0CompanionConfig {
  /** Auth0 domain, e.g. "my-tenant.us.auth0.com" */
  domain: string;
  /** Auth0 Management API client ID */
  clientId: string;
  /** Auth0 Management API client secret */
  clientSecret: string;
  /** API audience for M2M grants */
  audience?: string;
  /** Auth0 connection name */
  connection?: string;
  /** Key name for agent metadata in Auth0 user app_metadata. Default: "agentgate" */
  agentMetadataKey?: string;
}

/** Interface for Auth0 API operations. */
export interface Auth0ClientInterface {
  createUser(data: Record<string, unknown>): Promise<{ user_id: string }>;
  updateUser(id: string, data: Record<string, unknown>): Promise<void>;
  deleteUser(id: string): Promise<void>;
  getUser(id: string): Promise<Record<string, unknown> | null>;
  createClientGrant(data: Record<string, unknown>): Promise<{ id: string }>;
}

/** Result of an Auth0 sync operation. */
export interface Auth0SyncResult {
  /** Auth0 user ID for the synced agent */
  auth0UserId: string;
  /** AgentGate agent ID */
  agentId: string;
  /** Whether the sync succeeded */
  synced: boolean;
  /** Client grant ID (if audience is configured) */
  grantId?: string;
}

// ---------------------------------------------------------------------------
// Auth0Companion Class
// ---------------------------------------------------------------------------

/**
 * Auth0 companion plugin for AgentGate.
 *
 * When agents register through AgentGate, this plugin automatically
 * creates corresponding user records in Auth0. Agent accounts include
 * metadata marking them as agents with their granted scopes and wallet info.
 *
 * Usage:
 * ```ts
 * const auth0 = new Auth0Companion(
 *   { domain: "my-tenant.us.auth0.com", clientId: "xxx", clientSecret: "yyy" },
 *   auth0ManagementClient,
 * );
 *
 * const result = await auth0.onAgentRegistered(agent);
 * ```
 */
export class Auth0Companion {
  private config: Auth0CompanionConfig;
  private client: Auth0ClientInterface;
  private agentUserMap: Map<string, string>;

  constructor(config: Auth0CompanionConfig, client: Auth0ClientInterface) {
    this.config = config;
    this.client = client;
    this.agentUserMap = new Map();
  }

  /**
   * Handle a new agent registration by creating a corresponding Auth0 user.
   *
   * Creates a user with app_metadata containing agent information:
   * `{ is_agent: true, agent_id, scopes, wallet }`.
   *
   * If an `audience` is configured, also creates a client grant.
   */
  async onAgentRegistered(agent: Agent): Promise<Auth0SyncResult> {
    try {
      const metadataKey = this.config.agentMetadataKey ?? "agentgate";

      const userData: Record<string, unknown> = {
        email: `${agent.id}@agents.${this.config.domain}`,
        email_verified: true,
        connection: this.config.connection ?? "Username-Password-Authentication",
        app_metadata: {
          [metadataKey]: {
            is_agent: true,
            agent_id: agent.id,
            scopes: agent.scopesGranted,
            wallet: agent.x402Wallet ?? null,
          },
        },
      };

      const result = await this.client.createUser(userData);
      this.agentUserMap.set(agent.id, result.user_id);

      let grantId: string | undefined;

      if (this.config.audience) {
        const grant = await this.client.createClientGrant({
          client_id: this.config.clientId,
          audience: this.config.audience,
          scope: agent.scopesGranted,
        });
        grantId = grant.id;
      }

      return {
        auth0UserId: result.user_id,
        agentId: agent.id,
        synced: true,
        grantId,
      };
    } catch (err) {
      return {
        auth0UserId: "",
        agentId: agent.id,
        synced: false,
      };
    }
  }

  /**
   * Handle agent revocation by deleting the corresponding Auth0 user.
   */
  async onAgentRevoked(agentId: string): Promise<void> {
    const auth0UserId = this.agentUserMap.get(agentId);
    if (!auth0UserId) {
      return;
    }

    await this.client.deleteUser(auth0UserId);
    this.agentUserMap.delete(agentId);
  }

  /**
   * Get the Auth0 user ID for a given agent.
   */
  async getAuth0UserId(agentId: string): Promise<string | null> {
    return this.agentUserMap.get(agentId) ?? null;
  }

  /**
   * Sync an existing agent to Auth0. Updates the Auth0 user with
   * current agent data if a mapping exists, otherwise creates a new user.
   */
  async syncAgent(agent: Agent): Promise<Auth0SyncResult> {
    const existingUserId = this.agentUserMap.get(agent.id);

    if (existingUserId) {
      try {
        const metadataKey = this.config.agentMetadataKey ?? "agentgate";

        await this.client.updateUser(existingUserId, {
          app_metadata: {
            [metadataKey]: {
              is_agent: true,
              agent_id: agent.id,
              scopes: agent.scopesGranted,
              wallet: agent.x402Wallet ?? null,
            },
          },
        });

        return {
          auth0UserId: existingUserId,
          agentId: agent.id,
          synced: true,
        };
      } catch (err) {
        return {
          auth0UserId: existingUserId,
          agentId: agent.id,
          synced: false,
        };
      }
    }

    return this.onAgentRegistered(agent);
  }
}
