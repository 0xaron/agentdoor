import { describe, it, expect } from "vitest";
import {
  issueToken,
  verifyToken,
  computeExpirationDate,
  InvalidTokenError,
} from "../index.js";
import type { AgentContext } from "../index.js";

const TEST_SECRET = "super-secret-key-for-testing-1234";

function makeAgentContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    id: "ag_testAgent001",
    publicKey: "dGVzdC1wdWJsaWMta2V5LWJhc2U2NA==",
    scopes: ["test.read", "test.write"],
    rateLimit: { requests: 100, window: "1h" },
    reputation: 80,
    metadata: { framework: "vitest" },
    ...overrides,
  };
}

describe("issueToken", () => {
  it("returns a JWT string starting with 'eyJ'", async () => {
    const agent = makeAgentContext();
    const token = await issueToken(agent, TEST_SECRET);
    expect(typeof token).toBe("string");
    expect(token.startsWith("eyJ")).toBe(true);
  });

  it("accepts a custom expiresIn parameter", async () => {
    const agent = makeAgentContext();
    const token = await issueToken(agent, TEST_SECRET, "30m");
    expect(typeof token).toBe("string");
    expect(token.startsWith("eyJ")).toBe(true);
  });
});

describe("verifyToken", () => {
  it("round-trips: issue then verify returns the agent context", async () => {
    const agent = makeAgentContext();
    const token = await issueToken(agent, TEST_SECRET);
    const result = await verifyToken(token, TEST_SECRET);

    expect(result.agent.id).toBe(agent.id);
    expect(result.agent.publicKey).toBe(agent.publicKey);
    expect(result.agent.scopes).toEqual(agent.scopes);
    expect(result.agent.metadata).toEqual(agent.metadata);
    expect(result.agent.reputation).toBe(agent.reputation);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.issuedAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThan(result.issuedAt.getTime());
  });

  it("throws InvalidTokenError with a wrong secret", async () => {
    const agent = makeAgentContext();
    const token = await issueToken(agent, TEST_SECRET);
    await expect(verifyToken(token, "wrong-secret-entirely-here")).rejects.toThrow(
      InvalidTokenError,
    );
  });

  it("throws InvalidTokenError for a garbage token", async () => {
    await expect(verifyToken("not.a.jwt", TEST_SECRET)).rejects.toThrow(
      InvalidTokenError,
    );
  });
});

describe("computeExpirationDate", () => {
  it("returns a Date approximately 1 hour in the future for '1h'", () => {
    const before = Date.now();
    const date = computeExpirationDate("1h");
    const after = Date.now();
    expect(date).toBeInstanceOf(Date);
    const oneHourMs = 60 * 60 * 1000;
    expect(date.getTime()).toBeGreaterThanOrEqual(before + oneHourMs - 100);
    expect(date.getTime()).toBeLessThanOrEqual(after + oneHourMs + 100);
  });

  it("handles '30s'", () => {
    const before = Date.now();
    const date = computeExpirationDate("30s");
    expect(date.getTime()).toBeGreaterThanOrEqual(before + 29_000);
    expect(date.getTime()).toBeLessThanOrEqual(before + 31_000);
  });

  it("handles '7d'", () => {
    const before = Date.now();
    const date = computeExpirationDate("7d");
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(date.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs - 100);
    expect(date.getTime()).toBeLessThanOrEqual(before + sevenDaysMs + 100);
  });

  it("throws on invalid format", () => {
    expect(() => computeExpirationDate("invalid")).toThrow();
  });
});
