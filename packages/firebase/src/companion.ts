/**
 * @agentgate/firebase - Firebase Companion
 *
 * Creates and manages Firebase Auth user records for AgentGate agents.
 * Each agent gets a Firebase user with custom claims that encode
 * their agent identity, scopes, and wallet information.
 */

import type { Agent } from "@agentgate/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the Firebase companion plugin. */
export interface FirebaseCompanionConfig {
  /** Firebase project ID */
  projectId: string;
  /** Path to the service account key JSON (optional if using ADC) */
  serviceAccountKey?: string;
  /** Prefix for custom claims keys. Default: "agentgate_" */
  customClaimsPrefix?: string;
}

/** Interface for Firebase Admin Auth operations. */
export interface FirebaseAdminInterface {
  createUser(data: Record<string, unknown>): Promise<{ uid: string }>;
  updateUser(uid: string, data: Record<string, unknown>): Promise<void>;
  deleteUser(uid: string): Promise<void>;
  getUser(uid: string): Promise<Record<string, unknown> | null>;
  setCustomUserClaims(uid: string, claims: Record<string, unknown>): Promise<void>;
}

/** Result of a Firebase sync operation. */
export interface FirebaseSyncResult {
  /** Firebase user UID for the synced agent */
  firebaseUid: string;
  /** AgentGate agent ID */
  agentId: string;
  /** Whether the sync succeeded */
  synced: boolean;
  /** Custom claims set on the Firebase user */
  customClaims: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// FirebaseCompanion Class
// ---------------------------------------------------------------------------

/**
 * Firebase companion plugin for AgentGate.
 *
 * When agents register through AgentGate, this plugin automatically
 * creates corresponding Firebase Auth user records with custom claims.
 * Custom claims include: `{ is_agent: true, agent_id, scopes, wallet }`.
 *
 * Usage:
 * ```ts
 * const firebase = new FirebaseCompanion(
 *   { projectId: "my-project" },
 *   firebaseAdminAuth,
 * );
 *
 * const result = await firebase.onAgentRegistered(agent);
 * ```
 */
export class FirebaseCompanion {
  private config: FirebaseCompanionConfig;
  private admin: FirebaseAdminInterface;
  private agentUidMap: Map<string, string>;

  constructor(config: FirebaseCompanionConfig, admin: FirebaseAdminInterface) {
    this.config = config;
    this.admin = admin;
    this.agentUidMap = new Map();
  }

  /**
   * Build the custom claims object for an agent.
   */
  private buildCustomClaims(agent: Agent): Record<string, unknown> {
    const prefix = this.config.customClaimsPrefix ?? "agentgate_";

    return {
      [`${prefix}is_agent`]: true,
      [`${prefix}agent_id`]: agent.id,
      [`${prefix}scopes`]: agent.scopesGranted,
      [`${prefix}wallet`]: agent.x402Wallet ?? null,
    };
  }

  /**
   * Handle a new agent registration by creating a Firebase Auth user
   * with custom claims.
   */
  async onAgentRegistered(agent: Agent): Promise<FirebaseSyncResult> {
    try {
      const customClaims = this.buildCustomClaims(agent);

      const result = await this.admin.createUser({
        uid: agent.id,
        email: `${agent.id}@agents.${this.config.projectId}.firebaseapp.com`,
        emailVerified: true,
        displayName: agent.metadata.name ?? `Agent ${agent.id}`,
        disabled: false,
      });

      await this.admin.setCustomUserClaims(result.uid, customClaims);

      this.agentUidMap.set(agent.id, result.uid);

      return {
        firebaseUid: result.uid,
        agentId: agent.id,
        synced: true,
        customClaims,
      };
    } catch (err) {
      return {
        firebaseUid: "",
        agentId: agent.id,
        synced: false,
        customClaims: {},
      };
    }
  }

  /**
   * Handle agent revocation by deleting the Firebase Auth user.
   */
  async onAgentRevoked(agentId: string): Promise<void> {
    const uid = this.agentUidMap.get(agentId);
    if (!uid) {
      return;
    }

    await this.admin.deleteUser(uid);
    this.agentUidMap.delete(agentId);
  }

  /**
   * Get the Firebase UID for a given agent.
   */
  async getFirebaseUid(agentId: string): Promise<string | null> {
    return this.agentUidMap.get(agentId) ?? null;
  }

  /**
   * Sync an existing agent to Firebase. Updates custom claims
   * if a mapping exists, otherwise creates a new user.
   */
  async syncAgent(agent: Agent): Promise<FirebaseSyncResult> {
    const existingUid = this.agentUidMap.get(agent.id);

    if (existingUid) {
      try {
        const customClaims = this.buildCustomClaims(agent);

        await this.admin.updateUser(existingUid, {
          displayName: agent.metadata.name ?? `Agent ${agent.id}`,
          disabled: agent.status !== "active",
        });

        await this.admin.setCustomUserClaims(existingUid, customClaims);

        return {
          firebaseUid: existingUid,
          agentId: agent.id,
          synced: true,
          customClaims,
        };
      } catch (err) {
        return {
          firebaseUid: existingUid,
          agentId: agent.id,
          synced: false,
          customClaims: {},
        };
      }
    }

    return this.onAgentRegistered(agent);
  }
}
