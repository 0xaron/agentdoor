/**
 * @agentdoor/supabase - SQL Migrations
 *
 * SQL statements for creating the AgentDoor agents table
 * and Row Level Security (RLS) policies in Supabase.
 */

/** SQL to create the agentdoor_agents table. */
export const AGENT_TABLE_SQL = `
-- AgentDoor Agents Table
-- Stores agent registration data synced from AgentDoor
CREATE TABLE IF NOT EXISTS agentdoor_agents (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL UNIQUE,
  scopes_granted JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  reputation INTEGER NOT NULL DEFAULT 50,
  x402_wallet TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick lookups by public key
CREATE INDEX IF NOT EXISTS idx_agentdoor_agents_public_key
  ON agentdoor_agents (public_key);

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_agentdoor_agents_status
  ON agentdoor_agents (status);

-- Index for reputation queries
CREATE INDEX IF NOT EXISTS idx_agentdoor_agents_reputation
  ON agentdoor_agents (reputation);
`;

/** SQL to create RLS policies for the agentdoor_agents table. */
export const AGENT_RLS_SQL = `
-- Enable Row Level Security
ALTER TABLE agentdoor_agents ENABLE ROW LEVEL SECURITY;

-- Policy: Agents can read their own record
CREATE POLICY "Agents can read own record"
  ON agentdoor_agents
  FOR SELECT
  USING (
    id = current_setting('request.jwt.claims', true)::jsonb->>'agent_id'
  );

-- Policy: Service role can do everything (for admin operations)
CREATE POLICY "Service role full access"
  ON agentdoor_agents
  FOR ALL
  USING (
    current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
  );

-- Policy: Authenticated users can read active agents (for discovery)
CREATE POLICY "Authenticated users can read active agents"
  ON agentdoor_agents
  FOR SELECT
  USING (
    status = 'active'
    AND auth.role() = 'authenticated'
  );
`;
