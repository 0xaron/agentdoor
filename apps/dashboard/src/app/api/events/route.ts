/**
 * Dashboard API - Events Endpoint
 *
 * GET /api/events
 * Returns recent webhook events for the event log.
 *
 * Query params:
 * - type: Filter by event type (agent.registered, agent.authenticated, etc.)
 * - limit: Max number of results
 */

import { NextResponse } from "next/server";
import type { ApiResponse, WebhookEventRecord } from "@/lib/types";

/** Mock events data for P1 dashboard. */
const mockEvents: WebhookEventRecord[] = [
  {
    id: "evt_001",
    type: "agent.registered",
    agentId: "ag_datapipeline_001",
    timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    delivered: true,
    payload: { scopes_granted: ["data.read", "data.write"] },
  },
  {
    id: "evt_002",
    type: "agent.authenticated",
    agentId: "ag_researcher_002",
    timestamp: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    delivered: true,
    payload: { method: "challenge" },
  },
  {
    id: "evt_003",
    type: "agent.rate_limited",
    agentId: "ag_pricemonitor_004",
    timestamp: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    delivered: true,
    payload: { limit: 1000, window: "1h", retry_after_seconds: 120 },
  },
  {
    id: "evt_004",
    type: "agent.flagged",
    agentId: "ag_tradingsignal_006",
    timestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    delivered: true,
    payload: { reason: "Low reputation", reputation_score: 22 },
  },
  {
    id: "evt_005",
    type: "agent.spending_cap_warning",
    agentId: "ag_datapipeline_001",
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    delivered: true,
    payload: { current_spend: 8.5, cap_amount: 10, period: "daily" },
  },
  {
    id: "evt_006",
    type: "agent.registered",
    agentId: "ag_support_008",
    timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    delivered: true,
    payload: { scopes_granted: ["data.read", "analytics.read"] },
  },
  {
    id: "evt_007",
    type: "agent.authenticated",
    agentId: "ag_content_003",
    timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    delivered: false,
    payload: { method: "jwt" },
  },
  {
    id: "evt_008",
    type: "agent.suspended",
    agentId: "ag_tradingsignal_006",
    timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    delivered: true,
    payload: { reason: "Reputation below threshold", reputation_score: 10 },
  },
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  try {
    let events = [...mockEvents];

    // Filter by type
    if (type) {
      events = events.filter((e) => e.type === type);
    }

    // Limit
    events = events.slice(0, limit);

    return NextResponse.json({
      success: true,
      data: events,
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse<WebhookEventRecord[]>);
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
