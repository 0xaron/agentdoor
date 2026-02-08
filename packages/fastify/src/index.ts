/**
 * @agentgate/fastify — Fastify plugin for AgentGate.
 *
 * Registers discovery, registration, verification, and auth routes as a
 * Fastify plugin with JSON schema validation. Decorates requests with
 * `agent` and `isAgent` properties for downstream handlers.
 *
 * @example
 * ```ts
 * import Fastify from "fastify";
 * import { agentgatePlugin } from "@agentgate/fastify";
 *
 * const app = Fastify();
 *
 * app.register(agentgatePlugin, {
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

export { agentgatePlugin } from "./plugin.js";
export type { AgentGateFastifyConfig } from "./plugin.js";
