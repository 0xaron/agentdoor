/**
 * @agentgate/hono — Hono middleware for AgentGate.
 *
 * Works on Cloudflare Workers, Deno, Bun, and Node.js.
 *
 * @example Route mounting (recommended)
 * ```ts
 * import { Hono } from "hono";
 * import { agentgate, type AgentGateVariables } from "@agentgate/hono";
 *
 * const app = new Hono<{ Variables: AgentGateVariables }>();
 *
 * agentgate(app, {
 *   scopes: [{ id: "data.read", description: "Read data" }],
 *   pricing: { "data.read": "$0.001/req" },
 * });
 *
 * app.get("/api/data", (c) => {
 *   if (c.get("isAgent")) {
 *     const agent = c.get("agent");
 *     return c.json({ agentId: agent?.id });
 *   }
 *   return c.json({ data: "hello" });
 * });
 *
 * export default app;
 * ```
 *
 * @example Standalone middleware
 * ```ts
 * import { Hono } from "hono";
 * import { createAgentGateMiddleware } from "@agentgate/hono";
 *
 * const app = new Hono();
 * app.use("*", createAgentGateMiddleware({
 *   scopes: [{ id: "data.read", description: "Read data" }],
 * }));
 * ```
 */

export {
  agentgate,
  createAgentGateMiddleware,
  createAuthGuardMiddleware,
  buildDiscoveryDocument,
} from "./middleware.js";

export type {
  AgentGateVariables,
  AgentGateHonoConfig,
} from "./middleware.js";
