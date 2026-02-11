/**
 * @agentdoor/next-auth - NextAuth.js Companion Plugin for AgentDoor
 *
 * Adds an "agent" provider to NextAuth.js so that AgentDoor agents
 * can authenticate through the standard NextAuth flow.
 */

export { NextAuthCompanion } from "./companion.js";

export type {
  NextAuthAgentConfig,
  NextAuthProviderResult,
  NextAuthAgentUser,
  NextAuthAgentSession,
} from "./companion.js";
