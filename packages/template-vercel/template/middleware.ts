import { createAgentGateMiddleware } from "@agentgate/next";

export default createAgentGateMiddleware({
  scopes: [
    { id: "data.read", description: "Read application data", price: "$0.001/req" },
    { id: "data.write", description: "Write application data", price: "$0.01/req" },
  ],
  service: {
    name: "My Agent-Ready API",
    description: "API with AgentGate authentication",
  },
  x402: {
    network: "base",
    currency: "USDC",
    paymentAddress: process.env.X402_WALLET || "0xYourWalletAddress",
  },
});

export const config = {
  matcher: ["/api/:path*", "/.well-known/:path*", "/agentgate/:path*"],
};
