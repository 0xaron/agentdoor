/**
 * @agentgate/core - In-Memory Storage Implementation
 *
 * Map-based implementation of AgentStore for development and testing.
 * Data is lost when the process exits. Not suitable for production.
 */

import type { Agent, ChallengeData } from "../types.js";
import type { AgentStore, CreateAgentInput, UpdateAgentInput } from "./interface.js";
import { AgentNotFoundError, DuplicateAgentError } from "../errors.js";
import { DEFAULT_REPUTATION, DEFAULT_AGENT_STATUS } from "../constants.js";

/**
 * In-memory implementation of AgentStore using JavaScript Maps.
 *
 * Suitable for:
 * - Development environments
 * - Testing
 * - Prototyping
 * - Serverless environments with short-lived processes
 *
 * NOT suitable for:
 * - Production deployments (data lost on restart)
 * - Multi-process / clustered environments (no shared state)
 */
export class MemoryStore implements AgentStore {
  /** Map of agent ID -> Agent record */
  private agents: Map<string, Agent> = new Map();

  /** Map of API key hash -> Agent ID (index for fast lookup) */
  private apiKeyIndex: Map<string, string> = new Map();

  /** Map of public key -> Agent ID (index for fast lookup & duplicate detection) */
  private publicKeyIndex: Map<string, string> = new Map();

  /** Map of agent ID -> ChallengeData (most recent challenge) */
  private challenges: Map<string, ChallengeData> = new Map();

  // -----------------------------------------------------------------------
  // Agent CRUD
  // -----------------------------------------------------------------------

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    // Check for duplicate public key
    if (this.publicKeyIndex.has(input.publicKey)) {
      throw new DuplicateAgentError(
        `An agent with public key "${input.publicKey.substring(0, 16)}..." is already registered.`,
      );
    }

    // Check for duplicate x402 wallet
    if (input.x402Wallet) {
      for (const agent of this.agents.values()) {
        if (agent.x402Wallet === input.x402Wallet) {
          throw new DuplicateAgentError(
            `An agent with x402 wallet "${input.x402Wallet}" is already registered.`,
          );
        }
      }
    }

    const now = new Date();
    const agent: Agent = {
      id: input.id,
      publicKey: input.publicKey,
      x402Wallet: input.x402Wallet,
      scopesGranted: [...input.scopesGranted],
      apiKeyHash: input.apiKeyHash,
      rateLimit: { ...input.rateLimit },
      reputation: DEFAULT_REPUTATION,
      metadata: { ...input.metadata },
      status: DEFAULT_AGENT_STATUS,
      createdAt: now,
      lastAuthAt: now,
      totalRequests: 0,
      totalX402Paid: 0,
    };

    // Store agent and update indexes
    this.agents.set(agent.id, agent);
    this.apiKeyIndex.set(agent.apiKeyHash, agent.id);
    this.publicKeyIndex.set(agent.publicKey, agent.id);

    // Return a defensive copy
    return { ...agent };
  }

  async getAgent(id: string): Promise<Agent | null> {
    const agent = this.agents.get(id);
    return agent ? { ...agent } : null;
  }

  async getAgentByApiKeyHash(apiKeyHash: string): Promise<Agent | null> {
    const agentId = this.apiKeyIndex.get(apiKeyHash);
    if (!agentId) return null;
    return this.getAgent(agentId);
  }

  async getAgentByPublicKey(publicKey: string): Promise<Agent | null> {
    const agentId = this.publicKeyIndex.get(publicKey);
    if (!agentId) return null;
    return this.getAgent(agentId);
  }

  async updateAgent(id: string, input: UpdateAgentInput): Promise<Agent> {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new AgentNotFoundError(`Agent "${id}" not found.`);
    }

    // Apply updates
    if (input.scopesGranted !== undefined) {
      agent.scopesGranted = [...input.scopesGranted];
    }
    if (input.rateLimit !== undefined) {
      agent.rateLimit = { ...input.rateLimit };
    }
    if (input.reputation !== undefined) {
      agent.reputation = input.reputation;
    }
    if (input.metadata !== undefined) {
      agent.metadata = { ...agent.metadata, ...input.metadata };
    }
    if (input.status !== undefined) {
      agent.status = input.status;
    }
    if (input.lastAuthAt !== undefined) {
      agent.lastAuthAt = input.lastAuthAt;
    }
    if (input.incrementRequests !== undefined) {
      agent.totalRequests += input.incrementRequests;
    }
    if (input.incrementX402Paid !== undefined) {
      agent.totalX402Paid += input.incrementX402Paid;
    }

    return { ...agent };
  }

  async deleteAgent(id: string): Promise<boolean> {
    const agent = this.agents.get(id);
    if (!agent) return false;

    // Clean up indexes
    this.apiKeyIndex.delete(agent.apiKeyHash);
    this.publicKeyIndex.delete(agent.publicKey);
    this.agents.delete(id);

    // Also clean up any pending challenges
    this.challenges.delete(id);

    return true;
  }

  // -----------------------------------------------------------------------
  // Challenge Management
  // -----------------------------------------------------------------------

  async createChallenge(challenge: ChallengeData): Promise<void> {
    // Overwrite any existing challenge for this agent
    this.challenges.set(challenge.agentId, { ...challenge });
  }

  async getChallenge(agentId: string): Promise<ChallengeData | null> {
    const challenge = this.challenges.get(agentId);
    if (!challenge) return null;

    // Check if expired
    if (Date.now() > challenge.expiresAt.getTime()) {
      this.challenges.delete(agentId);
      return null;
    }

    return { ...challenge };
  }

  async deleteChallenge(agentId: string): Promise<void> {
    this.challenges.delete(agentId);
  }

  async cleanExpiredChallenges(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [agentId, challenge] of this.challenges) {
      if (now > challenge.expiresAt.getTime()) {
        this.challenges.delete(agentId);
        cleaned++;
      }
    }

    return cleaned;
  }

  // -----------------------------------------------------------------------
  // Lifecycle & Debugging
  // -----------------------------------------------------------------------

  async close(): Promise<void> {
    this.agents.clear();
    this.apiKeyIndex.clear();
    this.publicKeyIndex.clear();
    this.challenges.clear();
  }

  /**
   * Get the total number of registered agents.
   * Useful for testing and debugging.
   */
  get agentCount(): number {
    return this.agents.size;
  }

  /**
   * Get the total number of pending challenges.
   * Useful for testing and debugging.
   */
  get challengeCount(): number {
    return this.challenges.size;
  }

  /**
   * Get all agents (for debugging/admin purposes).
   * Returns defensive copies.
   */
  getAllAgents(): Agent[] {
    return Array.from(this.agents.values()).map((a) => ({ ...a }));
  }
}
