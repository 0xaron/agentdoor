import { describe, it, expect } from "vitest";
import {
  generateA2AAgentCard,
  serializeA2AAgentCard,
  getA2AAgentCardHeaders,
  validateA2AAgentCard,
} from "../a2a.js";
import type { ResolvedConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ResolvedConfig for testing. */
function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    scopes: [
      { id: "data.read", description: "Read data" },
      { id: "data.write", description: "Write data" },
    ],
    pricing: { "data.read": "$0.001/req" },
    rateLimit: { requests: 1000, window: "1h" },
    storage: { driver: "memory" },
    signing: { algorithm: "ed25519" },
    jwt: { secret: "test-secret-that-is-long-enough", expiresIn: "1h" },
    companion: { a2aAgentCard: true, mcpServer: false, oauthCompat: false },
    service: {
      name: "Weather API",
      description: "Provides weather forecasts",
      docsUrl: "https://docs.example.com",
    },
    registrationRateLimit: { requests: 10, window: "1h" },
    challengeExpirySeconds: 300,
    mode: "live",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateA2AAgentCard
// ---------------------------------------------------------------------------

describe("generateA2AAgentCard", () => {
  it("generates a valid agent card from config", () => {
    const config = makeConfig();
    const card = generateA2AAgentCard(config, "https://api.example.com");

    expect(card.schema_version).toBe("1.0");
    expect(card.name).toBe("Weather API");
    expect(card.description).toBe("Provides weather forecasts");
    expect(card.url).toBe("https://api.example.com");
  });

  it("maps scopes to capabilities", () => {
    const config = makeConfig();
    const card = generateA2AAgentCard(config, "https://api.example.com");

    expect(card.capabilities).toHaveLength(2);
    expect(card.capabilities[0]).toEqual({
      id: "data.read",
      description: "Read data",
    });
    expect(card.capabilities[1]).toEqual({
      id: "data.write",
      description: "Write data",
    });
  });

  it("includes ed25519-challenge auth scheme for ed25519 signing", () => {
    const config = makeConfig({ signing: { algorithm: "ed25519" } });
    const card = generateA2AAgentCard(config, "https://api.example.com");

    expect(card.authentication.schemes).toContain("ed25519-challenge");
    expect(card.authentication.schemes).toContain("bearer");
  });

  it("includes x402-wallet scheme when x402 is configured", () => {
    const config = makeConfig({
      x402: {
        network: "base",
        currency: "USDC",
        paymentAddress: "0x1234",
      },
    });
    const card = generateA2AAgentCard(config, "https://api.example.com");

    expect(card.authentication.schemes).toContain("x402-wallet");
  });

  it("includes agentdoor protocol by default", () => {
    const config = makeConfig();
    const card = generateA2AAgentCard(config, "https://api.example.com");

    expect(card.protocols).toContain("agentdoor");
  });

  it("includes a2a protocol when a2aAgentCard companion is enabled", () => {
    const config = makeConfig({
      companion: { a2aAgentCard: true, mcpServer: false, oauthCompat: false },
    });
    const card = generateA2AAgentCard(config, "https://api.example.com");

    expect(card.protocols).toContain("a2a");
  });

  it("includes mcp protocol when mcpServer companion is enabled", () => {
    const config = makeConfig({
      companion: { a2aAgentCard: false, mcpServer: true, oauthCompat: false },
    });
    const card = generateA2AAgentCard(config, "https://api.example.com");

    expect(card.protocols).toContain("mcp");
  });

  it("includes x402 protocol when x402 is configured", () => {
    const config = makeConfig({
      x402: {
        network: "base",
        currency: "USDC",
        paymentAddress: "0x1234",
      },
    });
    const card = generateA2AAgentCard(config, "https://api.example.com");

    expect(card.protocols).toContain("x402");
  });

  it("sets registration credentials path", () => {
    const config = makeConfig();
    const card = generateA2AAgentCard(config, "https://api.example.com");

    expect(card.authentication.credentials).toBe("/agentdoor/register");
  });

  it("adds provider info from service name", () => {
    const config = makeConfig({
      service: {
        name: "My Service",
        description: "My description",
        docsUrl: "https://docs.example.com",
      },
    });
    const card = generateA2AAgentCard(config, "https://api.example.com");

    expect(card.provider).toBeDefined();
    expect(card.provider?.organization).toBe("My Service");
    expect(card.provider?.url).toBe("https://docs.example.com");
  });

  it("handles minimal config (no x402, no companion protocols)", () => {
    const config = makeConfig({
      x402: undefined,
      companion: { a2aAgentCard: false, mcpServer: false, oauthCompat: false },
    });
    const card = generateA2AAgentCard(config, "https://api.example.com");

    expect(card.protocols).toContain("agentdoor");
    expect(card.protocols).not.toContain("x402");
    expect(card.protocols).not.toContain("a2a");
    expect(card.protocols).not.toContain("mcp");
  });

  it("handles full config with x402 and all companions", () => {
    const config = makeConfig({
      x402: {
        network: "base",
        currency: "USDC",
        paymentAddress: "0x1234",
      },
      companion: { a2aAgentCard: true, mcpServer: true, oauthCompat: true },
    });
    const card = generateA2AAgentCard(config, "https://api.example.com");

    expect(card.protocols).toContain("agentdoor");
    expect(card.protocols).toContain("a2a");
    expect(card.protocols).toContain("mcp");
    expect(card.protocols).toContain("x402");
    expect(card.authentication.schemes).toContain("x402-wallet");
  });
});

// ---------------------------------------------------------------------------
// serializeA2AAgentCard
// ---------------------------------------------------------------------------

describe("serializeA2AAgentCard", () => {
  it("returns valid JSON string", () => {
    const config = makeConfig();
    const card = generateA2AAgentCard(config, "https://api.example.com");
    const json = serializeA2AAgentCard(card);

    const parsed = JSON.parse(json);
    expect(parsed.name).toBe("Weather API");
  });

  it("produces pretty-printed JSON", () => {
    const config = makeConfig();
    const card = generateA2AAgentCard(config, "https://api.example.com");
    const json = serializeA2AAgentCard(card);

    expect(json).toContain("\n");
    expect(json).toContain("  ");
  });
});

// ---------------------------------------------------------------------------
// getA2AAgentCardHeaders
// ---------------------------------------------------------------------------

describe("getA2AAgentCardHeaders", () => {
  it("returns Content-Type application/json", () => {
    const headers = getA2AAgentCardHeaders();
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("returns Cache-Control header", () => {
    const headers = getA2AAgentCardHeaders();
    expect(headers["Cache-Control"]).toBe("public, max-age=3600");
  });
});

// ---------------------------------------------------------------------------
// validateA2AAgentCard
// ---------------------------------------------------------------------------

describe("validateA2AAgentCard", () => {
  it("validates a correct agent card", () => {
    const config = makeConfig();
    const card = generateA2AAgentCard(config, "https://api.example.com");
    const result = validateA2AAgentCard(card);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects null input", () => {
    const result = validateA2AAgentCard(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects non-object input", () => {
    const result = validateA2AAgentCard("string");
    expect(result.valid).toBe(false);
  });

  it("reports missing name", () => {
    const result = validateA2AAgentCard({
      description: "test",
      url: "https://example.com",
      capabilities: [],
      authentication: { schemes: [] },
      protocols: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("reports missing description", () => {
    const result = validateA2AAgentCard({
      name: "test",
      url: "https://example.com",
      capabilities: [],
      authentication: { schemes: [] },
      protocols: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("description"))).toBe(true);
  });

  it("reports missing url", () => {
    const result = validateA2AAgentCard({
      name: "test",
      description: "test",
      capabilities: [],
      authentication: { schemes: [] },
      protocols: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("url"))).toBe(true);
  });

  it("reports missing capabilities", () => {
    const result = validateA2AAgentCard({
      name: "test",
      description: "test",
      url: "https://example.com",
      authentication: { schemes: [] },
      protocols: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("capabilities"))).toBe(true);
  });

  it("reports missing authentication", () => {
    const result = validateA2AAgentCard({
      name: "test",
      description: "test",
      url: "https://example.com",
      capabilities: [],
      protocols: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("authentication"))).toBe(true);
  });

  it("reports missing protocols", () => {
    const result = validateA2AAgentCard({
      name: "test",
      description: "test",
      url: "https://example.com",
      capabilities: [],
      authentication: { schemes: [] },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("protocols"))).toBe(true);
  });

  it("reports multiple errors at once", () => {
    const result = validateA2AAgentCard({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});
