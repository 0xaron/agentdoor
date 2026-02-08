/**
 * @agentgate/vercel — Vercel Edge middleware for AgentGate.
 *
 * Uses standard Web APIs (Request/Response) for maximum compatibility with
 * Vercel's Edge Runtime. No framework-specific dependencies required.
 *
 * @example
 * ```ts
 * // middleware.ts (at project root)
 * import { createEdgeMiddleware } from "@agentgate/vercel";
 *
 * const middleware = createEdgeMiddleware({
 *   scopes: [{ id: "data.read", description: "Read data" }],
 *   pricing: { "data.read": "$0.001/req" },
 * });
 *
 * export default async function (request: Request) {
 *   return middleware(request);
 * }
 *
 * export const config = { matcher: ["/(.*)" ] };
 * ```
 */

export { createEdgeMiddleware } from "./middleware.js";
export type { AgentGateVercelConfig } from "./middleware.js";
