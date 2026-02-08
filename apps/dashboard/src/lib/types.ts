/**
 * Dashboard API Types
 *
 * Shared types for the dashboard API routes and frontend.
 */

/** Overview statistics for the dashboard. */
export interface DashboardStats {
  totalAgents: number;
  activeAgents: number;
  suspendedAgents: number;
  totalRequests: number;
  requestsToday: number;
  totalRevenue: number;
  revenueThisMonth: number;
  agentTrafficPercent: number;
  averageReputation: number;
}

/** Agent record as displayed in the dashboard. */
export interface DashboardAgent {
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

/** Traffic data point for a single day. */
export interface TrafficDataPoint {
  date: string;
  agentRequests: number;
  humanRequests: number;
}

/** Revenue data point for a single month. */
export interface RevenueDataPoint {
  month: string;
  x402Revenue: number;
  subscriptionRevenue: number;
}

/** Framework distribution entry. */
export interface FrameworkBreakdown {
  framework: string;
  count: number;
  percent: number;
}

/** Scope usage entry. */
export interface ScopeUsage {
  scopeId: string;
  description: string;
  requestCount: number;
  uniqueAgents: number;
}

/** Rate limit event record. */
export interface RateLimitEvent {
  id: string;
  agentId: string;
  timestamp: string;
  limit: number;
  window: string;
  endpoint: string;
}

/** Webhook event record for the events log. */
export interface WebhookEventRecord {
  id: string;
  type: string;
  agentId?: string;
  timestamp: string;
  delivered: boolean;
  payload: Record<string, unknown>;
}

/** Standard API response wrapper. */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}
