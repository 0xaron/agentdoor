/**
 * @agentgate/core - SQLite Storage Implementation
 *
 * Uses better-sqlite3 for synchronous, high-performance SQLite access.
 * Suitable for single-process production deployments.
 *
 * Installation:
 *   npm install better-sqlite3
 *   npm install -D @types/better-sqlite3
 *
 * Usage:
 *   import { SQLiteStore } from "@agentgate/core/storage/sqlite";
 *   const store = new SQLiteStore("./agentgate.db");
 */

import type { Agent, ChallengeData, AgentStatus } from "../types.js";
import type { AgentStore, CreateAgentInput, UpdateAgentInput } from "./interface.js";
import { AgentNotFoundError, DuplicateAgentError } from "../errors.js";
import { DEFAULT_REPUTATION, DEFAULT_AGENT_STATUS } from "../constants.js";

/** Row shape for the agents table in SQLite. */
interface AgentRow {
  id: string;
  public_key: string;
  x402_wallet: string | null;
  scopes_granted: string; // JSON array
  api_key_hash: string;
  rate_limit_requests: number;
  rate_limit_window: string;
  reputation: number;
  metadata: string; // JSON object
  status: string;
  created_at: string; // ISO-8601
  last_auth_at: string; // ISO-8601
  total_requests: number;
  total_x402_paid: number;
}

/** Row shape for the challenges table in SQLite. */
interface ChallengeRow {
  agent_id: string;
  nonce: string;
  message: string;
  expires_at: string; // ISO-8601
  created_at: string; // ISO-8601
}

/**
 * Convert a SQLite agent row to an Agent object.
 */
function rowToAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    publicKey: row.public_key,
    x402Wallet: row.x402_wallet ?? undefined,
    scopesGranted: JSON.parse(row.scopes_granted) as string[],
    apiKeyHash: row.api_key_hash,
    rateLimit: {
      requests: row.rate_limit_requests,
      window: row.rate_limit_window,
    },
    reputation: row.reputation,
    metadata: JSON.parse(row.metadata) as Record<string, string>,
    status: row.status as AgentStatus,
    createdAt: new Date(row.created_at),
    lastAuthAt: new Date(row.last_auth_at),
    totalRequests: row.total_requests,
    totalX402Paid: row.total_x402_paid,
  };
}

/**
 * Convert a SQLite challenge row to ChallengeData.
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
 * SQLite implementation of AgentStore using better-sqlite3.
 *
 * Suitable for:
 * - Single-process production deployments
 * - Edge/embedded environments
 * - Local-first applications
 *
 * NOT suitable for:
 * - Multi-process / clustered deployments (use Postgres instead)
 * - Serverless environments with ephemeral storage
 */
export class SQLiteStore implements AgentStore {
  private db: import("better-sqlite3").Database;

  constructor(dbPath: string = ":memory:") {
    // Dynamic import to make better-sqlite3 an optional dependency
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    this.db = new Database(dbPath);

    // Enable WAL mode for better concurrent read performance
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    this.initializeTables();
  }

  /**
   * Create the required tables if they don't exist.
   */
  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        public_key TEXT NOT NULL UNIQUE,
        x402_wallet TEXT,
        scopes_granted TEXT NOT NULL DEFAULT '[]',
        api_key_hash TEXT NOT NULL UNIQUE,
        rate_limit_requests INTEGER NOT NULL DEFAULT 1000,
        rate_limit_window TEXT NOT NULL DEFAULT '1h',
        reputation INTEGER NOT NULL DEFAULT 50,
        metadata TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        last_auth_at TEXT NOT NULL,
        total_requests INTEGER NOT NULL DEFAULT 0,
        total_x402_paid REAL NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_agents_public_key ON agents(public_key);
      CREATE INDEX IF NOT EXISTS idx_agents_api_key_hash ON agents(api_key_hash);
      CREATE INDEX IF NOT EXISTS idx_agents_x402_wallet ON agents(x402_wallet);

      CREATE TABLE IF NOT EXISTS challenges (
        agent_id TEXT PRIMARY KEY,
        nonce TEXT NOT NULL,
        message TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_challenges_expires_at ON challenges(expires_at);
    `);
  }

  // -----------------------------------------------------------------------
  // Agent CRUD
  // -----------------------------------------------------------------------

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    const now = new Date().toISOString();

    try {
      this.db.prepare(`
        INSERT INTO agents (id, public_key, x402_wallet, scopes_granted, api_key_hash,
          rate_limit_requests, rate_limit_window, reputation, metadata, status,
          created_at, last_auth_at, total_requests, total_x402_paid)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
      `).run(
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
        now,
        now,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("UNIQUE constraint failed")) {
        if (message.includes("public_key")) {
          throw new DuplicateAgentError(
            `An agent with public key "${input.publicKey.substring(0, 16)}..." is already registered.`,
          );
        }
        throw new DuplicateAgentError(message);
      }
      throw err;
    }

    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(input.id) as AgentRow;
    return rowToAgent(row);
  }

  async getAgent(id: string): Promise<Agent | null> {
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
    return row ? rowToAgent(row) : null;
  }

  async getAgentByApiKeyHash(apiKeyHash: string): Promise<Agent | null> {
    const row = this.db.prepare("SELECT * FROM agents WHERE api_key_hash = ?").get(apiKeyHash) as AgentRow | undefined;
    return row ? rowToAgent(row) : null;
  }

  async getAgentByPublicKey(publicKey: string): Promise<Agent | null> {
    const row = this.db.prepare("SELECT * FROM agents WHERE public_key = ?").get(publicKey) as AgentRow | undefined;
    return row ? rowToAgent(row) : null;
  }

  async updateAgent(id: string, input: UpdateAgentInput): Promise<Agent> {
    const existing = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
    if (!existing) {
      throw new AgentNotFoundError(`Agent "${id}" not found.`);
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.scopesGranted !== undefined) {
      updates.push("scopes_granted = ?");
      values.push(JSON.stringify(input.scopesGranted));
    }
    if (input.rateLimit !== undefined) {
      updates.push("rate_limit_requests = ?, rate_limit_window = ?");
      values.push(input.rateLimit.requests, input.rateLimit.window);
    }
    if (input.reputation !== undefined) {
      updates.push("reputation = ?");
      values.push(input.reputation);
    }
    if (input.metadata !== undefined) {
      const existingMetadata = JSON.parse(existing.metadata) as Record<string, string>;
      updates.push("metadata = ?");
      values.push(JSON.stringify({ ...existingMetadata, ...input.metadata }));
    }
    if (input.status !== undefined) {
      updates.push("status = ?");
      values.push(input.status);
    }
    if (input.lastAuthAt !== undefined) {
      updates.push("last_auth_at = ?");
      values.push(input.lastAuthAt.toISOString());
    }
    if (input.incrementRequests !== undefined) {
      updates.push("total_requests = total_requests + ?");
      values.push(input.incrementRequests);
    }
    if (input.incrementX402Paid !== undefined) {
      updates.push("total_x402_paid = total_x402_paid + ?");
      values.push(input.incrementX402Paid);
    }

    if (updates.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE agents SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    }

    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow;
    return rowToAgent(row);
  }

  async deleteAgent(id: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
    // Also clean up challenges
    this.db.prepare("DELETE FROM challenges WHERE agent_id = ?").run(id);
    return result.changes > 0;
  }

  // -----------------------------------------------------------------------
  // Challenge Management
  // -----------------------------------------------------------------------

  async createChallenge(challenge: ChallengeData): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO challenges (agent_id, nonce, message, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      challenge.agentId,
      challenge.nonce,
      challenge.message,
      challenge.expiresAt.toISOString(),
      challenge.createdAt.toISOString(),
    );
  }

  async getChallenge(agentId: string): Promise<ChallengeData | null> {
    const row = this.db.prepare("SELECT * FROM challenges WHERE agent_id = ?").get(agentId) as ChallengeRow | undefined;
    if (!row) return null;

    // Check if expired
    if (Date.now() > new Date(row.expires_at).getTime()) {
      this.db.prepare("DELETE FROM challenges WHERE agent_id = ?").run(agentId);
      return null;
    }

    return rowToChallenge(row);
  }

  async deleteChallenge(agentId: string): Promise<void> {
    this.db.prepare("DELETE FROM challenges WHERE agent_id = ?").run(agentId);
  }

  async cleanExpiredChallenges(): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db.prepare("DELETE FROM challenges WHERE expires_at < ?").run(now);
    return result.changes;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async close(): Promise<void> {
    this.db.close();
  }
}
