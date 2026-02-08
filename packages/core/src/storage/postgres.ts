/**
 * @agentgate/core - PostgreSQL Storage Implementation
 *
 * Uses the `pg` library for PostgreSQL access.
 * Suitable for multi-process production deployments.
 *
 * Installation:
 *   npm install pg
 *   npm install -D @types/pg
 *
 * Usage:
 *   import { PostgresStore } from "@agentgate/core/storage/postgres";
 *   const store = new PostgresStore("postgresql://user:pass@localhost/agentgate");
 *   await store.initialize(); // Creates tables if they don't exist
 */

import type { Agent, ChallengeData, AgentStatus } from "../types.js";
import type { AgentStore, CreateAgentInput, UpdateAgentInput } from "./interface.js";
import { AgentNotFoundError, DuplicateAgentError } from "../errors.js";
import { DEFAULT_REPUTATION, DEFAULT_AGENT_STATUS } from "../constants.js";

/** Row shape for the agents table in Postgres. */
interface AgentRow {
  id: string;
  public_key: string;
  x402_wallet: string | null;
  scopes_granted: string[];
  api_key_hash: string;
  rate_limit_requests: number;
  rate_limit_window: string;
  reputation: number;
  metadata: Record<string, string>;
  status: string;
  created_at: Date;
  last_auth_at: Date;
  total_requests: number;
  total_x402_paid: number;
}

/** Row shape for the challenges table in Postgres. */
interface ChallengeRow {
  agent_id: string;
  nonce: string;
  message: string;
  expires_at: Date;
  created_at: Date;
}

/**
 * Convert a Postgres agent row to an Agent object.
 */
function rowToAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    publicKey: row.public_key,
    x402Wallet: row.x402_wallet ?? undefined,
    scopesGranted: row.scopes_granted,
    apiKeyHash: row.api_key_hash,
    rateLimit: {
      requests: row.rate_limit_requests,
      window: row.rate_limit_window,
    },
    reputation: row.reputation,
    metadata: row.metadata,
    status: row.status as AgentStatus,
    createdAt: new Date(row.created_at),
    lastAuthAt: new Date(row.last_auth_at),
    totalRequests: row.total_requests,
    totalX402Paid: row.total_x402_paid,
  };
}

/**
 * Convert a Postgres challenge row to ChallengeData.
 */
function rowToChallenge(row: ChallengeRow): ChallengeData {
  return {
    agentId: row.agent_id,
    nonce: row.nonce,
    message: row.message,
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
  };
}

/**
 * A minimal interface for `pg.Pool` so that this module can work
 * without requiring `pg` as a compile-time dependency.
 */
interface PgPool {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  end(): Promise<void>;
}

/**
 * PostgreSQL implementation of AgentStore.
 *
 * Suitable for:
 * - Multi-process / clustered production deployments
 * - Serverless environments with connection pooling (Neon, Supabase)
 * - High-availability setups
 *
 * Requires `pg` package to be installed separately.
 */
export class PostgresStore implements AgentStore {
  private pool: PgPool;

  /**
   * Create a PostgresStore from a connection URL or an existing pg.Pool instance.
   *
   * @param poolOrUrl - Either a pg.Pool instance or a PostgreSQL connection URL
   */
  constructor(poolOrUrl: PgPool | string) {
    if (typeof poolOrUrl === "string") {
      // Dynamic import to make pg an optional dependency
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Pool } = require("pg") as { Pool: new (config: { connectionString: string }) => PgPool };
      this.pool = new Pool({ connectionString: poolOrUrl });
    } else {
      this.pool = poolOrUrl;
    }
  }

  /**
   * Create the required tables if they don't exist.
   * Must be called once before using the store.
   */
  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        public_key TEXT NOT NULL UNIQUE,
        x402_wallet TEXT,
        scopes_granted JSONB NOT NULL DEFAULT '[]',
        api_key_hash TEXT NOT NULL UNIQUE,
        rate_limit_requests INTEGER NOT NULL DEFAULT 1000,
        rate_limit_window TEXT NOT NULL DEFAULT '1h',
        reputation INTEGER NOT NULL DEFAULT 50,
        metadata JSONB NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_auth_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        total_requests INTEGER NOT NULL DEFAULT 0,
        total_x402_paid NUMERIC NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_agents_public_key ON agents(public_key);
      CREATE INDEX IF NOT EXISTS idx_agents_api_key_hash ON agents(api_key_hash);
      CREATE INDEX IF NOT EXISTS idx_agents_x402_wallet ON agents(x402_wallet);

      CREATE TABLE IF NOT EXISTS challenges (
        agent_id TEXT PRIMARY KEY,
        nonce TEXT NOT NULL,
        message TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_challenges_expires_at ON challenges(expires_at);
    `);
  }

  // -----------------------------------------------------------------------
  // Agent CRUD
  // -----------------------------------------------------------------------

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    const now = new Date();

    try {
      await this.pool.query(
        `INSERT INTO agents (id, public_key, x402_wallet, scopes_granted, api_key_hash,
          rate_limit_requests, rate_limit_window, reputation, metadata, status,
          created_at, last_auth_at, total_requests, total_x402_paid)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, 0)`,
        [
          input.id,
          input.publicKey,
          input.x402Wallet ?? null,
          JSON.stringify(input.scopesGranted),
          input.apiKeyHash,
          input.rateLimit.requests,
          input.rateLimit.window,
          DEFAULT_REPUTATION,
          JSON.stringify(input.metadata),
          DEFAULT_AGENT_STATUS,
          now.toISOString(),
          now.toISOString(),
        ],
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("duplicate key") || message.includes("unique constraint")) {
        if (message.includes("public_key")) {
          throw new DuplicateAgentError(
            `An agent with public key "${input.publicKey.substring(0, 16)}..." is already registered.`,
          );
        }
        throw new DuplicateAgentError(message);
      }
      throw err;
    }

    const result = await this.pool.query("SELECT * FROM agents WHERE id = $1", [input.id]);
    return rowToAgent(result.rows[0] as AgentRow);
  }

  async getAgent(id: string): Promise<Agent | null> {
    const result = await this.pool.query("SELECT * FROM agents WHERE id = $1", [id]);
    if (result.rows.length === 0) return null;
    return rowToAgent(result.rows[0] as AgentRow);
  }

  async getAgentByApiKeyHash(apiKeyHash: string): Promise<Agent | null> {
    const result = await this.pool.query("SELECT * FROM agents WHERE api_key_hash = $1", [apiKeyHash]);
    if (result.rows.length === 0) return null;
    return rowToAgent(result.rows[0] as AgentRow);
  }

  async getAgentByPublicKey(publicKey: string): Promise<Agent | null> {
    const result = await this.pool.query("SELECT * FROM agents WHERE public_key = $1", [publicKey]);
    if (result.rows.length === 0) return null;
    return rowToAgent(result.rows[0] as AgentRow);
  }

  async updateAgent(id: string, input: UpdateAgentInput): Promise<Agent> {
    // First check the agent exists
    const existing = await this.getAgent(id);
    if (!existing) {
      throw new AgentNotFoundError(`Agent "${id}" not found.`);
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.scopesGranted !== undefined) {
      setClauses.push(`scopes_granted = $${paramIndex++}`);
      values.push(JSON.stringify(input.scopesGranted));
    }
    if (input.rateLimit !== undefined) {
      setClauses.push(`rate_limit_requests = $${paramIndex++}`);
      values.push(input.rateLimit.requests);
      setClauses.push(`rate_limit_window = $${paramIndex++}`);
      values.push(input.rateLimit.window);
    }
    if (input.reputation !== undefined) {
      setClauses.push(`reputation = $${paramIndex++}`);
      values.push(input.reputation);
    }
    if (input.metadata !== undefined) {
      setClauses.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify({ ...existing.metadata, ...input.metadata }));
    }
    if (input.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      values.push(input.status);
    }
    if (input.lastAuthAt !== undefined) {
      setClauses.push(`last_auth_at = $${paramIndex++}`);
      values.push(input.lastAuthAt.toISOString());
    }
    if (input.incrementRequests !== undefined) {
      setClauses.push(`total_requests = total_requests + $${paramIndex++}`);
      values.push(input.incrementRequests);
    }
    if (input.incrementX402Paid !== undefined) {
      setClauses.push(`total_x402_paid = total_x402_paid + $${paramIndex++}`);
      values.push(input.incrementX402Paid);
    }

    if (setClauses.length > 0) {
      values.push(id);
      await this.pool.query(
        `UPDATE agents SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`,
        values,
      );
    }

    const result = await this.pool.query("SELECT * FROM agents WHERE id = $1", [id]);
    return rowToAgent(result.rows[0] as AgentRow);
  }

  async deleteAgent(id: string): Promise<boolean> {
    // Also clean up challenges
    await this.pool.query("DELETE FROM challenges WHERE agent_id = $1", [id]);
    const result = await this.pool.query("DELETE FROM agents WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  // -----------------------------------------------------------------------
  // Challenge Management
  // -----------------------------------------------------------------------

  async createChallenge(challenge: ChallengeData): Promise<void> {
    await this.pool.query(
      `INSERT INTO challenges (agent_id, nonce, message, expires_at, created_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (agent_id) DO UPDATE SET
        nonce = EXCLUDED.nonce,
        message = EXCLUDED.message,
        expires_at = EXCLUDED.expires_at,
        created_at = EXCLUDED.created_at`,
      [
        challenge.agentId,
        challenge.nonce,
        challenge.message,
        challenge.expiresAt.toISOString(),
        challenge.createdAt.toISOString(),
      ],
    );
  }

  async getChallenge(agentId: string): Promise<ChallengeData | null> {
    const result = await this.pool.query(
      "SELECT * FROM challenges WHERE agent_id = $1",
      [agentId],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0] as ChallengeRow;

    // Check if expired
    if (Date.now() > new Date(row.expires_at).getTime()) {
      await this.pool.query("DELETE FROM challenges WHERE agent_id = $1", [agentId]);
      return null;
    }

    return rowToChallenge(row);
  }

  async deleteChallenge(agentId: string): Promise<void> {
    await this.pool.query("DELETE FROM challenges WHERE agent_id = $1", [agentId]);
  }

  async cleanExpiredChallenges(): Promise<number> {
    const result = await this.pool.query(
      "DELETE FROM challenges WHERE expires_at < NOW()",
    );
    return result.rowCount ?? 0;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async close(): Promise<void> {
    await this.pool.end();
  }
}
