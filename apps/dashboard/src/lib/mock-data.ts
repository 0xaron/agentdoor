/**
 * Mock data for the AgentDoor dashboard.
 *
 * In production this would come from the AgentStore and request-log
 * analytics backend. For the MVP dashboard we use static seed data
 * that demonstrates the full analytics, agent management, and
 * revenue tracking capabilities.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardAgent {
  id: string;
  publicKey: string;
  framework: string;
  version: string;
  name: string;
  status: "active" | "suspended" | "rate_limited";
  scopesGranted: string[];
  reputation: number;
  totalRequests: number;
  totalX402Paid: number;
  rateLimit: { requests: number; window: string };
  createdAt: string;
  lastAuthAt: string;
}

export interface TrafficDataPoint {
  label: string;
  agents: number;
  humans: number;
}

export interface RevenueDataPoint {
  label: string;
  x402: number;
  subscriptions: number;
}

export interface FrameworkBreakdown {
  name: string;
  percentage: number;
  count: number;
}

export interface ScopeUsage {
  id: string;
  description: string;
  requestCount: number;
}

export interface RateLimitEvent {
  agentId: string;
  agentName: string;
  timestamp: string;
  limitHit: string;
  requestsAttempted: number;
}

// ---------------------------------------------------------------------------
// Overview Stats
// ---------------------------------------------------------------------------

export const overviewStats = {
  totalAgents: 247,
  activeAgents: 189,
  newRegistrationsThisWeek: 34,
  totalRequests: 1_842_567,
  requestsToday: 28_431,
  avgRequestsPerAgent: 7_460,
  totalRevenue: 4_827.53,
  revenueThisMonth: 1_243.18,
  agentTrafficPercent: 38,
  unregisteredAgentPercent: 12,
  rateLimitEvents: 23,
  avgReputation: 72,
};

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const agents: DashboardAgent[] = [
  {
    id: "ag_8kTm2xPqR4",
    publicKey: "mK7vFpNx3Q9bW2...",
    framework: "LangChain",
    version: "0.3.14",
    name: "DataPipeline Agent",
    status: "active",
    scopesGranted: ["data.read", "data.write", "analytics.read"],
    reputation: 92,
    totalRequests: 145_320,
    totalX402Paid: 487.22,
    rateLimit: { requests: 5000, window: "1h" },
    createdAt: "2026-01-03T08:22:11Z",
    lastAuthAt: "2026-02-08T14:33:02Z",
  },
  {
    id: "ag_3nLp7wDkS1",
    publicKey: "jR4tYcBn8H6mP5...",
    framework: "CrewAI",
    version: "0.41.0",
    name: "Research Crawler",
    status: "active",
    scopesGranted: ["data.read", "search.execute"],
    reputation: 88,
    totalRequests: 98_450,
    totalX402Paid: 312.89,
    rateLimit: { requests: 2000, window: "1h" },
    createdAt: "2026-01-08T11:45:33Z",
    lastAuthAt: "2026-02-08T13:21:45Z",
  },
  {
    id: "ag_9xVm4kHjT7",
    publicKey: "pL2wAeRs5C8nD4...",
    framework: "AutoGen",
    version: "0.4.2",
    name: "Content Summarizer",
    status: "active",
    scopesGranted: ["data.read"],
    reputation: 95,
    totalRequests: 76_200,
    totalX402Paid: 228.60,
    rateLimit: { requests: 1000, window: "1h" },
    createdAt: "2026-01-12T16:30:00Z",
    lastAuthAt: "2026-02-08T12:05:19Z",
  },
  {
    id: "ag_5pQr1mZkW8",
    publicKey: "tG6hNbKx9J3vF7...",
    framework: "LangChain",
    version: "0.3.12",
    name: "Price Monitor Bot",
    status: "rate_limited",
    scopesGranted: ["data.read", "pricing.read"],
    reputation: 45,
    totalRequests: 234_100,
    totalX402Paid: 702.30,
    rateLimit: { requests: 1000, window: "1h" },
    createdAt: "2025-12-28T09:12:44Z",
    lastAuthAt: "2026-02-08T14:30:00Z",
  },
  {
    id: "ag_2jFt6vNcP3",
    publicKey: "wQ8rLdMp4K1xS9...",
    framework: "Custom",
    version: "1.0.0",
    name: "Webhook Relay",
    status: "active",
    scopesGranted: ["webhooks.send", "data.read"],
    reputation: 78,
    totalRequests: 42_890,
    totalX402Paid: 128.67,
    rateLimit: { requests: 500, window: "1h" },
    createdAt: "2026-01-20T14:08:22Z",
    lastAuthAt: "2026-02-07T23:55:10Z",
  },
  {
    id: "ag_7hDk3bGxL0",
    publicKey: "cV5nTzAw2E7yH3...",
    framework: "Virtuals",
    version: "2.1.0",
    name: "Trading Signal Agent",
    status: "suspended",
    scopesGranted: ["data.read", "trading.execute"],
    reputation: 22,
    totalRequests: 189_750,
    totalX402Paid: 1_423.50,
    rateLimit: { requests: 2000, window: "1h" },
    createdAt: "2025-12-15T06:30:00Z",
    lastAuthAt: "2026-02-05T18:42:33Z",
  },
  {
    id: "ag_4wRn9tYmK6",
    publicKey: "bX3qOeIu7P0zG1...",
    framework: "CrewAI",
    version: "0.40.0",
    name: "Report Generator",
    status: "active",
    scopesGranted: ["data.read", "analytics.read", "reports.write"],
    reputation: 85,
    totalRequests: 31_200,
    totalX402Paid: 93.60,
    rateLimit: { requests: 1000, window: "1h" },
    createdAt: "2026-01-25T10:15:00Z",
    lastAuthAt: "2026-02-08T09:30:00Z",
  },
  {
    id: "ag_6mBv0sXpJ2",
    publicKey: "fA8lWcQt6N4rD5...",
    framework: "LangGraph",
    version: "0.2.8",
    name: "Support Triage Bot",
    status: "active",
    scopesGranted: ["tickets.read", "tickets.write", "data.read"],
    reputation: 91,
    totalRequests: 67_800,
    totalX402Paid: 203.40,
    rateLimit: { requests: 2000, window: "1h" },
    createdAt: "2026-01-15T13:00:00Z",
    lastAuthAt: "2026-02-08T14:12:45Z",
  },
];

// ---------------------------------------------------------------------------
// Traffic Over Time (last 7 days)
// ---------------------------------------------------------------------------

export const trafficData: TrafficDataPoint[] = [
  { label: "Mon", agents: 3_420, humans: 5_820 },
  { label: "Tue", agents: 4_180, humans: 6_100 },
  { label: "Wed", agents: 3_950, humans: 5_600 },
  { label: "Thu", agents: 4_800, humans: 6_350 },
  { label: "Fri", agents: 5_200, humans: 6_900 },
  { label: "Sat", agents: 3_100, humans: 3_200 },
  { label: "Sun", agents: 2_800, humans: 2_450 },
];

// ---------------------------------------------------------------------------
// Revenue Over Time (last 6 months)
// ---------------------------------------------------------------------------

export const revenueData: RevenueDataPoint[] = [
  { label: "Sep", x402: 320, subscriptions: 180 },
  { label: "Oct", x402: 480, subscriptions: 220 },
  { label: "Nov", x402: 620, subscriptions: 310 },
  { label: "Dec", x402: 780, subscriptions: 390 },
  { label: "Jan", x402: 1_050, subscriptions: 520 },
  { label: "Feb", x402: 1_243, subscriptions: 680 },
];

// ---------------------------------------------------------------------------
// Framework Breakdown
// ---------------------------------------------------------------------------

export const frameworkBreakdown: FrameworkBreakdown[] = [
  { name: "LangChain", percentage: 38, count: 94 },
  { name: "CrewAI", percentage: 22, count: 54 },
  { name: "AutoGen", percentage: 15, count: 37 },
  { name: "Custom", percentage: 12, count: 30 },
  { name: "LangGraph", percentage: 8, count: 20 },
  { name: "Virtuals", percentage: 5, count: 12 },
];

// ---------------------------------------------------------------------------
// Scope Usage
// ---------------------------------------------------------------------------

export const scopeUsage: ScopeUsage[] = [
  { id: "data.read", description: "Read data", requestCount: 1_245_000 },
  { id: "data.write", description: "Write data", requestCount: 312_000 },
  { id: "analytics.read", description: "Read analytics", requestCount: 156_000 },
  { id: "search.execute", description: "Execute search", requestCount: 89_000 },
  { id: "reports.write", description: "Write reports", requestCount: 22_000 },
  { id: "webhooks.send", description: "Send webhooks", requestCount: 18_567 },
];

// ---------------------------------------------------------------------------
// Recent Rate Limit Events
// ---------------------------------------------------------------------------

export const rateLimitEvents: RateLimitEvent[] = [
  {
    agentId: "ag_5pQr1mZkW8",
    agentName: "Price Monitor Bot",
    timestamp: "2026-02-08T14:30:00Z",
    limitHit: "1000 req/1h",
    requestsAttempted: 1_247,
  },
  {
    agentId: "ag_5pQr1mZkW8",
    agentName: "Price Monitor Bot",
    timestamp: "2026-02-08T13:02:00Z",
    limitHit: "1000 req/1h",
    requestsAttempted: 1_102,
  },
  {
    agentId: "ag_3nLp7wDkS1",
    agentName: "Research Crawler",
    timestamp: "2026-02-07T22:15:00Z",
    limitHit: "2000 req/1h",
    requestsAttempted: 2_031,
  },
  {
    agentId: "ag_8kTm2xPqR4",
    agentName: "DataPipeline Agent",
    timestamp: "2026-02-06T03:45:00Z",
    limitHit: "5000 req/1h",
    requestsAttempted: 5_100,
  },
];
