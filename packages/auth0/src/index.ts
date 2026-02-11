/**
 * @agentdoor/auth0 - Auth0 Companion Plugin for AgentDoor
 *
 * Bridges AgentDoor with Auth0 by registering agents as M2M clients.
 * Agent accounts appear in the Auth0 dashboard with special metadata
 * to distinguish them from human users.
 */

export { Auth0Companion } from "./companion.js";

export type {
  Auth0CompanionConfig,
  Auth0ClientInterface,
  Auth0SyncResult,
} from "./companion.js";
