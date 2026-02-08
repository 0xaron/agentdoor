/**
 * @agentgate/clerk - Clerk Companion Plugin for AgentGate
 *
 * Syncs agent registrations to Clerk so agent accounts appear
 * in the Clerk dashboard alongside human users. Supports webhook
 * synchronization for bi-directional data flow.
 *
 * P1 Feature: Clerk Companion Plugin
 */

export { ClerkCompanion } from "./companion.js";

export type {
  ClerkCompanionConfig,
  ClerkUserMapping,
  ClerkSyncResult,
  ClerkClientInterface,
} from "./companion.js";
