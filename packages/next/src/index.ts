/**
 * @agentgate/next — Next.js adapter for AgentGate.
 *
 * Provides edge middleware and App Router route handlers for agent
 * discovery, registration, authentication, and auth verification.
 *
 * @example Edge Middleware (middleware.ts)
 * ```ts
 * import { createAgentGateMiddleware } from "@agentgate/next";
 *
 * export default createAgentGateMiddleware({
 *   scopes: [{ id: "data.read", description: "Read data" }],
 *   pricing: { "data.read": "$0.001/req" },
 * });
 *
 * export const config = { matcher: ["/(.*)" ] };
 * ```
 *
 * @example App Router Route Handlers
 * ```ts
 * // app/.well-known/agentgate.json/route.ts
 * import { createDiscoveryHandler } from "@agentgate/next";
 * import config from "../../agentgate.config";
 *
 * export const GET = createDiscoveryHandler(config);
 * ```
 */

export {
  createAgentGateMiddleware,
  buildDiscoveryDocument,
} from "./middleware.js";

export type { AgentGateNextConfig } from "./middleware.js";

export {
  createRouteHandlers,
  createDiscoveryHandler,
  createRegisterHandler,
  createVerifyHandler,
  createAuthHandler,
  getAgentContext,
} from "./route-handlers.js";

export type { RouteHandlers } from "./route-handlers.js";
