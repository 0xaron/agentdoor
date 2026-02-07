/**
 * @agentgate/express - Express.js middleware adapter for AgentGate
 *
 * Make your Express API agent-ready in 3 lines of code:
 *
 * ```typescript
 * import express from "express";
 * import { agentgate } from "@agentgate/express";
 *
 * const app = express();
 * app.use(agentgate({
 *   scopes: [{ id: "data.read", description: "Read data" }],
 * }));
 *
 * app.get("/api/data", (req, res) => {
 *   if (req.isAgent) {
 *     console.log(`Agent ${req.agent.id} with scopes: ${req.agent.scopes}`);
 *   }
 *   res.json({ data: "hello" });
 * });
 *
 * app.listen(3000);
 * ```
 */

// Main factory function
export { agentgate } from "./middleware.js";
export type { AgentGateExpressOptions } from "./middleware.js";

// Route creators (for advanced usage / custom mounting)
export { createDiscoveryRouter } from "./routes/discovery.js";
export { createRegisterRouter } from "./routes/register.js";
export { createAuthRouter } from "./routes/auth.js";
export { createHealthRouter } from "./routes/health.js";

// Auth guard middleware (for standalone use)
export { createAuthGuard } from "./auth-guard.js";

// Re-export commonly used types from core so consumers
// don't need to separately install @agentgate/core for types
export type {
  AgentGateConfig,
  AgentContext,
  Agent,
  ScopeDefinition,
  X402Config,
  RateLimitConfig,
  AgentStore,
} from "@agentgate/core";
