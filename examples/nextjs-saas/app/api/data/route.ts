import { NextRequest, NextResponse } from "next/server";

// Sample SaaS data endpoint.
// AgentDoor middleware has already run by the time this handler executes.
// req.isAgent tells you whether the caller is a registered agent.

const sampleData = [
  { id: 1, name: "Project Alpha", status: "active", revenue: 12400 },
  { id: 2, name: "Project Beta", status: "active", revenue: 8900 },
  { id: 3, name: "Project Gamma", status: "paused", revenue: 3200 },
];

export async function GET(req: NextRequest) {
  // AgentDoor sets these headers after middleware validation
  const isAgent = req.headers.get("x-agentdoor-is-agent") === "true";
  const agentId = req.headers.get("x-agentdoor-agent-id");

  // Both agents and humans hit the same endpoint.
  // You can customize responses based on the caller type if needed.
  const response = {
    data: sampleData,
    meta: {
      total: sampleData.length,
      timestamp: new Date().toISOString(),
      caller: isAgent ? `agent:${agentId}` : "human",
    },
  };

  // Agents might get a more structured, machine-friendly response
  if (isAgent) {
    return NextResponse.json({
      ...response,
      meta: {
        ...response.meta,
        schema: "https://api.example.com/schemas/projects/v1",
        pagination: { page: 1, perPage: 50, total: sampleData.length },
      },
    });
  }

  return NextResponse.json(response);
}

export async function POST(req: NextRequest) {
  const isAgent = req.headers.get("x-agentdoor-is-agent") === "true";
  const agentId = req.headers.get("x-agentdoor-agent-id");

  const body = await req.json();

  if (!body.name) {
    return NextResponse.json(
      { error: "Missing required field: name" },
      { status: 400 }
    );
  }

  const newItem = {
    id: sampleData.length + 1,
    name: body.name,
    status: body.status || "active",
    revenue: 0,
    createdBy: isAgent ? `agent:${agentId}` : "human",
    createdAt: new Date().toISOString(),
  };

  return NextResponse.json(
    { data: newItem, message: "Created successfully" },
    { status: 201 }
  );
}
