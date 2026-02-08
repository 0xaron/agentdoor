/**
 * Shared AgentStore Instance
 *
 * Provides a singleton MemoryStore instance backed by @agentgate/core.
 * Seeds mock data on first access so the dashboard has meaningful content
 * even when no real agents have registered yet.
 *
 * In production, swap MemoryStore for SQLiteStore or PostgresStore.
 */

import { MemoryStore } from "@agentgate/core";
import type { Agent } from "@agentgate/core";
import { agents as mockAgents } from "./mock-data";

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _store: MemoryStore | null = null;
let _seeded = false;

/**
 * Return the shared MemoryStore singleton.
 * Lazily created on first call and seeded with mock data when empty.
 */
export function getStore(): MemoryStore {
  if (!_store) {
    _store = new MemoryStore();
  }
  return _store;
}

/**
 * Seed the store with mock agent data if it has not been seeded yet.
 * This preserves mock data as a fallback when no real agents exist.
 */
export async function ensureSeeded(): Promise<void> {
  if (_seeded) return;

  const store = getStore();

  // Only seed if the store is empty
  if (store.agentCount > 0) {
    _seeded = true;
    return;
  }

  for (const mock of mockAgents) {
    try {
      const agent = await store.createAgent({
        id: mock.id,
        publicKey: mock.publicKey,
        scopesGranted: [...mock.scopesGranted],
        apiKeyHash: `hash_${mock.id}`,
        rateLimit: { ...mock.rateLimit },
        metadata: {
          name: mock.name,
          framework: mock.framework,
          version: mock.version,
        },
      });

      // Apply additional fields that createAgent doesn't set directly
      await store.updateAgent(agent.id, {
        reputation: mock.reputation,
        status: mock.status === "rate_limited" ? "active" : mock.status,
        lastAuthAt: new Date(mock.lastAuthAt),
        incrementRequests: mock.totalRequests,
        incrementX402Paid: mock.totalX402Paid,
      });
    } catch {
      // Ignore duplicate errors during re-seed attempts
    }
  }

  _seeded = true;
}

/**
 * Helper to retrieve all agents from the store as DashboardAgent-compatible
 * objects. Returns agents from the real store, seeding mock data if empty.
 */
export async function getAllAgentsFromStore(): Promise<Agent[]> {
  await ensureSeeded();
  const store = getStore();
  return store.getAllAgents();
}
