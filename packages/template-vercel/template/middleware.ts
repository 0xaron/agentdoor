import { createAgentDoorMiddleware } from "@agentdoor/next";

export default createAgentDoorMiddleware({
  scopes: [
    { id: "data.read", description: "Read application data", price: "$0.001/req" },
    { id: "data.write", description: "Write application data", price: "$0.01/req" },
  ],
  service: {
    name: "My Agent-Ready API",
    description: "API with AgentDoor authentication",
  },
  x402: {
    network: "base",
    currency: "USDC",
    paymentAddress: process.env.X402_WALLET || "0xYourWalletAddress",
  },
});

export const config = {
  matcher: ["/api/:path*", "/.well-known/:path*", "/agentdoor/:path*"],
};
