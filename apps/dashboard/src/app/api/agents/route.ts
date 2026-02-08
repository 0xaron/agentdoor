/**
 * Dashboard API - Agents Endpoint
 *
 * GET /api/agents
 * Returns list of registered agents with optional filtering.
 *
 * Query params:
 * - status: Filter by status (active, suspended, rate_limited)
 * - sort: Sort field (requests, revenue, reputation, created)
 * - order: Sort order (asc, desc)
 * - limit: Max number of results
 * - offset: Pagination offset
 *
 * Phase 3.1: Reads from real MemoryStore (seeded with mock data as fallback).
 */

import { NextResponse } from "next/server";
import { getAllAgentsFromStore } from "@/lib/store";
import type { ApiResponse, DashboardAgent } from "@/lib/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const sort = searchParams.get("sort") || "requests";
  const order = searchParams.get("order") || "desc";
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  try {
    const storeAgents = await getAllAgentsFromStore();

    let agentList: DashboardAgent[] = storeAgents.map((a) => ({
      id: a.id,
      publicKey: a.publicKey,
      status: a.status,
      scopesGranted: a.scopesGranted,
      reputation: a.reputation,
      totalRequests: a.totalRequests,
      totalRevenue: a.totalX402Paid,
      framework: a.metadata.framework,
      lastActiveAt: a.lastAuthAt instanceof Date ? a.lastAuthAt.toISOString() : String(a.lastAuthAt),
      createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
      metadata: a.metadata,
    }));

    // Filter by status
    if (status) {
      agentList = agentList.filter((a) => a.status === status);
    }

    // Sort
    agentList.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      switch (sort) {
        case "revenue":
          aVal = a.totalRevenue;
          bVal = b.totalRevenue;
          break;
        case "reputation":
          aVal = a.reputation;
          bVal = b.reputation;
          break;
        case "created":
          aVal = a.createdAt;
          bVal = b.createdAt;
          break;
        case "requests":
        default:
          aVal = a.totalRequests;
          bVal = b.totalRequests;
          break;
      }

      if (typeof aVal === "string" && typeof bVal === "string") {
        return order === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return order === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });

    // Paginate
    const total = agentList.length;
    agentList = agentList.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      data: {
        agents: agentList,
        total,
        limit,
        offset,
      },
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse<{ agents: DashboardAgent[]; total: number; limit: number; offset: number }>);
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
