import { createAgentGateMiddleware } from "@agentgate/next";

// AgentGate Next.js middleware — 3 lines to make your SaaS agent-ready.
//
// This middleware intercepts all API route requests and:
//   1. Serves /.well-known/agentgate.json for agent discovery
//   2. Handles /agentgate/register and /agentgate/register/verify for agent onboarding
//   3. Handles /agentgate/auth for returning agents
//   4. Validates agent credentials on protected /api/* routes
//   5. Sets req.isAgent and req.agent on incoming requests
//
// Human traffic passes through unaffected. Agents get full self-service onboarding.

export default createAgentGateMiddleware({
  scopes: [
    {
      id: "data.read",
      description: "Read application data",
      price: "$0.001/req",
      rateLimit: "1000/hour",
    },
    {
      id: "data.write",
      description: "Write application data",
      price: "$0.01/req",
      rateLimit: "100/hour",
    },
  ],
  pricing: {
    "data.read": "$0.001/req",
    "data.write": "$0.01/req",
  },
  rateLimit: { requests: 1000, window: "1h" },
  x402: {
    network: "base",
    currency: "USDC",
    paymentAddress: process.env.X402_WALLET || "0xYourWalletAddress",
  },
});

// Apply AgentGate middleware to all API routes and well-known paths
export const config = {
  matcher: ["/api/:path*", "/.well-known/:path*", "/agentgate/:path*"],
};
