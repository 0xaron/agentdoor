import { Hono } from "hono";
import { cors } from "hono/cors";
import { agentGate } from "@agentgate/hono";

/**
 * Environment bindings for Cloudflare Workers.
 */
type Bindings = {
  X402_WALLET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Enable CORS for all routes
app.use("*", cors());

// AgentGate middleware — handles agent discovery, authentication, and x402 payments
app.use(
  "/api/*",
  agentGate({
    scopes: [
      { id: "data.read", description: "Read worker data", price: "$0.001/req" },
      { id: "data.write", description: "Write worker data", price: "$0.01/req" },
      { id: "compute", description: "Run computations", price: "$0.005/req" },
    ],
    service: {
      name: "Agent-Ready Worker",
      description: "Cloudflare Worker with AgentGate authentication and x402 payments",
    },
    x402: {
      network: "base",
      currency: "USDC",
      paymentAddress: (c) => c.env.X402_WALLET || "0xYourWalletAddress",
    },
  })
);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Landing page
 */
app.get("/", (c) => {
  return c.json({
    name: "Agent-Ready Worker",
    description: "Cloudflare Worker powered by AgentGate + x402",
    discovery: "/.well-known/agentgate",
    endpoints: {
      "GET /api/data": "Read data (scope: data.read, $0.001/req)",
      "POST /api/data": "Write data (scope: data.write, $0.01/req)",
      "POST /api/compute": "Run computation (scope: compute, $0.005/req)",
    },
  });
});

/**
 * Sample in-memory data store.
 * Replace with KV, D1, or any other Cloudflare storage in production.
 */
const sampleData = [
  { id: "1", name: "Item One", value: 100, createdAt: "2024-01-01T00:00:00Z" },
  { id: "2", name: "Item Two", value: 200, createdAt: "2024-01-02T00:00:00Z" },
  { id: "3", name: "Item Three", value: 300, createdAt: "2024-01-03T00:00:00Z" },
];

/**
 * GET /api/data — Read data (requires data.read scope)
 */
app.get("/api/data", (c) => {
  const agentId = c.req.header("x-agentgate-agent-id") || "anonymous";
  const scopes = c.req.header("x-agentgate-scopes") || "";

  return c.json({
    success: true,
    data: sampleData,
    meta: {
      total: sampleData.length,
      agent: agentId,
      scopes: scopes ? scopes.split(",") : [],
      timestamp: new Date().toISOString(),
    },
  });
});

/**
 * POST /api/data — Create data (requires data.write scope)
 */
app.post("/api/data", async (c) => {
  const agentId = c.req.header("x-agentgate-agent-id") || "anonymous";
  const scopes = c.req.header("x-agentgate-scopes") || "";

  const grantedScopes = scopes ? scopes.split(",") : [];
  if (!grantedScopes.includes("data.write")) {
    return c.json(
      { success: false, error: "Insufficient scope: data.write required" },
      403
    );
  }

  try {
    const body = await c.req.json();

    const newItem = {
      id: String(sampleData.length + 1),
      name: body.name || "Unnamed",
      value: body.value || 0,
      createdAt: new Date().toISOString(),
    };

    sampleData.push(newItem);

    return c.json({
      success: true,
      data: newItem,
      meta: {
        agent: agentId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }
});

/**
 * POST /api/compute — Run a computation (requires compute scope)
 */
app.post("/api/compute", async (c) => {
  const agentId = c.req.header("x-agentgate-agent-id") || "anonymous";
  const scopes = c.req.header("x-agentgate-scopes") || "";

  const grantedScopes = scopes ? scopes.split(",") : [];
  if (!grantedScopes.includes("compute")) {
    return c.json(
      { success: false, error: "Insufficient scope: compute required" },
      403
    );
  }

  try {
    const body = await c.req.json();
    const { operation, values } = body;

    let result: number;

    switch (operation) {
      case "sum":
        result = (values as number[]).reduce((a: number, b: number) => a + b, 0);
        break;
      case "average":
        result =
          (values as number[]).reduce((a: number, b: number) => a + b, 0) /
          (values as number[]).length;
        break;
      case "max":
        result = Math.max(...(values as number[]));
        break;
      case "min":
        result = Math.min(...(values as number[]));
        break;
      default:
        return c.json(
          {
            success: false,
            error: `Unknown operation: ${operation}. Supported: sum, average, max, min`,
          },
          400
        );
    }

    return c.json({
      success: true,
      result,
      meta: {
        operation,
        inputCount: (values as number[]).length,
        agent: agentId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }
});

export default app;
