/**
 * @agentgate/supabase - SQL Migrations
 *
 * SQL statements for creating the AgentGate agents table
 * and Row Level Security (RLS) policies in Supabase.
 */

/** SQL to create the agentgate_agents table. */
export const AGENT_TABLE_SQL = `
-- AgentGate Agents Table
-- Stores agent registration data synced from AgentGate
CREATE TABLE IF NOT EXISTS agentgate_agents (
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
CREATE INDEX IF NOT EXISTS idx_agentgate_agents_public_key
  ON agentgate_agents (public_key);

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_agentgate_agents_status
  ON agentgate_agents (status);

-- Index for reputation queries
CREATE INDEX IF NOT EXISTS idx_agentgate_agents_reputation
  ON agentgate_agents (reputation);
`;

/** SQL to create RLS policies for the agentgate_agents table. */
export const AGENT_RLS_SQL = `
-- Enable Row Level Security
ALTER TABLE agentgate_agents ENABLE ROW LEVEL SECURITY;

-- Policy: Agents can read their own record
CREATE POLICY "Agents can read own record"
  ON agentgate_agents
  FOR SELECT
  USING (
    id = current_setting('request.jwt.claims', true)::jsonb->>'agent_id'
  );

-- Policy: Service role can do everything (for admin operations)
CREATE POLICY "Service role full access"
  ON agentgate_agents
  FOR ALL
  USING (
    current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
  );

-- Policy: Authenticated users can read active agents (for discovery)
CREATE POLICY "Authenticated users can read active agents"
  ON agentgate_agents
  FOR SELECT
  USING (
    status = 'active'
    AND auth.role() = 'authenticated'
  );
`;
