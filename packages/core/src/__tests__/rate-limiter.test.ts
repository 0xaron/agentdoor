import { describe, it, expect, afterEach } from "vitest";
import { RateLimiter, parseWindow } from "../index.js";

describe("parseWindow", () => {
  it("parses '1h' to 3600000 ms", () => {
    expect(parseWindow("1h")).toBe(3_600_000);
  });

  it("parses '30s' to 30000 ms", () => {
    expect(parseWindow("30s")).toBe(30_000);
  });

  it("parses '5m' to 300000 ms", () => {
    expect(parseWindow("5m")).toBe(300_000);
  });

  it("parses '1d' to 86400000 ms", () => {
    expect(parseWindow("1d")).toBe(86_400_000);
  });

  it("throws on invalid format", () => {
    expect(() => parseWindow("invalid")).toThrow();
    expect(() => parseWindow("")).toThrow();
  });
});

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  afterEach(() => {
    if (limiter) {
      limiter.destroy();
    }
  });

  it("allows requests within the limit", () => {
    limiter = new RateLimiter({ requests: 5, window: "1h" }, 0);
    const result = limiter.check("agent1");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.limit).toBe(5);
  });

  it("decrements remaining on each call", () => {
    limiter = new RateLimiter({ requests: 5, window: "1h" }, 0);
    limiter.check("agent1"); // remaining: 4
    limiter.check("agent1"); // remaining: 3
    const result = limiter.check("agent1"); // remaining: 2
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("blocks after the limit is exhausted", () => {
    limiter = new RateLimiter({ requests: 5, window: "1h" }, 0);
    for (let i = 0; i < 5; i++) {
      const r = limiter.check("agent1");
      expect(r.allowed).toBe(true);
    }
    const blocked = limiter.check("agent1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(typeof blocked.retryAfter).toBe("number");
    expect(blocked.retryAfter!).toBeGreaterThan(0);
  });

  it("tracks separate buckets per key", () => {
    limiter = new RateLimiter({ requests: 2, window: "1h" }, 0);
    limiter.check("agent1");
    limiter.check("agent1");
    const blocked = limiter.check("agent1");
    expect(blocked.allowed).toBe(false);

    // Different key should still be allowed
    const other = limiter.check("agent2");
    expect(other.allowed).toBe(true);
  });

  it("reset clears a specific bucket", () => {
    limiter = new RateLimiter({ requests: 2, window: "1h" }, 0);
    limiter.check("agent1");
    limiter.check("agent1");
    expect(limiter.check("agent1").allowed).toBe(false);

    limiter.reset("agent1");
    expect(limiter.check("agent1").allowed).toBe(true);
  });

  it("destroy clears all buckets and stops cleanup", () => {
    limiter = new RateLimiter({ requests: 5, window: "1h" });
    limiter.check("agent1");
    expect(limiter.size).toBe(1);
    limiter.destroy();
    expect(limiter.size).toBe(0);
  });
});
