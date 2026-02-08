/**
 * Dashboard API - Stats Endpoint
 *
 * GET /api/stats
 * Returns overview statistics for the dashboard.
 *
 * Query params:
 * - section: "traffic" | "revenue" | "frameworks" | "scopes" | "rate-limits" | "registrations"
 *            Default: overview stats
 *
 * Phase 3.1: Reads from real MemoryStore (seeded with mock data as fallback).
 * Sections like traffic and revenue still use mock time-series data since the
 * AgentStore does not track per-request logs. Overview stats are computed live.
 */

import { NextResponse } from "next/server";
import { getAllAgentsFromStore } from "@/lib/store";
import {
  trafficData,
  revenueData,
  frameworkBreakdown as mockFrameworkBreakdown,
  scopeUsage as mockScopeUsage,
  rateLimitEvents as mockRateLimitEvents,
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

/** Registrations-per-day data point returned by section=registrations. */
interface RegistrationDataPoint {
  date: string;
  count: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const section = searchParams.get("section");

  try {
    // -----------------------------------------------------------------------
    // Section: traffic (time-series mock data)
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // Section: revenue (time-series mock data)
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // Section: frameworks (computed from store, fallback to mock)
    // -----------------------------------------------------------------------
    if (section === "frameworks") {
      const agents = await getAllAgentsFromStore();
      let data: FrameworkBreakdown[];

      if (agents.length > 0) {
        const frameworkCounts: Record<string, number> = {};
        for (const a of agents) {
          const fw = a.metadata.framework || "Unknown";
          frameworkCounts[fw] = (frameworkCounts[fw] || 0) + 1;
        }
        const total = agents.length;
        data = Object.entries(frameworkCounts)
          .map(([framework, count]) => ({
            framework,
            count,
            percent: Math.round((count / total) * 100),
          }))
          .sort((a, b) => b.count - a.count);
      } else {
        data = mockFrameworkBreakdown.map((f) => ({
          framework: f.name,
          count: f.count,
          percent: f.percentage,
        }));
      }

      return NextResponse.json({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      } satisfies ApiResponse<FrameworkBreakdown[]>);
    }

    // -----------------------------------------------------------------------
    // Section: scopes (computed from store, fallback to mock)
    // -----------------------------------------------------------------------
    if (section === "scopes") {
      const agents = await getAllAgentsFromStore();
      let data: ScopeUsage[];

      if (agents.length > 0) {
        const scopeCounts: Record<string, { count: number; agents: Set<string> }> = {};
        for (const a of agents) {
          for (const scope of a.scopesGranted) {
            if (!scopeCounts[scope]) {
              scopeCounts[scope] = { count: 0, agents: new Set() };
            }
            scopeCounts[scope].count += a.totalRequests;
            scopeCounts[scope].agents.add(a.id);
          }
        }
        data = Object.entries(scopeCounts)
          .map(([scopeId, info]) => ({
            scopeId,
            description: scopeId.replace(/\./g, " "),
            requestCount: info.count,
            uniqueAgents: info.agents.size,
          }))
          .sort((a, b) => b.requestCount - a.requestCount);
      } else {
        data = mockScopeUsage.map((s) => ({
          scopeId: s.id,
          description: s.description,
          requestCount: s.requestCount,
          uniqueAgents: 0,
        }));
      }

      return NextResponse.json({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      } satisfies ApiResponse<ScopeUsage[]>);
    }

    // -----------------------------------------------------------------------
    // Section: rate-limits (mock data)
    // -----------------------------------------------------------------------
    if (section === "rate-limits") {
      const data: RateLimitEvent[] = mockRateLimitEvents.map((e, i) => ({
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

    // -----------------------------------------------------------------------
    // Section: registrations (per-day agent registrations, computed from store)
    // -----------------------------------------------------------------------
    if (section === "registrations") {
      const agents = await getAllAgentsFromStore();
      const dayCounts: Record<string, number> = {};

      for (const a of agents) {
        const created = a.createdAt instanceof Date ? a.createdAt : new Date(String(a.createdAt));
        const dayKey = created.toISOString().slice(0, 10); // YYYY-MM-DD
        dayCounts[dayKey] = (dayCounts[dayKey] || 0) + 1;
      }

      const data: RegistrationDataPoint[] = Object.entries(dayCounts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count }));

      return NextResponse.json({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      } satisfies ApiResponse<RegistrationDataPoint[]>);
    }

    // -----------------------------------------------------------------------
    // Default: overview stats (computed from store)
    // -----------------------------------------------------------------------
    const agents = await getAllAgentsFromStore();
    const totalAgents = agents.length;
    const activeAgents = agents.filter((a) => a.status === "active").length;
    const totalRequests = agents.reduce((s, a) => s + a.totalRequests, 0);
    const totalRevenue = agents.reduce((s, a) => s + a.totalX402Paid, 0);
    const avgReputation =
      totalAgents > 0
        ? Math.round(agents.reduce((s, a) => s + a.reputation, 0) / totalAgents)
        : 0;

    // Count today's registrations
    const todayStr = new Date().toISOString().slice(0, 10);
    const requestsToday = agents
      .filter((a) => {
        const created = a.createdAt instanceof Date ? a.createdAt : new Date(String(a.createdAt));
        return created.toISOString().slice(0, 10) === todayStr;
      })
      .reduce((s, a) => s + a.totalRequests, 0);

    const stats: DashboardStats = {
      totalAgents,
      activeAgents,
      suspendedAgents: totalAgents - activeAgents,
      totalRequests,
      requestsToday,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      revenueThisMonth: Math.round(totalRevenue * 0.26 * 100) / 100, // Approximate
      agentTrafficPercent: totalRequests > 0 ? 38 : 0, // Would come from request log in production
      averageReputation: avgReputation,
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
