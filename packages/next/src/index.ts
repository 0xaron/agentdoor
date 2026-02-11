/**
 * @agentdoor/next — Next.js adapter for AgentDoor.
 *
 * Provides edge middleware and App Router route handlers for agent
 * discovery, registration, authentication, and auth verification.
 *
 * @example Edge Middleware (middleware.ts)
 * ```ts
 * import { createAgentDoorMiddleware } from "@agentdoor/next";
 *
 * export default createAgentDoorMiddleware({
 *   scopes: [{ id: "data.read", description: "Read data" }],
 *   pricing: { "data.read": "$0.001/req" },
 * });
 *
 * export const config = { matcher: ["/(.*)" ] };
 * ```
 *
 * @example App Router Route Handlers
 * ```ts
 * // app/.well-known/agentdoor.json/route.ts
 * import { createDiscoveryHandler } from "@agentdoor/next";
 * import config from "../../agentdoor.config";
 *
 * export const GET = createDiscoveryHandler(config);
 * ```
 */

export {
  createAgentDoorMiddleware,
  buildDiscoveryDocument,
} from "./middleware.js";

export type { AgentDoorNextConfig } from "./middleware.js";

export {
  createRouteHandlers,
  createDiscoveryHandler,
  createRegisterHandler,
  createVerifyHandler,
  createAuthHandler,
  getAgentContext,
} from "./route-handlers.js";

export type { RouteHandlers } from "./route-handlers.js";
