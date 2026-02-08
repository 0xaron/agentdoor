import { describe, it, expect } from "vitest";
import {
  validateConfig,
  resolveConfig,
  InvalidConfigError,
} from "../index.js";

const MINIMAL_CONFIG = {
  scopes: [{ id: "test.read", description: "Test scope" }],
};

describe("validateConfig", () => {
  it("passes for a minimal valid config", () => {
    const result = validateConfig(MINIMAL_CONFIG);
    expect(result).toHaveProperty("scopes");
    expect(result.scopes).toHaveLength(1);
    expect(result.scopes[0].id).toBe("test.read");
  });

  it("throws InvalidConfigError when scopes are missing", () => {
    expect(() => validateConfig({})).toThrow(InvalidConfigError);
  });

  it("throws InvalidConfigError when scopes array is empty", () => {
    expect(() => validateConfig({ scopes: [] })).toThrow(InvalidConfigError);
  });

  it("throws InvalidConfigError for invalid scope id format", () => {
    expect(() =>
      validateConfig({ scopes: [{ id: "123bad", description: "Bad" }] }),
    ).toThrow(InvalidConfigError);
  });

  it("passes with all optional fields", () => {
    const config = {
      scopes: [{ id: "data.read", description: "Read data" }],
      rateLimit: { requests: 500, window: "1h" },
      mode: "test" as const,
      jwt: { secret: "a-very-long-secret-string-1234", expiresIn: "2h" },
      storage: { driver: "memory" as const },
    };
    const result = validateConfig(config);
    expect(result.mode).toBe("test");
  });
});

describe("resolveConfig", () => {
  it("fills in defaults for a minimal config", () => {
    const resolved = resolveConfig(MINIMAL_CONFIG);
    expect(resolved.mode).toBe("live");
    expect(resolved.rateLimit).toEqual({ requests: 1000, window: "1h" });
    expect(resolved.storage).toEqual({ driver: "memory" });
    expect(resolved.signing).toEqual({ algorithm: "ed25519" });
    expect(typeof resolved.jwt.secret).toBe("string");
    expect(resolved.jwt.secret.length).toBeGreaterThanOrEqual(16);
    expect(resolved.jwt.expiresIn).toBe("1h");
    expect(resolved.service.name).toBe("AgentGate Service");
    expect(resolved.challengeExpirySeconds).toBe(300);
    expect(resolved.companion.a2aAgentCard).toBe(true);
    expect(resolved.companion.mcpServer).toBe(false);
  });

  it("preserves user-provided values", () => {
    const resolved = resolveConfig({
      scopes: [{ id: "custom.scope", description: "Custom" }],
      mode: "test",
      rateLimit: { requests: 50, window: "30s" },
      jwt: { secret: "user-provided-secret-1234567", expiresIn: "24h" },
    });
    expect(resolved.mode).toBe("test");
    expect(resolved.rateLimit).toEqual({ requests: 50, window: "30s" });
    expect(resolved.jwt.secret).toBe("user-provided-secret-1234567");
    expect(resolved.jwt.expiresIn).toBe("24h");
  });

  it("throws for invalid config", () => {
    expect(() => resolveConfig({ scopes: [] } as any)).toThrow(InvalidConfigError);
  });
});
