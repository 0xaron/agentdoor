/**
 * Dashboard API - Stats Endpoint
 *
 * GET /api/stats
 * Returns overview statistics for the dashboard.
 *
 * Query params:
 * - section: "traffic" | "revenue" | "frameworks" | "scopes" | "rate-limits"
 *            Default: overview stats
 *
 * In production, this would query the AgentStore.
 * For now, returns data from the mock data source.
 */

import { NextResponse } from "next/server";
import {
  overviewStats,
  trafficData,
  revenueData,
  frameworkBreakdown,
  scopeUsage,
  rateLimitEvents,
} from "@/lib/mock-data";
import type {
  ApiResponse,
  DashboardStats,
  TrafficDataPoint,
  RevenueDataPoint,
  FrameworkBreakdown,
  ScopeUsage,
  RateLimitEvent,
} from "@/lib/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const section = searchParams.get("section");

  try {
    if (section === "traffic") {
      const data: TrafficDataPoint[] = trafficData.map((d) => ({
        date: d.label,
        agentRequests: d.agents,
        humanRequests: d.humans,
      }));
      return NextResponse.json({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      } satisfies ApiResponse<TrafficDataPoint[]>);
    }

    if (section === "revenue") {
      const data: RevenueDataPoint[] = revenueData.map((d) => ({
        month: d.label,
        x402Revenue: d.x402,
        subscriptionRevenue: d.subscriptions,
      }));
      return NextResponse.json({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      } satisfies ApiResponse<RevenueDataPoint[]>);
    }

    if (section === "frameworks") {
      const data: FrameworkBreakdown[] = frameworkBreakdown.map((f) => ({
        framework: f.name,
        count: f.count,
        percent: f.percentage,
      }));
      return NextResponse.json({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      } satisfies ApiResponse<FrameworkBreakdown[]>);
    }

    if (section === "scopes") {
      const data: ScopeUsage[] = scopeUsage.map((s) => ({
        scopeId: s.id,
        description: s.description,
        requestCount: s.requestCount,
        uniqueAgents: 0, // Not in mock data
      }));
      return NextResponse.json({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      } satisfies ApiResponse<ScopeUsage[]>);
    }

    if (section === "rate-limits") {
      const data: RateLimitEvent[] = rateLimitEvents.map((e, i) => ({
        id: `rle_${i}`,
        agentId: e.agentId,
        timestamp: e.timestamp,
        limit: e.requestsAttempted,
        window: e.limitHit,
        endpoint: "/api/data",
      }));
      return NextResponse.json({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      } satisfies ApiResponse<RateLimitEvent[]>);
    }

    // Default: return overview stats
    const stats: DashboardStats = {
      totalAgents: overviewStats.totalAgents,
      activeAgents: overviewStats.activeAgents,
      suspendedAgents: overviewStats.totalAgents - overviewStats.activeAgents,
      totalRequests: overviewStats.totalRequests,
      requestsToday: overviewStats.requestsToday,
      totalRevenue: overviewStats.totalRevenue,
      revenueThisMonth: overviewStats.revenueThisMonth,
      agentTrafficPercent: overviewStats.agentTrafficPercent,
      averageReputation: overviewStats.avgReputation,
    };

    return NextResponse.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse<DashboardStats>);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
        timestamp: new Date().toISOString(),
      } satisfies ApiResponse<never>,
      { status: 500 },
    );
  }
}
