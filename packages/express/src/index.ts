/**
 * @agentdoor/express - Express.js middleware adapter for AgentDoor
 *
 * Make your Express API agent-ready in 3 lines of code:
 *
 * ```typescript
 * import express from "express";
 * import { agentdoor } from "@agentdoor/express";
 *
 * const app = express();
 * app.use(agentdoor({
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
export { agentdoor } from "./middleware.js";
export type { AgentDoorExpressOptions } from "./middleware.js";

// Route creators (for advanced usage / custom mounting)
export { createDiscoveryRouter } from "./routes/discovery.js";
export { createRegisterRouter } from "./routes/register.js";
export { createAuthRouter } from "./routes/auth.js";
export { createHealthRouter } from "./routes/health.js";

// Auth guard middleware (for standalone use)
export { createAuthGuard } from "./auth-guard.js";

// Re-export commonly used types from core so consumers
// don't need to separately install @agentdoor/core for types
export type {
  AgentDoorConfig,
  AgentContext,
  Agent,
  ScopeDefinition,
  X402Config,
  RateLimitConfig,
  AgentStore,
  ResolvedConfig,
} from "@agentdoor/core";
