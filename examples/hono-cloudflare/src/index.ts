import { Hono } from "hono";
import { createAgentGateMiddleware, type AgentGateVariables } from "@agentgate/hono";

type Bindings = {
  X402_WALLET: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: AgentGateVariables }>();

// --- AgentGate: 3 lines to make your Cloudflare Worker agent-ready ---
app.use(
  "/*",
  createAgentGateMiddleware({
    scopes: [
      {
        id: "stocks.read",
        description: "Read stock market data",
        price: "$0.005/req",
        rateLimit: "500/hour",
      },
      {
        id: "stocks.historical",
        description: "Historical stock data (up to 5 years)",
        price: "$0.05/req",
        rateLimit: "50/hour",
      },
    ],
    pricing: {
      "stocks.read": "$0.005/req",
      "stocks.historical": "$0.05/req",
    },
    rateLimit: { requests: 500, window: "1h" },
    x402: {
      network: "base",
      currency: "USDC",
      paymentAddress: "0xYourWalletAddress",
    },
  })
);
// --- That's it. Your Cloudflare Worker is now agent-ready. ---

// Sample stock data
const stocks: Record<string, { price: number; change: number; volume: number }> = {
  AAPL: { price: 198.5, change: 2.3, volume: 45_200_000 },
  GOOGL: { price: 175.2, change: -1.1, volume: 22_100_000 },
  MSFT: { price: 420.8, change: 5.6, volume: 18_900_000 },
  AMZN: { price: 205.4, change: 0.8, volume: 31_400_000 },
  TSLA: { price: 245.1, change: -3.2, volume: 52_700_000 },
};

// GET /api/stocks?symbol=AAPL
app.get("/api/stocks", (c) => {
  const symbol = c.req.query("symbol")?.toUpperCase();
  const isAgent = c.get("isAgent");
  const agent = c.get("agent");

  if (symbol) {
    const stock = stocks[symbol];
    if (!stock) {
      return c.json(
        { error: "Symbol not found", available: Object.keys(stocks) },
        404
      );
    }
    return c.json({
      symbol,
      ...stock,
      currency: "USD",
      timestamp: new Date().toISOString(),
      requestedBy: isAgent ? `agent:${agent?.id}` : "human",
    });
  }

  // Return all stocks
  return c.json({
    stocks: Object.entries(stocks).map(([symbol, data]) => ({
      symbol,
      ...data,
    })),
    timestamp: new Date().toISOString(),
    requestedBy: isAgent ? `agent:${agent?.id}` : "human",
  });
});

// GET /api/stocks/historical?symbol=AAPL&days=30
app.get("/api/stocks/historical", (c) => {
  const symbol = c.req.query("symbol")?.toUpperCase() || "AAPL";
  const days = Math.min(parseInt(c.req.query("days") || "30"), 365 * 5);
  const isAgent = c.get("isAgent");
  const agent = c.get("agent");

  const baseline = stocks[symbol];
  if (!baseline) {
    return c.json(
      { error: "Symbol not found", available: Object.keys(stocks) },
      404
    );
  }

  // Generate deterministic historical data
  const history = Array.from({ length: days }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (days - i));
    const variance = Math.sin(i * 0.5) * baseline.price * 0.05;
    return {
      date: date.toISOString().split("T")[0],
      open: +(baseline.price + variance - 1).toFixed(2),
      high: +(baseline.price + variance + 3).toFixed(2),
      low: +(baseline.price + variance - 4).toFixed(2),
      close: +(baseline.price + variance).toFixed(2),
      volume: Math.round(baseline.volume * (0.8 + Math.random() * 0.4)),
    };
  });

  return c.json({
    symbol,
    days,
    currency: "USD",
    history,
    generatedAt: new Date().toISOString(),
    requestedBy: isAgent ? `agent:${agent?.id}` : "human",
  });
});

// Health check (no auth required)
app.get("/health", (c) => {
  return c.json({ status: "ok", runtime: "cloudflare-workers" });
});

export default app;
