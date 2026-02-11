/**
 * @agentdoor/hono — Hono middleware for AgentDoor.
 *
 * Works on Cloudflare Workers, Deno, Bun, and Node.js.
 *
 * @example Route mounting (recommended)
 * ```ts
 * import { Hono } from "hono";
 * import { agentdoor, type AgentDoorVariables } from "@agentdoor/hono";
 *
 * const app = new Hono<{ Variables: AgentDoorVariables }>();
 *
 * agentdoor(app, {
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
 * import { createAgentDoorMiddleware } from "@agentdoor/hono";
 *
 * const app = new Hono();
 * app.use("*", createAgentDoorMiddleware({
 *   scopes: [{ id: "data.read", description: "Read data" }],
 * }));
 * ```
 */

export {
  agentdoor,
  createAgentDoorMiddleware,
  createAuthGuardMiddleware,
  buildDiscoveryDocument,
} from "./middleware.js";

export type {
  AgentDoorVariables,
  AgentDoorHonoConfig,
} from "./middleware.js";
