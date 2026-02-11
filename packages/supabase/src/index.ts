/**
 * @agentdoor/supabase - Supabase Plugin for AgentDoor
 *
 * Stores agent records in Supabase with Row Level Security (RLS) support.
 * Agents get entries in the Supabase auth.users table, making them compatible
 * with existing Supabase RLS policies.
 *
 * P1 Feature: Supabase Plugin
 */

export { SupabasePlugin } from "./plugin.js";

export type {
  SupabasePluginConfig,
  SupabaseAgentRecord,
  SupabaseSyncResult,
  SupabaseClientInterface,
} from "./plugin.js";

export { AGENT_TABLE_SQL, AGENT_RLS_SQL } from "./sql.js";
