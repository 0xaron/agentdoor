/**
 * @agentgate/core - Reputation System
 *
 * Per-agent reputation scoring based on behavioral signals:
 * - Payment success rate
 * - Rate limit compliance
 * - Error rate
 * - Age / longevity
 *
 * P1 Feature: Reputation System
 * Score range: 0-100 (default: 50 for new agents)
 * Supports reputation gating (minimum reputation for certain scopes/actions).
 */

import { DEFAULT_REPUTATION } from "./constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single reputation event that affects an agent's score. */
export interface ReputationEvent {
  /** Event type that affects reputation */
  type: ReputationEventType;
  /** Timestamp of the event */
  timestamp: Date;
  /** Additional context */
  metadata?: Record<string, unknown>;
}

/** Types of events that affect reputation. */
export type ReputationEventType =
  | "payment_success"
  | "payment_failure"
  | "rate_limit_hit"
  | "request_success"
  | "request_error"
  | "flagged"
  | "unflagged";

/** Weight configuration for reputation events. */
export interface ReputationWeights {
  /** Points added for successful payment (default: +2) */
  payment_success: number;
  /** Points deducted for failed payment (default: -5) */
  payment_failure: number;
  /** Points deducted for hitting rate limit (default: -1) */
  rate_limit_hit: number;
  /** Points added for successful request (default: +0.1) */
  request_success: number;
  /** Points deducted for error response (default: -0.5) */
  request_error: number;
  /** Points deducted for being flagged (default: -10) */
  flagged: number;
  /** Points added for being unflagged (default: +5) */
  unflagged: number;
}

/** Configuration for reputation gating. */
export interface ReputationGateConfig {
  /** Minimum reputation score required. */
  minReputation: number;
  /** Scopes that require this minimum reputation. Empty = all scopes. */
  scopes?: string[];
  /** Action to take when gate is not met: "block" returns 403, "warn" adds header. */
  action: "block" | "warn";
}

/** Configuration for the reputation system. */
export interface ReputationConfig {
  /** Whether reputation tracking is enabled. Default: true */
  enabled?: boolean;
  /** Initial reputation score for new agents. Default: 50 */
  initialScore?: number;
  /** Minimum possible score. Default: 0 */
  minScore?: number;
  /** Maximum possible score. Default: 100 */
  maxScore?: number;
  /** Custom weights for reputation events */
  weights?: Partial<ReputationWeights>;
  /** Reputation gates for access control */
  gates?: ReputationGateConfig[];
  /** Score below which an agent is auto-flagged. Default: 20 */
  flagThreshold?: number;
  /** Score below which an agent is auto-suspended. Default: 10 */
  suspendThreshold?: number;
}

/** Result of a reputation gate check. */
export interface ReputationGateResult {
  /** Whether the agent passes the gate */
  allowed: boolean;
  /** The agent's current reputation score */
  currentScore: number;
  /** The required minimum score (if gated) */
  requiredScore?: number;
  /** The gate action (if gated and not allowed) */
  action?: "block" | "warn";
  /** The specific gate that was triggered */
  gate?: ReputationGateConfig;
}

// ---------------------------------------------------------------------------
// Default Weights
// ---------------------------------------------------------------------------

/** Default reputation event weights. */
export const DEFAULT_REPUTATION_WEIGHTS: ReputationWeights = {
  payment_success: 2,
  payment_failure: -5,
  rate_limit_hit: -1,
  request_success: 0.1,
  request_error: -0.5,
  flagged: -10,
  unflagged: 5,
};

// ---------------------------------------------------------------------------
// ReputationManager Class
// ---------------------------------------------------------------------------

/**
 * Manages agent reputation scores.
 *
 * The reputation system tracks agent behavior and adjusts scores based on
 * configurable weights. Reputation gates can be used to restrict access
 * to certain scopes or actions based on minimum reputation requirements.
 *
 * Usage:
 * ```ts
 * const reputation = new ReputationManager({
 *   gates: [
 *     { minReputation: 70, scopes: ["data.write"], action: "block" },
 *     { minReputation: 30, action: "warn" },
 *   ],
 * });
 *
 * // Calculate score change
 * const newScore = reputation.calculateScore(currentScore, "payment_success");
 *
 * // Check gate
 * const result = reputation.checkGate(agentScore, "data.write");
 * ```
 */
export class ReputationManager {
  private readonly config: Required<
    Pick<ReputationConfig, "enabled" | "initialScore" | "minScore" | "maxScore" | "flagThreshold" | "suspendThreshold">
  > & {
    weights: ReputationWeights;
    gates: ReputationGateConfig[];
  };

  constructor(config?: ReputationConfig) {
    this.config = {
      enabled: config?.enabled ?? true,
      initialScore: config?.initialScore ?? DEFAULT_REPUTATION,
      minScore: config?.minScore ?? 0,
      maxScore: config?.maxScore ?? 100,
      flagThreshold: config?.flagThreshold ?? 20,
      suspendThreshold: config?.suspendThreshold ?? 10,
      weights: {
        ...DEFAULT_REPUTATION_WEIGHTS,
        ...config?.weights,
      },
      gates: config?.gates ?? [],
    };
  }

  /**
   * Calculate the new reputation score after an event.
   *
   * @param currentScore - Current reputation score
   * @param eventType - The event that occurred
   * @returns New reputation score (clamped to min/max)
   */
  calculateScore(currentScore: number, eventType: ReputationEventType): number {
    if (!this.config.enabled) return currentScore;

    const weight = this.config.weights[eventType];
    const newScore = currentScore + weight;

    return this.clamp(newScore);
  }

  /**
   * Calculate score change from multiple events at once.
   *
   * @param currentScore - Current reputation score
   * @param events - Array of event types
   * @returns New reputation score
   */
  calculateBulkScore(currentScore: number, events: ReputationEventType[]): number {
    if (!this.config.enabled) return currentScore;

    let score = currentScore;
    for (const event of events) {
      score += this.config.weights[event];
    }

    return this.clamp(score);
  }

  /**
   * Check if an agent passes a reputation gate for a given scope.
   *
   * @param agentScore - Agent's current reputation score
   * @param scope - The scope being accessed (optional)
   * @returns Gate check result
   */
  checkGate(agentScore: number, scope?: string): ReputationGateResult {
    if (!this.config.enabled || this.config.gates.length === 0) {
      return { allowed: true, currentScore: agentScore };
    }

    // Find the most restrictive applicable gate
    for (const gate of this.config.gates) {
      const isApplicable =
        !gate.scopes || gate.scopes.length === 0 || (scope && gate.scopes.includes(scope));

      if (isApplicable && agentScore < gate.minReputation) {
        return {
          allowed: gate.action === "warn",
          currentScore: agentScore,
          requiredScore: gate.minReputation,
          action: gate.action,
          gate,
        };
      }
    }

    return { allowed: true, currentScore: agentScore };
  }

  /**
   * Determine if an agent should be auto-flagged based on their score.
   *
   * @param score - Agent's current reputation score
   * @returns Whether the agent should be flagged
   */
  shouldFlag(score: number): boolean {
    return this.config.enabled && score <= this.config.flagThreshold;
  }

  /**
   * Determine if an agent should be auto-suspended based on their score.
   *
   * @param score - Agent's current reputation score
   * @returns Whether the agent should be suspended
   */
  shouldSuspend(score: number): boolean {
    return this.config.enabled && score <= this.config.suspendThreshold;
  }

  /**
   * Get the initial reputation score for new agents.
   */
  getInitialScore(): number {
    return this.config.initialScore;
  }

  /**
   * Get the weight for a specific event type.
   */
  getWeight(eventType: ReputationEventType): number {
    return this.config.weights[eventType];
  }

  /**
   * Get the configured thresholds.
   */
  getThresholds(): { flag: number; suspend: number } {
    return {
      flag: this.config.flagThreshold,
      suspend: this.config.suspendThreshold,
    };
  }

  /**
   * Check if the reputation system is enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private clamp(score: number): number {
    return Math.max(this.config.minScore, Math.min(this.config.maxScore, score));
  }
}
