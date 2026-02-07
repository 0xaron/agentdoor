import { AgentGate } from "@agentgate/sdk";

/**
 * AgentGate SDK example — connect to any AgentGate-enabled service.
 *
 * The SDK handles the full agent lifecycle:
 *   1. Discovery  — fetches /.well-known/agentgate.json
 *   2. Register   — sends public key, receives challenge nonce
 *   3. Verify     — signs the challenge, receives API key + JWT
 *   4. Request    — makes authenticated (and optionally paid) API calls
 *   5. Cache      — credentials are cached locally for reuse
 */

async function main() {
  // Initialize the agent with a keypair.
  // If no keyPath is provided, an ephemeral keypair is generated.
  // For persistent agents, point keyPath to a file — the SDK will
  // auto-generate keys on first run and reuse them on subsequent runs.
  const agent = new AgentGate({
    keyPath: "./agent-keys.json",
    // Optional: use your x402 wallet as your agent identity.
    // This lets you authenticate AND pay with the same wallet.
    // x402Wallet: "0x1234...abcd",
  });

  // ---------------------------------------------------------------
  // Connect to a weather API
  // ---------------------------------------------------------------
  // agent.connect() performs the full discovery -> register -> verify
  // flow in a single call. If credentials are cached from a previous
  // run, registration is skipped entirely.
  const weatherApi = await agent.connect("http://localhost:3000");

  console.log("Connected to Weather API");
  console.log("  Agent ID:", weatherApi.agentId);
  console.log("  Scopes:", weatherApi.scopes);
  console.log("  Rate limit:", weatherApi.rateLimit);
  console.log();

  // Make authenticated requests using the session object.
  // The SDK automatically attaches the Authorization header.
  const weather = await weatherApi.get("/api/weather", {
    params: { city: "san-francisco" },
  });
  console.log("Current weather in San Francisco:");
  console.log(JSON.stringify(weather.data, null, 2));
  console.log();

  // Request a forecast — the SDK handles auth on every request.
  const forecast = await weatherApi.get("/api/forecast", {
    params: { city: "austin", days: "5" },
  });
  console.log("5-day forecast for Austin:");
  console.log(JSON.stringify(forecast.data, null, 2));
  console.log();

  // ---------------------------------------------------------------
  // Connect to a second service (credentials cached separately)
  // ---------------------------------------------------------------
  // Each service gets its own discovery, registration, and credentials.
  // The agent's keypair is shared, but API keys are per-service.
  //
  // Uncomment the block below if you have a second service running:
  //
  // const stockApi = await agent.connect("http://localhost:3001");
  // console.log("Connected to Stock API");
  // console.log("  Agent ID:", stockApi.agentId);
  //
  // const stocks = await stockApi.get("/api/stocks", {
  //   params: { symbol: "AAPL" },
  // });
  // console.log("AAPL:", JSON.stringify(stocks.data, null, 2));

  // ---------------------------------------------------------------
  // Making a paid request with x402
  // ---------------------------------------------------------------
  // If the service supports x402 payments and the agent has a wallet
  // configured, pass x402: true to automatically attach a payment
  // header to the request.
  //
  // const paidData = await weatherApi.get("/api/forecast", {
  //   params: { city: "tokyo", days: "14" },
  //   x402: true, // auto-attach x402 payment header
  // });

  // ---------------------------------------------------------------
  // Session info and credential management
  // ---------------------------------------------------------------
  console.log("Session details:");
  console.log("  Service:", weatherApi.serviceUrl);
  console.log("  Agent ID:", weatherApi.agentId);
  console.log("  Scopes:", weatherApi.scopes.join(", "));
  console.log("  Credentials cached at:", agent.credentialsCachePath);
  console.log();
  console.log(
    "Next run will reuse cached credentials — no re-registration needed."
  );
}

main().catch((error) => {
  console.error("Agent error:", error.message);
  process.exit(1);
});
