import { describe, it, expect, beforeEach } from "vitest";
import { SpendingTracker } from "../spending.js";
import type { SpendingCapRule } from "../spending.js";

describe("SpendingTracker", () => {
  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("creates a tracker with default config", () => {
      const tracker = new SpendingTracker();
      expect(tracker.isEnabled()).toBe(true);
      expect(tracker.recordCount).toBe(0);
    });

    it("can be disabled", () => {
      const tracker = new SpendingTracker({ enabled: false });
      expect(tracker.isEnabled()).toBe(false);
    });

    it("accepts default caps", () => {
      const caps: SpendingCapRule[] = [
        { amount: 10, currency: "USDC", period: "daily", type: "hard" },
      ];
      const tracker = new SpendingTracker({ defaultCaps: caps });
      expect(tracker.getCapsForAgent("any")).toEqual(caps);
    });
  });

  // -------------------------------------------------------------------------
  // recordSpend
  // -------------------------------------------------------------------------

  describe("recordSpend", () => {
    let tracker: SpendingTracker;

    beforeEach(() => {
      tracker = new SpendingTracker({
        defaultCaps: [
          { amount: 10, currency: "USDC", period: "daily", type: "hard" },
          { amount: 100, currency: "USDC", period: "monthly", type: "soft" },
        ],
      });
    });

    it("records spending and returns updated records", () => {
      const records = tracker.recordSpend("ag_1", 5, "USDC");
      expect(records).toHaveLength(2); // daily + monthly
      expect(records[0].amount).toBe(5);
      expect(records[0].period).toBe("daily");
      expect(records[1].amount).toBe(5);
      expect(records[1].period).toBe("monthly");
    });

    it("accumulates spending across multiple calls", () => {
      tracker.recordSpend("ag_1", 3, "USDC");
      const records = tracker.recordSpend("ag_1", 4, "USDC");
      const daily = records.find((r) => r.period === "daily")!;
      expect(daily.amount).toBe(7);
    });

    it("tracks spending separately per agent", () => {
      tracker.recordSpend("ag_1", 5, "USDC");
      tracker.recordSpend("ag_2", 3, "USDC");

      const spending1 = tracker.getSpending("ag_1");
      const spending2 = tracker.getSpending("ag_2");

      const daily1 = spending1.find((r) => r.period === "daily")!;
      const daily2 = spending2.find((r) => r.period === "daily")!;
      expect(daily1.amount).toBe(5);
      expect(daily2.amount).toBe(3);
    });

    it("returns empty array when disabled", () => {
      const disabled = new SpendingTracker({ enabled: false });
      const records = disabled.recordSpend("ag_1", 5, "USDC");
      expect(records).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // checkCap
  // -------------------------------------------------------------------------

  describe("checkCap", () => {
    it("allows spending under the cap", () => {
      const tracker = new SpendingTracker({
        defaultCaps: [
          { amount: 10, currency: "USDC", period: "daily", type: "hard" },
        ],
      });

      tracker.recordSpend("ag_1", 5, "USDC");
      const result = tracker.checkCap("ag_1", 3, "USDC");

      expect(result.allowed).toBe(true);
      expect(result.currentSpend).toBe(5);
      expect(result.remaining).toBe(5);
    });

    it("blocks spending over a hard cap", () => {
      const tracker = new SpendingTracker({
        defaultCaps: [
          { amount: 10, currency: "USDC", period: "daily", type: "hard" },
        ],
      });

      tracker.recordSpend("ag_1", 8, "USDC");
      const result = tracker.checkCap("ag_1", 5, "USDC");

      expect(result.allowed).toBe(false);
      expect(result.capType).toBe("hard");
    });

    it("allows spending over a soft cap (with warning)", () => {
      const tracker = new SpendingTracker({
        defaultCaps: [
          { amount: 10, currency: "USDC", period: "daily", type: "soft" },
        ],
      });

      tracker.recordSpend("ag_1", 8, "USDC");
      const result = tracker.checkCap("ag_1", 5, "USDC");

      expect(result.allowed).toBe(true);
      expect(result.warning).toBe(true);
    });

    it("reports warning when approaching threshold", () => {
      const tracker = new SpendingTracker({
        defaultCaps: [
          { amount: 10, currency: "USDC", period: "daily", type: "hard" },
        ],
        warningThreshold: 0.8,
      });

      tracker.recordSpend("ag_1", 8, "USDC");
      const result = tracker.checkCap("ag_1", 1, "USDC");

      expect(result.warning).toBe(true);
      expect(result.usagePercent).toBe(0.8);
    });

    it("allows everything when no caps are configured", () => {
      const tracker = new SpendingTracker();
      const result = tracker.checkCap("ag_1", 1000, "USDC");
      expect(result.allowed).toBe(true);
      expect(result.capAmount).toBe(Infinity);
    });

    it("allows everything when disabled", () => {
      const tracker = new SpendingTracker({
        enabled: false,
        defaultCaps: [
          { amount: 1, currency: "USDC", period: "daily", type: "hard" },
        ],
      });

      const result = tracker.checkCap("ag_1", 1000, "USDC");
      expect(result.allowed).toBe(true);
    });

    it("ignores caps for different currencies", () => {
      const tracker = new SpendingTracker({
        defaultCaps: [
          { amount: 10, currency: "USDC", period: "daily", type: "hard" },
        ],
      });

      tracker.recordSpend("ag_1", 100, "ETH");
      const result = tracker.checkCap("ag_1", 5, "ETH");

      // No USDC caps apply to ETH spending
      expect(result.allowed).toBe(true);
    });

    it("returns correct usage percent", () => {
      const tracker = new SpendingTracker({
        defaultCaps: [
          { amount: 100, currency: "USDC", period: "daily", type: "hard" },
        ],
      });

      tracker.recordSpend("ag_1", 25, "USDC");
      const result = tracker.checkCap("ag_1", 0, "USDC");
      expect(result.usagePercent).toBe(0.25);
    });
  });

  // -------------------------------------------------------------------------
  // Agent-specific caps
  // -------------------------------------------------------------------------

  describe("setAgentCaps / removeAgentCaps", () => {
    it("overrides default caps for a specific agent", () => {
      const tracker = new SpendingTracker({
        defaultCaps: [
          { amount: 10, currency: "USDC", period: "daily", type: "hard" },
        ],
      });

      tracker.setAgentCaps("ag_vip", [
        { amount: 100, currency: "USDC", period: "daily", type: "hard" },
      ]);

      const defaultCaps = tracker.getCapsForAgent("ag_normal");
      const vipCaps = tracker.getCapsForAgent("ag_vip");

      expect(defaultCaps[0].amount).toBe(10);
      expect(vipCaps[0].amount).toBe(100);
    });

    it("reverts to defaults when agent caps are removed", () => {
      const tracker = new SpendingTracker({
        defaultCaps: [
          { amount: 10, currency: "USDC", period: "daily", type: "hard" },
        ],
      });

      tracker.setAgentCaps("ag_1", [
        { amount: 100, currency: "USDC", period: "daily", type: "hard" },
      ]);
      expect(tracker.getCapsForAgent("ag_1")[0].amount).toBe(100);

      tracker.removeAgentCaps("ag_1");
      expect(tracker.getCapsForAgent("ag_1")[0].amount).toBe(10);
    });
  });

  // -------------------------------------------------------------------------
  // getSpending
  // -------------------------------------------------------------------------

  describe("getSpending", () => {
    it("returns empty array for agent with no spending", () => {
      const tracker = new SpendingTracker();
      expect(tracker.getSpending("ag_new")).toEqual([]);
    });

    it("returns current spending records", () => {
      const tracker = new SpendingTracker();
      tracker.recordSpend("ag_1", 5, "USDC");
      const spending = tracker.getSpending("ag_1");
      expect(spending.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // resetSpending
  // -------------------------------------------------------------------------

  describe("resetSpending", () => {
    it("resets all spending for an agent", () => {
      const tracker = new SpendingTracker();
      tracker.recordSpend("ag_1", 5, "USDC");
      tracker.resetSpending("ag_1");
      expect(tracker.getSpending("ag_1")).toEqual([]);
    });

    it("resets only specific period", () => {
      const tracker = new SpendingTracker();
      tracker.recordSpend("ag_1", 5, "USDC");
      tracker.resetSpending("ag_1", "daily");
      const spending = tracker.getSpending("ag_1");
      // Monthly record should still exist
      const monthly = spending.find((r) => r.period === "monthly");
      expect(monthly).toBeDefined();
    });

    it("does not affect other agents", () => {
      const tracker = new SpendingTracker();
      tracker.recordSpend("ag_1", 5, "USDC");
      tracker.recordSpend("ag_2", 3, "USDC");
      tracker.resetSpending("ag_1");
      expect(tracker.getSpending("ag_1")).toEqual([]);
      expect(tracker.getSpending("ag_2").length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // cleanup
  // -------------------------------------------------------------------------

  describe("cleanup", () => {
    it("returns 0 when nothing to clean", () => {
      const tracker = new SpendingTracker();
      expect(tracker.cleanup()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------

  describe("clear", () => {
    it("removes all records and agent caps", () => {
      const tracker = new SpendingTracker();
      tracker.recordSpend("ag_1", 5, "USDC");
      tracker.setAgentCaps("ag_1", []);
      tracker.clear();
      expect(tracker.recordCount).toBe(0);
      expect(tracker.getSpending("ag_1")).toEqual([]);
    });
  });
});
