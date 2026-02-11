/**
 * @agentdoor/fastify — Fastify plugin for AgentDoor.
 *
 * Registers discovery, registration, verification, and auth routes as a
 * Fastify plugin with JSON schema validation. Decorates requests with
 * `agent` and `isAgent` properties for downstream handlers.
 *
 * @example
 * ```ts
 * import Fastify from "fastify";
 * import { agentdoorPlugin } from "@agentdoor/fastify";
 *
 * const app = Fastify();
 *
 * app.register(agentdoorPlugin, {
 *   scopes: [{ id: "data.read", description: "Read data" }],
 *   pricing: { "data.read": "$0.001/req" },
 * });
 *
 * app.get("/api/data", async (request, reply) => {
 *   if (request.isAgent) {
 *     return { agentId: request.agent?.id };
 *   }
 *   return { data: "hello" };
 * });
 *
 * await app.listen({ port: 3000 });
 * ```
 */

export { agentdoorPlugin } from "./plugin.js";
export type { AgentDoorFastifyConfig } from "./plugin.js";
