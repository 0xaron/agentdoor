import { describe, it, expect } from "vitest";
import { ReputationManager, DEFAULT_REPUTATION_WEIGHTS } from "../reputation.js";
import type { ReputationEventType } from "../reputation.js";

describe("ReputationManager", () => {
  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("creates a manager with default config", () => {
      const mgr = new ReputationManager();
      expect(mgr.isEnabled()).toBe(true);
      expect(mgr.getInitialScore()).toBe(50);
    });

    it("respects custom initial score", () => {
      const mgr = new ReputationManager({ initialScore: 75 });
      expect(mgr.getInitialScore()).toBe(75);
    });

    it("can be disabled", () => {
      const mgr = new ReputationManager({ enabled: false });
      expect(mgr.isEnabled()).toBe(false);
    });

    it("accepts custom weights", () => {
      const mgr = new ReputationManager({
        weights: { payment_success: 10, payment_failure: -20 },
      });
      expect(mgr.getWeight("payment_success")).toBe(10);
      expect(mgr.getWeight("payment_failure")).toBe(-20);
      // Defaults still apply for non-overridden
      expect(mgr.getWeight("rate_limit_hit")).toBe(DEFAULT_REPUTATION_WEIGHTS.rate_limit_hit);
    });

    it("accepts custom thresholds", () => {
      const mgr = new ReputationManager({
        flagThreshold: 30,
        suspendThreshold: 15,
      });
      expect(mgr.getThresholds()).toEqual({ flag: 30, suspend: 15 });
    });
  });

  // -------------------------------------------------------------------------
  // calculateScore
  // -------------------------------------------------------------------------

  describe("calculateScore", () => {
    const mgr = new ReputationManager();

    it("increases score on payment_success", () => {
      const newScore = mgr.calculateScore(50, "payment_success");
      expect(newScore).toBe(52); // 50 + 2
    });

    it("decreases score on payment_failure", () => {
      const newScore = mgr.calculateScore(50, "payment_failure");
      expect(newScore).toBe(45); // 50 - 5
    });

    it("decreases score on rate_limit_hit", () => {
      const newScore = mgr.calculateScore(50, "rate_limit_hit");
      expect(newScore).toBe(49); // 50 - 1
    });

    it("slightly increases score on request_success", () => {
      const newScore = mgr.calculateScore(50, "request_success");
      expect(newScore).toBeCloseTo(50.1); // 50 + 0.1
    });

    it("decreases score on request_error", () => {
      const newScore = mgr.calculateScore(50, "request_error");
      expect(newScore).toBeCloseTo(49.5); // 50 - 0.5
    });

    it("decreases score significantly on flagged", () => {
      const newScore = mgr.calculateScore(50, "flagged");
      expect(newScore).toBe(40); // 50 - 10
    });

    it("increases score on unflagged", () => {
      const newScore = mgr.calculateScore(50, "unflagged");
      expect(newScore).toBe(55); // 50 + 5
    });

    it("clamps score at maximum (100)", () => {
      const newScore = mgr.calculateScore(99, "payment_success");
      expect(newScore).toBe(100); // 99 + 2 = 101, clamped to 100
    });

    it("clamps score at minimum (0)", () => {
      const newScore = mgr.calculateScore(3, "payment_failure");
      expect(newScore).toBe(0); // 3 - 5 = -2, clamped to 0
    });

    it("returns unchanged score when disabled", () => {
      const disabled = new ReputationManager({ enabled: false });
      const newScore = disabled.calculateScore(50, "payment_failure");
      expect(newScore).toBe(50);
    });
  });

  // -------------------------------------------------------------------------
  // calculateBulkScore
  // -------------------------------------------------------------------------

  describe("calculateBulkScore", () => {
    const mgr = new ReputationManager();

    it("calculates score from multiple events", () => {
      const events: ReputationEventType[] = [
        "payment_success",
        "payment_success",
        "rate_limit_hit",
      ];
      const newScore = mgr.calculateBulkScore(50, events);
      expect(newScore).toBe(53); // 50 + 2 + 2 - 1
    });

    it("clamps bulk result to bounds", () => {
      const events: ReputationEventType[] = Array(30).fill("payment_failure");
      const newScore = mgr.calculateBulkScore(50, events);
      expect(newScore).toBe(0); // Clamped at 0
    });

    it("returns unchanged score when disabled", () => {
      const disabled = new ReputationManager({ enabled: false });
      const newScore = disabled.calculateBulkScore(50, ["payment_failure", "payment_failure"]);
      expect(newScore).toBe(50);
    });
  });

  // -------------------------------------------------------------------------
  // checkGate
  // -------------------------------------------------------------------------

  describe("checkGate", () => {
    it("allows when no gates are configured", () => {
      const mgr = new ReputationManager();
      const result = mgr.checkGate(50, "data.read");
      expect(result.allowed).toBe(true);
      expect(result.currentScore).toBe(50);
    });

    it("allows when score meets gate requirement", () => {
      const mgr = new ReputationManager({
        gates: [{ minReputation: 30, action: "block" }],
      });
      const result = mgr.checkGate(50, "data.read");
      expect(result.allowed).toBe(true);
    });

    it("blocks when score is below block gate", () => {
      const mgr = new ReputationManager({
        gates: [{ minReputation: 60, action: "block" }],
      });
      const result = mgr.checkGate(50, "data.read");
      expect(result.allowed).toBe(false);
      expect(result.action).toBe("block");
      expect(result.requiredScore).toBe(60);
    });

    it("allows but warns when score is below warn gate", () => {
      const mgr = new ReputationManager({
        gates: [{ minReputation: 60, action: "warn" }],
      });
      const result = mgr.checkGate(50, "data.read");
      expect(result.allowed).toBe(true);
      expect(result.action).toBe("warn");
    });

    it("checks scope-specific gates", () => {
      const mgr = new ReputationManager({
        gates: [
          { minReputation: 70, scopes: ["data.write"], action: "block" },
          { minReputation: 30, action: "block" },
        ],
      });

      // data.read only has the general gate (30)
      const readResult = mgr.checkGate(50, "data.read");
      expect(readResult.allowed).toBe(true);

      // data.write has the specific gate (70)
      const writeResult = mgr.checkGate(50, "data.write");
      expect(writeResult.allowed).toBe(false);
      expect(writeResult.requiredScore).toBe(70);
    });

    it("allows all when disabled", () => {
      const mgr = new ReputationManager({
        enabled: false,
        gates: [{ minReputation: 100, action: "block" }],
      });
      const result = mgr.checkGate(0, "data.read");
      expect(result.allowed).toBe(true);
    });

    it("checks gate with no scope", () => {
      const mgr = new ReputationManager({
        gates: [{ minReputation: 40, action: "block" }],
      });
      const result = mgr.checkGate(30);
      expect(result.allowed).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // shouldFlag / shouldSuspend
  // -------------------------------------------------------------------------

  describe("shouldFlag", () => {
    const mgr = new ReputationManager(); // Default thresholds: flag=20, suspend=10

    it("returns true when score is at flag threshold", () => {
      expect(mgr.shouldFlag(20)).toBe(true);
    });

    it("returns true when score is below flag threshold", () => {
      expect(mgr.shouldFlag(15)).toBe(true);
    });

    it("returns false when score is above flag threshold", () => {
      expect(mgr.shouldFlag(25)).toBe(false);
    });

    it("returns false when disabled", () => {
      const disabled = new ReputationManager({ enabled: false });
      expect(disabled.shouldFlag(0)).toBe(false);
    });
  });

  describe("shouldSuspend", () => {
    const mgr = new ReputationManager();

    it("returns true when score is at suspend threshold", () => {
      expect(mgr.shouldSuspend(10)).toBe(true);
    });

    it("returns true when score is below suspend threshold", () => {
      expect(mgr.shouldSuspend(5)).toBe(true);
    });

    it("returns false when score is above suspend threshold", () => {
      expect(mgr.shouldSuspend(15)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Default weights export
  // -------------------------------------------------------------------------

  describe("DEFAULT_REPUTATION_WEIGHTS", () => {
    it("has all expected event types", () => {
      expect(DEFAULT_REPUTATION_WEIGHTS).toHaveProperty("payment_success");
      expect(DEFAULT_REPUTATION_WEIGHTS).toHaveProperty("payment_failure");
      expect(DEFAULT_REPUTATION_WEIGHTS).toHaveProperty("rate_limit_hit");
      expect(DEFAULT_REPUTATION_WEIGHTS).toHaveProperty("request_success");
      expect(DEFAULT_REPUTATION_WEIGHTS).toHaveProperty("request_error");
      expect(DEFAULT_REPUTATION_WEIGHTS).toHaveProperty("flagged");
      expect(DEFAULT_REPUTATION_WEIGHTS).toHaveProperty("unflagged");
    });

    it("has positive weights for good events", () => {
      expect(DEFAULT_REPUTATION_WEIGHTS.payment_success).toBeGreaterThan(0);
      expect(DEFAULT_REPUTATION_WEIGHTS.request_success).toBeGreaterThan(0);
      expect(DEFAULT_REPUTATION_WEIGHTS.unflagged).toBeGreaterThan(0);
    });

    it("has negative weights for bad events", () => {
      expect(DEFAULT_REPUTATION_WEIGHTS.payment_failure).toBeLessThan(0);
      expect(DEFAULT_REPUTATION_WEIGHTS.rate_limit_hit).toBeLessThan(0);
      expect(DEFAULT_REPUTATION_WEIGHTS.request_error).toBeLessThan(0);
      expect(DEFAULT_REPUTATION_WEIGHTS.flagged).toBeLessThan(0);
    });
  });
});
