/**
 * Dashboard Store Bridge
 *
 * Bridges the DashboardApi with an AgentGate core AgentStore instance,
 * allowing the dashboard to read real agent data from any supported
 * storage backend (memory, SQLite, PostgreSQL).
 */

import type { AgentStore } from "@agentgate/core";
import { DashboardApi } from "./api.js";
import type {
  DashboardApiConfig,
  DashboardStats,
  AgentRecord,
  UsageMetrics,
  RevenueMetrics,
} from "./api.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardStoreConfig {
  /** Optional base config overrides */
  config?: Partial<DashboardApiConfig>;
}

// ---------------------------------------------------------------------------
// AgentStore-backed Dashboard API
// ---------------------------------------------------------------------------

/**
 * A DashboardApi implementation backed by an AgentGate core AgentStore.
 *
 * Reads agent data directly from the store and computes dashboard
 * statistics from the stored agent records.
 */
class AgentStoreDashboardApi extends DashboardApi {
  private store: AgentStore;
  private agentIds: Set<string>;

  constructor(store: AgentStore) {
    // Initialize with memory mode as fallback; we override all methods below
    super({ storageType: "memory" });
    this.store = store;
    this.agentIds = new Set();
  }

  /**
   * Register an agent ID so the dashboard can track it.
   * In a production system this would be discovered automatically
   * from the store, but stores do not expose a listAll method.
   */
  trackAgent(id: string): void {
    this.agentIds.add(id);
  }

  /**
   * Remove an agent from dashboard tracking.
   */
  untrackAgent(id: string): void {
    this.agentIds.delete(id);
  }

  override async getStats(): Promise<DashboardStats> {
    const agents = await this.fetchAllTrackedAgents();

    const activeAgents = agents.filter((a) => a.status === "active").length;
    const totalRequests = agents.reduce((sum, a) => sum + a.totalRequests, 0);
    const totalRevenue = agents.reduce((sum, a) => sum + a.totalRevenue, 0);

    const sorted = [...agents].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const recentRegistrations = sorted.slice(0, 5).map((a) => ({
      id: a.id,
      name: a.metadata.name ?? a.id,
      date: a.createdAt,
    }));

    const topAgents = [...agents]
      .sort((a, b) => b.totalRequests - a.totalRequests)
      .slice(0, 5)
      .map((a) => ({
        id: a.id,
        requests: a.totalRequests,
        revenue: a.totalRevenue,
      }));

    return {
      totalAgents: agents.length,
      activeAgents,
      totalRequests,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      recentRegistrations,
      topAgents,
    };
  }

  override async getAgents(options?: {
    limit?: number;
    offset?: number;
  }): Promise<AgentRecord[]> {
    const agents = await this.fetchAllTrackedAgents();
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    return agents.slice(offset, offset + limit);
  }

  override async getAgent(id: string): Promise<AgentRecord | null> {
    const agent = await this.store.getAgent(id);
    if (!agent) return null;

    return {
      id: agent.id,
      publicKey: agent.publicKey,
      status: agent.status,
      scopesGranted: agent.scopesGranted,
      reputation: agent.reputation,
      totalRequests: agent.totalRequests,
      totalRevenue: agent.totalX402Paid,
      framework: agent.metadata.framework,
      lastActiveAt: agent.lastAuthAt.toISOString(),
      createdAt: agent.createdAt.toISOString(),
      metadata: agent.metadata,
    };
  }

  override async getUsageMetrics(_timeRange: string): Promise<UsageMetrics> {
    // AgentStore does not track per-request logs,
    // so we return aggregate data from agent records
    const agents = await this.fetchAllTrackedAgents();
    const totalAgentRequests = agents.reduce(
      (sum, a) => sum + a.totalRequests,
      0,
    );

    return {
      timeRange: _timeRange,
      dataPoints: [],
      totalAgentRequests,
      totalHumanRequests: 0,
    };
  }

  override async getRevenueMetrics(
    _timeRange: string,
  ): Promise<RevenueMetrics> {
    // AgentStore does not track time-series revenue,
    // so we return aggregate data from agent records
    const agents = await this.fetchAllTrackedAgents();
    const totalRevenue = agents.reduce((sum, a) => sum + a.totalRevenue, 0);

    return {
      timeRange: _timeRange,
      dataPoints: [],
      totalRevenue: Math.round(totalRevenue * 100) / 100,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async fetchAllTrackedAgents(): Promise<AgentRecord[]> {
    const agents: AgentRecord[] = [];

    for (const id of this.agentIds) {
      const agent = await this.store.getAgent(id);
      if (agent) {
        agents.push({
          id: agent.id,
          publicKey: agent.publicKey,
          status: agent.status,
          scopesGranted: agent.scopesGranted,
          reputation: agent.reputation,
          totalRequests: agent.totalRequests,
          totalRevenue: agent.totalX402Paid,
          framework: agent.metadata.framework,
          lastActiveAt: agent.lastAuthAt.toISOString(),
          createdAt: agent.createdAt.toISOString(),
          metadata: agent.metadata,
        });
      }
    }

    return agents;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a DashboardApi instance backed by an AgentGate core AgentStore.
 *
 * This bridges the dashboard frontend with actual storage data,
 * allowing the dashboard to display real agent registrations,
 * usage statistics, and revenue information.
 *
 * @param store - An AgentStore instance (MemoryStore, SQLiteStore, PostgresStore)
 * @returns A DashboardApi that reads from the given store
 *
 * @example
 * ```ts
 * import { MemoryStore } from "@agentgate/core";
 * import { createDashboardStore } from "./store";
 *
 * const store = new MemoryStore();
 * const dashboardApi = createDashboardStore(store);
 *
 * // Track agents that should appear in the dashboard
 * dashboardApi.trackAgent("ag_12345");
 *
 * // Get stats computed from the real store
 * const stats = await dashboardApi.getStats();
 * ```
 */
export function createDashboardStore(
  store: AgentStore,
): AgentStoreDashboardApi {
  return new AgentStoreDashboardApi(store);
}
