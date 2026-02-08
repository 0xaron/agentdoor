/**
 * Dashboard API - Events Endpoint
 *
 * GET /api/events
 * Returns recent webhook events for the event log.
 *
 * Query params:
 * - type: Filter by event type (agent.registered, agent.authenticated, etc.)
 * - limit: Max number of results
 *
 * Phase 3.1: Generates events from the real AgentStore. Falls back to mock
 * events when the store contains no agents.
 */

import { NextResponse } from "next/server";
import { getAllAgentsFromStore } from "@/lib/store";
import type { ApiResponse, WebhookEventRecord } from "@/lib/types";

/** Static fallback events for when the store is empty. */
const fallbackEvents: WebhookEventRecord[] = [
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
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  try {
    const agents = await getAllAgentsFromStore();
    let events: WebhookEventRecord[];

    if (agents.length > 0) {
      // Generate events from real store data
      events = [];
      let evtIdx = 0;

      for (const agent of agents) {
        const createdAt = agent.createdAt instanceof Date
          ? agent.createdAt.toISOString()
          : String(agent.createdAt);
        const lastAuth = agent.lastAuthAt instanceof Date
          ? agent.lastAuthAt.toISOString()
          : String(agent.lastAuthAt);

        // Registration event
        events.push({
          id: `evt_${String(evtIdx++).padStart(3, "0")}`,
          type: "agent.registered",
          agentId: agent.id,
          timestamp: createdAt,
          delivered: true,
          payload: {
            scopes_granted: agent.scopesGranted,
            framework: agent.metadata.framework || "unknown",
          },
        });

        // Authentication event (most recent)
        events.push({
          id: `evt_${String(evtIdx++).padStart(3, "0")}`,
          type: "agent.authenticated",
          agentId: agent.id,
          timestamp: lastAuth,
          delivered: true,
          payload: { method: "challenge" },
        });

        // Flag / suspend events based on status
        if (agent.status === "suspended") {
          events.push({
            id: `evt_${String(evtIdx++).padStart(3, "0")}`,
            type: "agent.suspended",
            agentId: agent.id,
            timestamp: lastAuth,
            delivered: true,
            payload: {
              reason: "Reputation below threshold",
              reputation_score: agent.reputation,
            },
          });
        } else if (agent.reputation < 40) {
          events.push({
            id: `evt_${String(evtIdx++).padStart(3, "0")}`,
            type: "agent.flagged",
            agentId: agent.id,
            timestamp: lastAuth,
            delivered: true,
            payload: {
              reason: "Low reputation",
              reputation_score: agent.reputation,
            },
          });
        }
      }

      // Sort by timestamp descending (most recent first)
      events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } else {
      events = [...fallbackEvents];
    }

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
