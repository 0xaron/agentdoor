/**
 * @agentgate/next-auth - NextAuth Companion
 *
 * Adds an "agent" credential provider to NextAuth.js.
 * When agents authenticate through AgentGate, they receive sessions
 * that work within the NextAuth ecosystem.
 */

import type { Agent, AgentContext } from "@agentgate/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the NextAuth agent companion plugin. */
export interface NextAuthAgentConfig {
  /** Custom session type string. Default: "agent" */
  agentSessionType?: string;
  /** Custom session callback to add extra fields to agent sessions */
  sessionCallback?: (agent: AgentContext) => Record<string, unknown>;
}

/** Result of creating a NextAuth provider. */
export interface NextAuthProviderResult {
  /** Provider ID */
  id: string;
  /** Provider display name */
  name: string;
  /** Provider type (always "credentials") */
  type: string;
  /** Credential fields definition */
  credentials: Record<string, unknown>;
  /** Authorization function that validates agent credentials */
  authorize: (credentials: Record<string, unknown>) => Promise<NextAuthAgentUser | null>;
}

/** NextAuth user object for an agent. */
export interface NextAuthAgentUser {
  /** User ID (mapped from agent ID) */
  id: string;
  /** Display name */
  name: string;
  /** Synthetic email for the agent */
  email: string;
  /** Always "agent" to distinguish from human users */
  type: "agent";
  /** AgentGate agent ID */
  agentId: string;
  /** Granted scopes */
  scopes: string[];
  /** Base64-encoded public key */
  publicKey: string;
}

/** NextAuth session object for an agent. */
export interface NextAuthAgentSession {
  /** The agent user */
  user: NextAuthAgentUser;
  /** Session type (always "agent") */
  type: "agent";
  /** AgentGate agent ID */
  agentId: string;
  /** Granted scopes */
  scopes: string[];
}

// ---------------------------------------------------------------------------
// NextAuthCompanion Class
// ---------------------------------------------------------------------------

/**
 * NextAuth companion plugin for AgentGate.
 *
 * Provides a NextAuth credentials provider that allows agents
 * to authenticate and receive sessions. Agents must first be
 * registered via `registerAgent()` before they can authorize.
 *
 * Usage:
 * ```ts
 * const companion = new NextAuthCompanion();
 *
 * // Register agents as they come from AgentGate
 * companion.registerAgent(agent);
 *
 * // Use the provider in NextAuth config
 * const provider = companion.createProvider();
 * ```
 */
export class NextAuthCompanion {
  private config: NextAuthAgentConfig;
  private agentStore: Map<string, Agent>;

  constructor(config?: NextAuthAgentConfig) {
    this.config = config ?? {};
    this.agentStore = new Map();
  }

  /**
   * Create a NextAuth credentials provider for agent authentication.
   *
   * The provider accepts `agentId` and `apiKey` as credentials
   * and returns a NextAuth user object representing the agent.
   */
  createProvider(): NextAuthProviderResult {
    return {
      id: "agentgate",
      name: "AgentGate Agent",
      type: "credentials",
      credentials: {
        agentId: { label: "Agent ID", type: "text" },
        apiKey: { label: "API Key", type: "password" },
      },
      authorize: async (credentials: Record<string, unknown>): Promise<NextAuthAgentUser | null> => {
        const agentId = credentials.agentId as string | undefined;

        if (!agentId) {
          return null;
        }

        const agent = this.agentStore.get(agentId);
        if (!agent) {
          return null;
        }

        if (agent.status !== "active") {
          return null;
        }

        return {
          id: agent.id,
          name: agent.metadata.name ?? `Agent ${agent.id}`,
          email: `${agent.id}@agentgate.local`,
          type: "agent",
          agentId: agent.id,
          scopes: agent.scopesGranted,
          publicKey: agent.publicKey,
        };
      },
    };
  }

  /**
   * Session callback to enrich NextAuth sessions with agent data.
   *
   * Use this as the `session` callback in your NextAuth configuration
   * to add agent-specific fields to the session.
   */
  sessionCallback(params: { session: any; token: any }): any {
    const { session, token } = params;
    const sessionType = this.config.agentSessionType ?? "agent";

    if (token?.type === "agent") {
      session.type = sessionType;
      session.agentId = token.agentId;
      session.scopes = token.scopes;
    }

    return session;
  }

  /**
   * Register an agent so it can authenticate via the NextAuth provider.
   */
  registerAgent(agent: Agent): void {
    this.agentStore.set(agent.id, agent);
  }

  /**
   * Get a session representation for a registered agent.
   */
  getAgentSession(agentId: string): NextAuthAgentSession | null {
    const agent = this.agentStore.get(agentId);
    if (!agent) {
      return null;
    }

    const user: NextAuthAgentUser = {
      id: agent.id,
      name: agent.metadata.name ?? `Agent ${agent.id}`,
      email: `${agent.id}@agentgate.local`,
      type: "agent",
      agentId: agent.id,
      scopes: agent.scopesGranted,
      publicKey: agent.publicKey,
    };

    return {
      user,
      type: "agent",
      agentId: agent.id,
      scopes: agent.scopesGranted,
    };
  }
}
