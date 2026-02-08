/**
 * @agentgate/cloudflare — Cloudflare Workers adapter for AgentGate.
 *
 * Provides a fetch handler for Cloudflare Workers and a Durable Object class
 * for persistent agent state. Falls back to in-memory Maps when Durable
 * Objects are not available.
 *
 * @example Basic Worker
 * ```ts
 * import { createAgentGateWorker } from "@agentgate/cloudflare";
 *
 * const handler = createAgentGateWorker({
 *   scopes: [{ id: "data.read", description: "Read data" }],
 * });
 *
 * export default {
 *   fetch: handler,
 * };
 * ```
 *
 * @example With Durable Objects
 * ```ts
 * import { createAgentGateWorker, AgentGateDurableObject } from "@agentgate/cloudflare";
 *
 * export { AgentGateDurableObject };
 *
 * export default {
 *   fetch(request, env) {
 *     return handleRequest(request, env, {
 *       scopes: [{ id: "data.read", description: "Read data" }],
 *     });
 *   },
 * };
 * ```
 */

export {
  createAgentGateWorker,
  handleRequest,
  AgentGateDurableObject,
} from "./worker.js";

export type { AgentGateCloudflareConfig, CloudflareEnv } from "./worker.js";
