/**
 * @agentdoor/firebase - Firebase Companion Plugin for AgentDoor
 *
 * Creates agent accounts as Firebase Auth users with custom claims
 * that identify them as agents and encode their scopes and wallet info.
 */

export { FirebaseCompanion } from "./companion.js";

export type {
  FirebaseCompanionConfig,
  FirebaseAdminInterface,
  FirebaseSyncResult,
} from "./companion.js";
