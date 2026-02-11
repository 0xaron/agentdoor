import express from "express";
import { agentdoor } from "@agentdoor/express";

const app = express();
app.use(express.json());

// --- AgentDoor: 3 lines to make your API agent-ready ---
app.use(
  agentdoor({
    scopes: [
      {
        id: "weather.read",
        description: "Read current weather data",
        price: "$0.001/req",
        rateLimit: "1000/hour",
      },
      {
        id: "weather.forecast",
        description: "7-day weather forecasts",
        price: "$0.01/req",
        rateLimit: "100/hour",
      },
    ],
    pricing: {
      "weather.read": "$0.001/req",
      "weather.forecast": "$0.01/req",
    },
    rateLimit: { default: "1000/hour" },
    x402: {
      network: "base",
      currency: "USDC",
      paymentAddress: process.env.X402_WALLET || "0xYourWalletAddress",
    },
  })
);
// --- That's it. Your API is now agent-ready. ---
// AgentDoor automatically:
//   - Serves /.well-known/agentdoor.json (discovery)
//   - Mounts /agentdoor/register + /agentdoor/register/verify (registration)
//   - Mounts /agentdoor/auth (returning agents)
//   - Applies auth middleware to all routes (sets req.agent, req.isAgent)

// Sample weather data
const weatherData: Record<string, { temp: number; condition: string; humidity: number }> = {
  "san-francisco": { temp: 62, condition: "foggy", humidity: 78 },
  "new-york": { temp: 45, condition: "cloudy", humidity: 65 },
  "austin": { temp: 75, condition: "sunny", humidity: 40 },
  "london": { temp: 50, condition: "rainy", humidity: 85 },
  "tokyo": { temp: 55, condition: "clear", humidity: 55 },
};

// GET /api/weather?city=san-francisco
app.get("/api/weather", (req, res) => {
  const city = (req.query.city as string) || "san-francisco";
  const data = weatherData[city];

  if (!data) {
    res.status(404).json({
      error: "City not found",
      available: Object.keys(weatherData),
    });
    return;
  }

  // Both humans and agents get the same response.
  // req.isAgent is true when the request comes from a registered agent.
  if (req.isAgent) {
    console.log(`Agent ${req.agent!.id} requested weather for ${city}`);
  }

  res.json({
    city,
    ...data,
    unit: "fahrenheit",
    timestamp: new Date().toISOString(),
    requestedBy: req.isAgent ? `agent:${req.agent!.id}` : "human",
  });
});

// GET /api/forecast?city=san-francisco&days=7
app.get("/api/forecast", (req, res) => {
  const city = (req.query.city as string) || "san-francisco";
  const days = Math.min(parseInt(req.query.days as string) || 7, 14);
  const baseline = weatherData[city];

  if (!baseline) {
    res.status(404).json({
      error: "City not found",
      available: Object.keys(weatherData),
    });
    return;
  }

  if (req.isAgent) {
    console.log(
      `Agent ${req.agent!.id} requested ${days}-day forecast for ${city}`
    );
  }

  // Generate a simple deterministic forecast from baseline data
  const conditions = ["sunny", "cloudy", "rainy", "clear", "foggy"];
  const forecast = Array.from({ length: days }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i + 1);
    return {
      date: date.toISOString().split("T")[0],
      high: baseline.temp + Math.round(Math.sin(i) * 8),
      low: baseline.temp - 10 + Math.round(Math.cos(i) * 5),
      condition: conditions[(i + city.length) % conditions.length],
      humidity: baseline.humidity + Math.round(Math.sin(i * 2) * 10),
    };
  });

  res.json({
    city,
    days,
    unit: "fahrenheit",
    forecast,
    generatedAt: new Date().toISOString(),
    requestedBy: req.isAgent ? `agent:${req.agent!.id}` : "human",
  });
});

const PORT = parseInt(process.env.PORT || "3000", 10);
app.listen(PORT, () => {
  console.log(`Weather API running on http://localhost:${PORT}`);
  console.log(`Discovery: http://localhost:${PORT}/.well-known/agentdoor.json`);
  console.log(`Register:  POST http://localhost:${PORT}/agentdoor/register`);
  console.log(`Weather:   http://localhost:${PORT}/api/weather?city=san-francisco`);
  console.log(`Forecast:  http://localhost:${PORT}/api/forecast?city=austin&days=5`);
});
