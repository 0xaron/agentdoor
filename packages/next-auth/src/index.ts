/**
 * @agentgate/next-auth - NextAuth.js Companion Plugin for AgentGate
 *
 * Adds an "agent" provider to NextAuth.js so that AgentGate agents
 * can authenticate through the standard NextAuth flow.
 */

export { NextAuthCompanion } from "./companion.js";

export type {
  NextAuthAgentConfig,
  NextAuthProviderResult,
  NextAuthAgentUser,
  NextAuthAgentSession,
} from "./companion.js";
