import express, { Request, Response, NextFunction } from "express";
import { agentDoor, AgentDoorRequest } from "@agentdoor/express";

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Parse JSON bodies
app.use(express.json());

// CORS headers
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-AgentDoor-Token"
  );
  next();
});

// AgentDoor middleware — handles agent discovery, authentication, and x402 payments
app.use(
  "/api",
  agentDoor({
    scopes: [
      { id: "data.read", description: "Read application data", price: "$0.001/req" },
      { id: "data.write", description: "Write application data", price: "$0.01/req" },
      { id: "admin", description: "Administrative operations", price: "$0.05/req" },
    ],
    service: {
      name: "Agent-Ready Express API",
      description: "Express API with AgentDoor authentication and x402 payments",
    },
    x402: {
      network: "base",
      currency: "USDC",
      paymentAddress: process.env.X402_WALLET || "0xYourWalletAddress",
    },
  })
);

// ---------------------------------------------------------------------------
// Sample data store (in-memory for demo purposes)
// ---------------------------------------------------------------------------

interface DataItem {
  id: string;
  name: string;
  value: number;
  createdAt: string;
}

const dataStore: DataItem[] = [
  { id: "1", name: "Item One", value: 100, createdAt: "2024-01-01T00:00:00Z" },
  { id: "2", name: "Item Two", value: 200, createdAt: "2024-01-02T00:00:00Z" },
  { id: "3", name: "Item Three", value: 300, createdAt: "2024-01-03T00:00:00Z" },
];

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Landing page — basic service info
 */
app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "Agent-Ready Express API",
    description: "Express API powered by AgentDoor + x402",
    discovery: "/.well-known/agentdoor",
    endpoints: {
      "GET /api/data": "Read all data (scope: data.read, $0.001/req)",
      "GET /api/data/:id": "Read single item (scope: data.read, $0.001/req)",
      "POST /api/data": "Create data (scope: data.write, $0.01/req)",
      "DELETE /api/data/:id": "Delete data (scope: admin, $0.05/req)",
      "GET /api/health": "Health check (no auth required)",
    },
  });
});

/**
 * GET /api/health — Health check (no scope required)
 */
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/data — List all data items (requires data.read scope)
 */
app.get("/api/data", (req: Request, res: Response) => {
  const agentReq = req as AgentDoorRequest;
  const agentId = agentReq.agentDoor?.agentId || "anonymous";
  const scopes = agentReq.agentDoor?.scopes || [];

  res.json({
    success: true,
    data: dataStore,
    meta: {
      total: dataStore.length,
      agent: agentId,
      scopes,
      timestamp: new Date().toISOString(),
    },
  });
});

/**
 * GET /api/data/:id — Get a single data item (requires data.read scope)
 */
app.get("/api/data/:id", (req: Request, res: Response) => {
  const agentReq = req as AgentDoorRequest;
  const agentId = agentReq.agentDoor?.agentId || "anonymous";

  const item = dataStore.find((d) => d.id === req.params.id);
  if (!item) {
    res.status(404).json({ success: false, error: "Item not found" });
    return;
  }

  res.json({
    success: true,
    data: item,
    meta: {
      agent: agentId,
      timestamp: new Date().toISOString(),
    },
  });
});

/**
 * POST /api/data — Create a new data item (requires data.write scope)
 */
app.post("/api/data", (req: Request, res: Response) => {
  const agentReq = req as AgentDoorRequest;
  const agentId = agentReq.agentDoor?.agentId || "anonymous";
  const scopes = agentReq.agentDoor?.scopes || [];

  if (!scopes.includes("data.write")) {
    res.status(403).json({
      success: false,
      error: "Insufficient scope: data.write required",
    });
    return;
  }

  const { name, value } = req.body;

  if (!name) {
    res.status(400).json({ success: false, error: "name is required" });
    return;
  }

  const newItem: DataItem = {
    id: String(dataStore.length + 1),
    name,
    value: value || 0,
    createdAt: new Date().toISOString(),
  };

  dataStore.push(newItem);

  res.status(201).json({
    success: true,
    data: newItem,
    meta: {
      agent: agentId,
      timestamp: new Date().toISOString(),
    },
  });
});

/**
 * DELETE /api/data/:id — Delete a data item (requires admin scope)
 */
app.delete("/api/data/:id", (req: Request, res: Response) => {
  const agentReq = req as AgentDoorRequest;
  const agentId = agentReq.agentDoor?.agentId || "anonymous";
  const scopes = agentReq.agentDoor?.scopes || [];

  if (!scopes.includes("admin")) {
    res.status(403).json({
      success: false,
      error: "Insufficient scope: admin required",
    });
    return;
  }

  const index = dataStore.findIndex((d) => d.id === req.params.id);
  if (index === -1) {
    res.status(404).json({ success: false, error: "Item not found" });
    return;
  }

  const deleted = dataStore.splice(index, 1)[0];

  res.json({
    success: true,
    data: deleted,
    meta: {
      agent: agentId,
      timestamp: new Date().toISOString(),
    },
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Agent-Ready Express API running on port ${PORT}`);
  console.log(`Discovery: http://localhost:${PORT}/.well-known/agentdoor`);
  console.log(`Health:    http://localhost:${PORT}/api/health`);
});

export default app;
