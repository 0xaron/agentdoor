/**
 * @agentdoor/core - Spending Caps
 *
 * Tracks per-agent spending and enforces daily/monthly caps.
 * Supports hard limits (block requests) and soft limits (warn only).
 *
 * P1 Feature: Spending Caps
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Period for spending caps. */
export type SpendingPeriod = "daily" | "monthly";

/** Type of spending cap. */
export type SpendingCapType = "hard" | "soft";

/** A single spending cap rule. */
export interface SpendingCapRule {
  /** Maximum spend amount for the period */
  amount: number;
  /** Currency (e.g., "USDC") */
  currency: string;
  /** Time period for the cap */
  period: SpendingPeriod;
  /** Cap type: "hard" blocks requests, "soft" sends warnings */
  type: SpendingCapType;
}

/** Configuration for the spending caps system. */
export interface SpendingCapsConfig {
  /** Whether spending caps are enabled. Default: true */
  enabled?: boolean;
  /** Default caps applied to all agents */
  defaultCaps?: SpendingCapRule[];
  /** Soft limit warning threshold (percentage of cap). Default: 0.8 (80%) */
  warningThreshold?: number;
}

/** Spending record for a single period. */
export interface SpendingRecord {
  /** Agent ID */
  agentId: string;
  /** Amount spent in this period */
  amount: number;
  /** Currency */
  currency: string;
  /** Period type */
  period: SpendingPeriod;
  /** Period start (beginning of day or month) */
  periodStart: Date;
  /** Last updated */
  updatedAt: Date;
}

/** Result of a spending cap check. */
export interface SpendingCheckResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Whether a warning should be issued (soft cap approaching) */
  warning: boolean;
  /** Current spend in the period */
  currentSpend: number;
  /** Cap amount */
  capAmount: number;
  /** Period */
  period: SpendingPeriod;
  /** Cap type */
  capType: SpendingCapType;
  /** Remaining budget */
  remaining: number;
  /** Usage percentage (0-1) */
  usagePercent: number;
}

// ---------------------------------------------------------------------------
// SpendingTracker Class
// ---------------------------------------------------------------------------

/**
 * In-memory spending tracker with daily and monthly caps.
 *
 * Tracks spending per agent per period and enforces configured limits.
 * For production, spending data should be persisted to a database.
 *
 * Usage:
 * ```ts
 * const tracker = new SpendingTracker({
 *   defaultCaps: [
 *     { amount: 10, currency: "USDC", period: "daily", type: "hard" },
 *     { amount: 100, currency: "USDC", period: "monthly", type: "soft" },
 *   ],
 * });
 *
 * // Record spending
 * tracker.recordSpend("ag_xxx", 0.01, "USDC");
 *
 * // Check if agent can spend more
 * const result = tracker.checkCap("ag_xxx", 0.01, "USDC");
 * if (!result.allowed) {
 *   // Block or warn
 * }
 * ```
 */
export class SpendingTracker {
  /** Map of "agentId:period:periodKey" -> SpendingRecord */
  private records: Map<string, SpendingRecord> = new Map();

  /** Per-agent cap overrides: agentId -> caps */
  private agentCaps: Map<string, SpendingCapRule[]> = new Map();

  private readonly config: {
    enabled: boolean;
    defaultCaps: SpendingCapRule[];
    warningThreshold: number;
  };

  constructor(config?: SpendingCapsConfig) {
    this.config = {
      enabled: config?.enabled ?? true,
      defaultCaps: config?.defaultCaps ?? [],
      warningThreshold: config?.warningThreshold ?? 0.8,
    };
  }

  /**
   * Record a spending event for an agent.
   *
   * @param agentId - Agent ID
   * @param amount - Amount spent
   * @param currency - Currency (e.g., "USDC")
   * @returns Updated spending record
   */
  recordSpend(agentId: string, amount: number, currency: string): SpendingRecord[] {
    if (!this.config.enabled) return [];

    const now = new Date();
    const records: SpendingRecord[] = [];

    // Update daily record
    const dailyKey = this.getRecordKey(agentId, "daily", now);
    const dailyRecord = this.getOrCreateRecord(dailyKey, agentId, "daily", currency, now);
    dailyRecord.amount += amount;
    dailyRecord.updatedAt = now;
    records.push({ ...dailyRecord });

    // Update monthly record
    const monthlyKey = this.getRecordKey(agentId, "monthly", now);
    const monthlyRecord = this.getOrCreateRecord(monthlyKey, agentId, "monthly", currency, now);
    monthlyRecord.amount += amount;
    monthlyRecord.updatedAt = now;
    records.push({ ...monthlyRecord });

    return records;
  }

  /**
   * Check if an agent's spending would exceed any caps.
   *
   * @param agentId - Agent ID
   * @param amount - Amount to be spent
   * @param currency - Currency
   * @returns Check result for the most restrictive cap
   */
  checkCap(agentId: string, amount: number, currency: string): SpendingCheckResult {
    if (!this.config.enabled) {
      return {
        allowed: true,
        warning: false,
        currentSpend: 0,
        capAmount: Infinity,
        period: "daily",
        capType: "soft",
        remaining: Infinity,
        usagePercent: 0,
      };
    }

    const caps = this.getCapsForAgent(agentId);
    const now = new Date();

    let mostRestrictive: SpendingCheckResult | null = null;

    for (const cap of caps) {
      if (cap.currency !== currency) continue;

      const key = this.getRecordKey(agentId, cap.period, now);
      const record = this.records.get(key);
      const currentSpend = record?.amount ?? 0;
      const projectedSpend = currentSpend + amount;
      const remaining = Math.max(0, cap.amount - currentSpend);
      const usagePercent = cap.amount > 0 ? currentSpend / cap.amount : 0;
      const projectedPercent = cap.amount > 0 ? projectedSpend / cap.amount : 0;

      const allowed = cap.type === "soft" || projectedSpend <= cap.amount;
      const warning = projectedPercent >= this.config.warningThreshold;

      const result: SpendingCheckResult = {
        allowed,
        warning,
        currentSpend,
        capAmount: cap.amount,
        period: cap.period,
        capType: cap.type,
        remaining,
        usagePercent,
      };

      // Keep the most restrictive result (prefer the one that blocks)
      if (!mostRestrictive || (!result.allowed && mostRestrictive.allowed) || result.usagePercent > mostRestrictive.usagePercent) {
        mostRestrictive = result;
      }
    }

    return mostRestrictive ?? {
      allowed: true,
      warning: false,
      currentSpend: 0,
      capAmount: Infinity,
      period: "daily",
      capType: "soft",
      remaining: Infinity,
      usagePercent: 0,
    };
  }

  /**
   * Get current spending for an agent across all periods.
   *
   * @param agentId - Agent ID
   * @returns Array of spending records
   */
  getSpending(agentId: string): SpendingRecord[] {
    const now = new Date();
    const results: SpendingRecord[] = [];

    for (const period of ["daily", "monthly"] as SpendingPeriod[]) {
      const key = this.getRecordKey(agentId, period, now);
      const record = this.records.get(key);
      if (record) {
        results.push({ ...record });
      }
    }

    return results;
  }

  /**
   * Set custom spending caps for a specific agent.
   * Overrides the default caps for that agent.
   *
   * @param agentId - Agent ID
   * @param caps - Custom cap rules
   */
  setAgentCaps(agentId: string, caps: SpendingCapRule[]): void {
    this.agentCaps.set(agentId, [...caps]);
  }

  /**
   * Remove custom caps for an agent (reverts to defaults).
   *
   * @param agentId - Agent ID
   */
  removeAgentCaps(agentId: string): void {
    this.agentCaps.delete(agentId);
  }

  /**
   * Get the effective caps for an agent.
   *
   * @param agentId - Agent ID
   * @returns Effective spending cap rules
   */
  getCapsForAgent(agentId: string): SpendingCapRule[] {
    return this.agentCaps.get(agentId) ?? this.config.defaultCaps;
  }

  /**
   * Reset spending records for an agent.
   *
   * @param agentId - Agent ID
   * @param period - Optional specific period to reset
   */
  resetSpending(agentId: string, period?: SpendingPeriod): void {
    const keysToDelete: string[] = [];
    for (const [key, record] of this.records) {
      if (record.agentId === agentId) {
        if (!period || record.period === period) {
          keysToDelete.push(key);
        }
      }
    }
    for (const key of keysToDelete) {
      this.records.delete(key);
    }
  }

  /**
   * Clean up expired records (older than current period).
   *
   * @returns Number of records cleaned
   */
  cleanup(): number {
    const now = new Date();
    let cleaned = 0;

    for (const [key, record] of this.records) {
      const periodEnd = this.getPeriodEnd(record.periodStart, record.period);
      if (now > periodEnd) {
        this.records.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Check if the spending caps system is enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the number of active spending records.
   */
  get recordCount(): number {
    return this.records.size;
  }

  /**
   * Clear all spending records and agent caps.
   */
  clear(): void {
    this.records.clear();
    this.agentCaps.clear();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private getRecordKey(agentId: string, period: SpendingPeriod, date: Date): string {
    const periodKey = period === "daily"
      ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
      : `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    return `${agentId}:${period}:${periodKey}`;
  }

  private getOrCreateRecord(
    key: string,
    agentId: string,
    period: SpendingPeriod,
    currency: string,
    now: Date,
  ): SpendingRecord {
    let record = this.records.get(key);
    if (!record) {
      record = {
        agentId,
        amount: 0,
        currency,
        period,
        periodStart: this.getPeriodStart(now, period),
        updatedAt: now,
      };
      this.records.set(key, record);
    }
    return record;
  }

  private getPeriodStart(date: Date, period: SpendingPeriod): Date {
    if (period === "daily") {
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    }
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }

  private getPeriodEnd(periodStart: Date, period: SpendingPeriod): Date {
    if (period === "daily") {
      const end = new Date(periodStart);
      end.setUTCDate(end.getUTCDate() + 1);
      return end;
    }
    const end = new Date(periodStart);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return end;
  }
}
