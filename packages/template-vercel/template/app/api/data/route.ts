import { NextRequest, NextResponse } from "next/server";

/**
 * Sample data store (in-memory for demo purposes).
 * Replace with your actual database or data source.
 */
const sampleData = [
  { id: "1", name: "Item One", value: 100, createdAt: "2024-01-01T00:00:00Z" },
  { id: "2", name: "Item Two", value: 200, createdAt: "2024-01-02T00:00:00Z" },
  { id: "3", name: "Item Three", value: 300, createdAt: "2024-01-03T00:00:00Z" },
];

/**
 * GET /api/data
 *
 * Returns application data. Requires the "data.read" scope.
 * AgentGate middleware validates authentication and payment before
 * this handler is reached.
 */
export async function GET(request: NextRequest) {
  // The AgentGate middleware has already validated the agent's credentials
  // and x402 payment. The agent context is available in the headers.
  const agentId = request.headers.get("x-agentgate-agent-id");
  const scopes = request.headers.get("x-agentgate-scopes");

  return NextResponse.json({
    success: true,
    data: sampleData,
    meta: {
      total: sampleData.length,
      agent: agentId || "anonymous",
      scopes: scopes ? scopes.split(",") : [],
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * POST /api/data
 *
 * Creates new data. Requires the "data.write" scope.
 * AgentGate middleware validates authentication and payment before
 * this handler is reached.
 */
export async function POST(request: NextRequest) {
  const agentId = request.headers.get("x-agentgate-agent-id");
  const scopes = request.headers.get("x-agentgate-scopes");

  // Verify the agent has write scope
  const grantedScopes = scopes ? scopes.split(",") : [];
  if (!grantedScopes.includes("data.write")) {
    return NextResponse.json(
      { success: false, error: "Insufficient scope: data.write required" },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();

    const newItem = {
      id: String(sampleData.length + 1),
      name: body.name || "Unnamed",
      value: body.value || 0,
      createdAt: new Date().toISOString(),
    };

    // In a real app, persist to database
    sampleData.push(newItem);

    return NextResponse.json({
      success: true,
      data: newItem,
      meta: {
        agent: agentId || "anonymous",
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }
}
