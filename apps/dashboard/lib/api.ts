/**
 * Dashboard API Client
 *
 * Connects to actual AgentDoor storage backends or falls back to
 * in-memory mock data. Provides a unified interface for the dashboard
 * to retrieve statistics, agents, and metrics.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardApiConfig {
  /** Storage backend type */
  storageType: "memory" | "api";
  /** Base URL for the AgentDoor API (when storageType is "api") */
  apiUrl?: string;
  /** API key for authenticating with the backend */
  apiKey?: string;
}

export interface DashboardStats {
  /** Total number of registered agents */
  totalAgents: number;
  /** Number of currently active agents */
  activeAgents: number;
  /** Total requests across all agents */
  totalRequests: number;
  /** Total revenue (x402 payments) */
  totalRevenue: number;
  /** Recently registered agents */
  recentRegistrations: Array<{ id: string; name: string; date: string }>;
  /** Top agents by request volume */
  topAgents: Array<{ id: string; requests: number; revenue: number }>;
}

export interface AgentRecord {
  id: string;
  publicKey: string;
  status: string;
  scopesGranted: string[];
  reputation: number;
  totalRequests: number;
  totalRevenue: number;
  framework?: string;
  lastActiveAt?: string;
  createdAt: string;
  metadata: Record<string, string>;
}

export interface UsageMetrics {
  timeRange: string;
  dataPoints: Array<{
    date: string;
    agentRequests: number;
    humanRequests: number;
  }>;
  totalAgentRequests: number;
  totalHumanRequests: number;
}

export interface RevenueMetrics {
  timeRange: string;
  dataPoints: Array<{
    period: string;
    x402Revenue: number;
    subscriptionRevenue: number;
  }>;
  totalRevenue: number;
}

// ---------------------------------------------------------------------------
// In-Memory Storage
// ---------------------------------------------------------------------------

/** Simple in-memory data store for development and testing. */
class MemoryDashboardStore {
  private agents: AgentRecord[] = [];
  private requestLog: Array<{
    date: string;
    agentRequests: number;
    humanRequests: number;
  }> = [];
  private revenueLog: Array<{
    period: string;
    x402Revenue: number;
    subscriptionRevenue: number;
  }> = [];

  constructor() {
    this.seedData();
  }

  getStats(): DashboardStats {
    const activeAgents = this.agents.filter(
      (a) => a.status === "active",
    ).length;
    const totalRequests = this.agents.reduce(
      (sum, a) => sum + a.totalRequests,
      0,
    );
    const totalRevenue = this.agents.reduce(
      (sum, a) => sum + a.totalRevenue,
      0,
    );

    const sorted = [...this.agents].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const recentRegistrations = sorted.slice(0, 5).map((a) => ({
      id: a.id,
      name: a.metadata.name ?? a.id,
      date: a.createdAt,
    }));

    const topAgents = [...this.agents]
      .sort((a, b) => b.totalRequests - a.totalRequests)
      .slice(0, 5)
      .map((a) => ({
        id: a.id,
        requests: a.totalRequests,
        revenue: a.totalRevenue,
      }));

    return {
      totalAgents: this.agents.length,
      activeAgents,
      totalRequests,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      recentRegistrations,
      topAgents,
    };
  }

  getAgents(options?: { limit?: number; offset?: number }): AgentRecord[] {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    return this.agents.slice(offset, offset + limit);
  }

  getAgent(id: string): AgentRecord | null {
    return this.agents.find((a) => a.id === id) ?? null;
  }

  getUsageMetrics(timeRange: string): UsageMetrics {
    const filteredPoints = this.filterByTimeRange(this.requestLog, timeRange);
    return {
      timeRange,
      dataPoints: filteredPoints,
      totalAgentRequests: filteredPoints.reduce(
        (sum, d) => sum + d.agentRequests,
        0,
      ),
      totalHumanRequests: filteredPoints.reduce(
        (sum, d) => sum + d.humanRequests,
        0,
      ),
    };
  }

  getRevenueMetrics(timeRange: string): RevenueMetrics {
    const filteredPoints = this.filterRevenueByTimeRange(
      this.revenueLog,
      timeRange,
    );
    return {
      timeRange,
      dataPoints: filteredPoints,
      totalRevenue: filteredPoints.reduce(
        (sum, d) => sum + d.x402Revenue + d.subscriptionRevenue,
        0,
      ),
    };
  }

  private filterByTimeRange<T>(data: T[], _timeRange: string): T[] {
    // In a real implementation, filter by date range
    // For memory store, return all data
    return data;
  }

  private filterRevenueByTimeRange<T>(data: T[], _timeRange: string): T[] {
    return data;
  }

  private seedData(): {
    agents: AgentRecord[];
    requestLog: Array<{
      date: string;
      agentRequests: number;
      humanRequests: number;
    }>;
    revenueLog: Array<{
      period: string;
      x402Revenue: number;
      subscriptionRevenue: number;
    }>;
  } {
    this.agents = [
      {
        id: "ag_8kTm2xPqR4",
        publicKey: "mK7vFpNx3Q9bW2...",
        status: "active",
        scopesGranted: ["data.read", "data.write", "analytics.read"],
        reputation: 92,
        totalRequests: 145_320,
        totalRevenue: 487.22,
        framework: "LangChain",
        lastActiveAt: "2026-02-08T14:33:02Z",
        createdAt: "2026-01-03T08:22:11Z",
        metadata: { name: "DataPipeline Agent", version: "0.3.14" },
      },
      {
        id: "ag_3nLp7wDkS1",
        publicKey: "jR4tYcBn8H6mP5...",
        status: "active",
        scopesGranted: ["data.read", "search.execute"],
        reputation: 88,
        totalRequests: 98_450,
        totalRevenue: 312.89,
        framework: "CrewAI",
        lastActiveAt: "2026-02-08T13:21:45Z",
        createdAt: "2026-01-08T11:45:33Z",
        metadata: { name: "Research Crawler", version: "0.41.0" },
      },
      {
        id: "ag_9xVm4kHjT7",
        publicKey: "pL2wAeRs5C8nD4...",
        status: "active",
        scopesGranted: ["data.read"],
        reputation: 95,
        totalRequests: 76_200,
        totalRevenue: 228.6,
        framework: "AutoGen",
        lastActiveAt: "2026-02-08T12:05:19Z",
        createdAt: "2026-01-12T16:30:00Z",
        metadata: { name: "Content Summarizer", version: "0.4.2" },
      },
      {
        id: "ag_5pQr1mZkW8",
        publicKey: "tG6hNbKx9J3vF7...",
        status: "active",
        scopesGranted: ["data.read", "pricing.read"],
        reputation: 45,
        totalRequests: 234_100,
        totalRevenue: 702.3,
        framework: "LangChain",
        lastActiveAt: "2026-02-08T14:30:00Z",
        createdAt: "2025-12-28T09:12:44Z",
        metadata: { name: "Price Monitor Bot", version: "0.3.12" },
      },
      {
        id: "ag_7hDk3bGxL0",
        publicKey: "cV5nTzAw2E7yH3...",
        status: "suspended",
        scopesGranted: ["data.read", "trading.execute"],
        reputation: 22,
        totalRequests: 189_750,
        totalRevenue: 1_423.5,
        framework: "Virtuals",
        lastActiveAt: "2026-02-05T18:42:33Z",
        createdAt: "2025-12-15T06:30:00Z",
        metadata: { name: "Trading Signal Agent", version: "2.1.0" },
      },
    ];

    this.requestLog = [
      { date: "2026-02-02", agentRequests: 3_420, humanRequests: 5_820 },
      { date: "2026-02-03", agentRequests: 4_180, humanRequests: 6_100 },
      { date: "2026-02-04", agentRequests: 3_950, humanRequests: 5_600 },
      { date: "2026-02-05", agentRequests: 4_800, humanRequests: 6_350 },
      { date: "2026-02-06", agentRequests: 5_200, humanRequests: 6_900 },
      { date: "2026-02-07", agentRequests: 3_100, humanRequests: 3_200 },
      { date: "2026-02-08", agentRequests: 2_800, humanRequests: 2_450 },
    ];

    this.revenueLog = [
      { period: "2025-09", x402Revenue: 320, subscriptionRevenue: 180 },
      { period: "2025-10", x402Revenue: 480, subscriptionRevenue: 220 },
      { period: "2025-11", x402Revenue: 620, subscriptionRevenue: 310 },
      { period: "2025-12", x402Revenue: 780, subscriptionRevenue: 390 },
      { period: "2026-01", x402Revenue: 1_050, subscriptionRevenue: 520 },
      { period: "2026-02", x402Revenue: 1_243, subscriptionRevenue: 680 },
    ];

    return {
      agents: this.agents,
      requestLog: this.requestLog,
      revenueLog: this.revenueLog,
    };
  }
}

// ---------------------------------------------------------------------------
// Remote API Client
// ---------------------------------------------------------------------------

/** Fetches data from a remote AgentDoor API. */
class RemoteDashboardClient {
  private apiUrl: string;
  private apiKey?: string;

  constructor(apiUrl: string, apiKey?: string) {
    this.apiUrl = apiUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  async getStats(): Promise<DashboardStats> {
    return this.request<DashboardStats>("/api/dashboard/stats");
  }

  async getAgents(options?: {
    limit?: number;
    offset?: number;
  }): Promise<AgentRecord[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));
    const qs = params.toString();
    return this.request<AgentRecord[]>(
      `/api/dashboard/agents${qs ? `?${qs}` : ""}`,
    );
  }

  async getAgent(id: string): Promise<AgentRecord | null> {
    try {
      return await this.request<AgentRecord>(`/api/dashboard/agents/${id}`);
    } catch {
      return null;
    }
  }

  async getUsageMetrics(timeRange: string): Promise<UsageMetrics> {
    return this.request<UsageMetrics>(
      `/api/dashboard/usage?timeRange=${encodeURIComponent(timeRange)}`,
    );
  }

  async getRevenueMetrics(timeRange: string): Promise<RevenueMetrics> {
    return this.request<RevenueMetrics>(
      `/api/dashboard/revenue?timeRange=${encodeURIComponent(timeRange)}`,
    );
  }

  private async request<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.apiUrl}${path}`, { headers });

    if (!response.ok) {
      throw new Error(
        `Dashboard API error: ${response.status} ${response.statusText}`,
      );
    }

    const body = (await response.json()) as { data?: T };
    return (body.data ?? body) as T;
  }
}

// ---------------------------------------------------------------------------
// DashboardApi
// ---------------------------------------------------------------------------

export class DashboardApi {
  private memoryStore?: MemoryDashboardStore;
  private remoteClient?: RemoteDashboardClient;

  constructor(config: DashboardApiConfig) {
    if (config.storageType === "api" && config.apiUrl) {
      this.remoteClient = new RemoteDashboardClient(
        config.apiUrl,
        config.apiKey,
      );
    } else {
      this.memoryStore = new MemoryDashboardStore();
    }
  }

  /**
   * Get dashboard overview statistics.
   */
  async getStats(): Promise<DashboardStats> {
    if (this.remoteClient) {
      return this.remoteClient.getStats();
    }
    return this.memoryStore!.getStats();
  }

  /**
   * Get a paginated list of agents.
   */
  async getAgents(options?: {
    limit?: number;
    offset?: number;
  }): Promise<AgentRecord[]> {
    if (this.remoteClient) {
      return this.remoteClient.getAgents(options);
    }
    return this.memoryStore!.getAgents(options);
  }

  /**
   * Get a single agent by ID.
   */
  async getAgent(id: string): Promise<AgentRecord | null> {
    if (this.remoteClient) {
      return this.remoteClient.getAgent(id);
    }
    return this.memoryStore!.getAgent(id);
  }

  /**
   * Get usage metrics for a given time range.
   *
   * @param timeRange - Time range string (e.g. "7d", "30d", "90d")
   */
  async getUsageMetrics(timeRange: string): Promise<UsageMetrics> {
    if (this.remoteClient) {
      return this.remoteClient.getUsageMetrics(timeRange);
    }
    return this.memoryStore!.getUsageMetrics(timeRange);
  }

  /**
   * Get revenue metrics for a given time range.
   *
   * @param timeRange - Time range string (e.g. "7d", "30d", "6m")
   */
  async getRevenueMetrics(timeRange: string): Promise<RevenueMetrics> {
    if (this.remoteClient) {
      return this.remoteClient.getRevenueMetrics(timeRange);
    }
    return this.memoryStore!.getRevenueMetrics(timeRange);
  }
}
