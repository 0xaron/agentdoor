/**
 * @agentdoor/cloudflare — Cloudflare Workers adapter for AgentDoor.
 *
 * Provides a fetch handler for Cloudflare Workers and a Durable Object class
 * for persistent agent state. Falls back to in-memory Maps when Durable
 * Objects are not available.
 *
 * @example Basic Worker
 * ```ts
 * import { createAgentDoorWorker } from "@agentdoor/cloudflare";
 *
 * const handler = createAgentDoorWorker({
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
 * import { createAgentDoorWorker, AgentDoorDurableObject } from "@agentdoor/cloudflare";
 *
 * export { AgentDoorDurableObject };
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
  createAgentDoorWorker,
  handleRequest,
  AgentDoorDurableObject,
} from "./worker.js";

export type { AgentDoorCloudflareConfig, CloudflareEnv } from "./worker.js";
