/**
 * Tests for config template generation.
 *
 * Covers: generateConfigFile, generateDiscoveryJson, generateA2ACard
 */

import { describe, it, expect } from "vitest";
import {
  generateConfigFile,
  generateDiscoveryJson,
  generateA2ACard,
} from "../templates/config.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const basicScopes = [
  { id: "data.read", description: "Read data" },
  { id: "data.write", description: "Write data" },
];

const scopesWithPricing = [
  { id: "data.read", description: "Read data", price: "$0.001/req" },
  { id: "data.write", description: "Write data", price: "$0.01/req" },
];

const scopesWithRateLimit = [
  { id: "data.read", description: "Read data", rateLimit: "500/hour" },
];

const x402Config = {
  network: "base-sepolia",
  currency: "USDC",
  paymentAddress: "0x1234567890abcdef",
  facilitator: "https://x402.org/facilitator",
};

// ---------------------------------------------------------------------------
// generateConfigFile
// ---------------------------------------------------------------------------

describe("generateConfigFile", () => {
  it("generates valid TypeScript config for express framework", () => {
    const content = generateConfigFile({
      framework: "express",
      serviceName: "My API",
      serviceDescription: "A test service",
      scopes: basicScopes,
    });

    expect(content).toContain('@agentgate/express');
    expect(content).toContain("AgentGateConfig");
    expect(content).toContain('serviceName: "My API"');
    expect(content).toContain('serviceDescription: "A test service"');
    expect(content).toContain("export default config");
  });

  it("imports @agentgate/next for nextjs framework", () => {
    const content = generateConfigFile({
      framework: "nextjs",
      serviceName: "Next App",
      serviceDescription: "Next.js service",
      scopes: basicScopes,
    });

    expect(content).toContain('@agentgate/next');
    expect(content).not.toContain("@agentgate/express");
  });

  it("imports @agentgate/hono for hono framework", () => {
    const content = generateConfigFile({
      framework: "hono",
      serviceName: "Hono App",
      serviceDescription: "Hono service",
      scopes: basicScopes,
    });

    expect(content).toContain('@agentgate/hono');
    expect(content).not.toContain("@agentgate/express");
    expect(content).not.toContain("@agentgate/next");
  });

  it("falls back to @agentgate/core for unknown framework", () => {
    const content = generateConfigFile({
      framework: "fastify",
      serviceName: "Fastify App",
      serviceDescription: "Fastify service",
      scopes: basicScopes,
    });

    expect(content).toContain('@agentgate/core');
  });

  it("includes all scope IDs and descriptions", () => {
    const content = generateConfigFile({
      framework: "express",
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
    });

    expect(content).toContain('"data.read"');
    expect(content).toContain('"data.write"');
    expect(content).toContain('"Read data"');
    expect(content).toContain('"Write data"');
  });

  it("includes pricing block when provided", () => {
    const content = generateConfigFile({
      framework: "express",
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
      pricing: {
        "data.read": "$0.001/req",
        "data.write": "$0.01/req",
      },
    });

    expect(content).toContain("pricing:");
    expect(content).toContain('"data.read": "$0.001/req"');
    expect(content).toContain('"data.write": "$0.01/req"');
  });

  it("omits pricing block when not provided", () => {
    const content = generateConfigFile({
      framework: "express",
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
    });

    expect(content).not.toContain("pricing:");
  });

  it("includes x402 block when provided", () => {
    const content = generateConfigFile({
      framework: "express",
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
      x402: x402Config,
    });

    expect(content).toContain("x402:");
    expect(content).toContain('"base-sepolia"');
    expect(content).toContain('"USDC"');
    expect(content).toContain('"0x1234567890abcdef"');
    expect(content).toContain('"https://x402.org/facilitator"');
  });

  it("omits x402 block when not provided", () => {
    const content = generateConfigFile({
      framework: "express",
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
    });

    expect(content).not.toContain("x402:");
  });

  it("includes rateLimit block with default value", () => {
    const content = generateConfigFile({
      framework: "express",
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
    });

    expect(content).toContain("rateLimit:");
    expect(content).toContain('"1000/hour"');
  });

  it("uses custom rateLimit when provided", () => {
    const content = generateConfigFile({
      framework: "express",
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
      rateLimit: { default: "500/hour" },
    });

    expect(content).toContain('"500/hour"');
  });

  it("includes scope-level price and rateLimit when present", () => {
    const content = generateConfigFile({
      framework: "express",
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: [
        { id: "data.read", description: "Read data", price: "$0.001/req", rateLimit: "100/hour" },
      ],
    });

    expect(content).toContain('price: "$0.001/req"');
    expect(content).toContain('rateLimit: "100/hour"');
  });
});

// ---------------------------------------------------------------------------
// generateDiscoveryJson
// ---------------------------------------------------------------------------

describe("generateDiscoveryJson", () => {
  it("returns a proper discovery document structure", () => {
    const doc = generateDiscoveryJson({
      serviceName: "My API",
      serviceDescription: "A test service",
      scopes: basicScopes,
    });

    expect(doc.agentgate_version).toBe("1.0");
    expect(doc.service_name).toBe("My API");
    expect(doc.service_description).toBe("A test service");
    expect(doc.registration_endpoint).toBe("/agentgate/register");
    expect(doc.auth_endpoint).toBe("/agentgate/auth");
  });

  it("includes scopes_available with correct structure", () => {
    const doc = generateDiscoveryJson({
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
    });

    const scopesAvailable = doc.scopes_available as Array<{ id: string; description: string }>;
    expect(scopesAvailable).toHaveLength(2);
    expect(scopesAvailable[0]).toEqual({ id: "data.read", description: "Read data" });
    expect(scopesAvailable[1]).toEqual({ id: "data.write", description: "Write data" });
  });

  it("includes scope prices in scopes_available when provided", () => {
    const doc = generateDiscoveryJson({
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: scopesWithPricing,
    });

    const scopesAvailable = doc.scopes_available as Array<{ id: string; price?: string }>;
    expect(scopesAvailable[0].price).toBe("$0.001/req");
    expect(scopesAvailable[1].price).toBe("$0.01/req");
  });

  it("includes scope rate_limit in scopes_available when provided", () => {
    const doc = generateDiscoveryJson({
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: scopesWithRateLimit,
    });

    const scopesAvailable = doc.scopes_available as Array<{ id: string; rate_limit?: string }>;
    expect(scopesAvailable[0].rate_limit).toBe("500/hour");
  });

  it("includes auth_methods array", () => {
    const doc = generateDiscoveryJson({
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
    });

    expect(doc.auth_methods).toEqual(["ed25519-challenge", "x402-wallet", "jwt"]);
  });

  it("includes rate_limits with default values", () => {
    const doc = generateDiscoveryJson({
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
    });

    const rateLimits = doc.rate_limits as Record<string, string>;
    expect(rateLimits.registration).toBe("10/hour");
    expect(rateLimits.default).toBe("1000/hour");
  });

  it("uses custom rate limit when provided", () => {
    const doc = generateDiscoveryJson({
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
      rateLimit: { default: "2000/hour" },
    });

    const rateLimits = doc.rate_limits as Record<string, string>;
    expect(rateLimits.default).toBe("2000/hour");
  });

  it("includes payment section when x402 is provided", () => {
    const doc = generateDiscoveryJson({
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
      x402: x402Config,
    });

    expect(doc.payment).toBeDefined();
    const payment = doc.payment as Record<string, unknown>;
    expect(payment.protocol).toBe("x402");
    expect(payment.version).toBe("2.0");
    expect(payment.networks).toEqual(["base-sepolia"]);
    expect(payment.currency).toEqual(["USDC"]);
    expect(payment.facilitator).toBe("https://x402.org/facilitator");
  });

  it("uses default facilitator when x402 has no facilitator", () => {
    const doc = generateDiscoveryJson({
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
      x402: {
        network: "base",
        currency: "USDC",
        paymentAddress: "0xabc",
      },
    });

    const payment = doc.payment as Record<string, unknown>;
    expect(payment.facilitator).toBe("https://x402.org/facilitator");
  });

  it("does not include payment section when x402 is not provided", () => {
    const doc = generateDiscoveryJson({
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
    });

    expect(doc.payment).toBeUndefined();
  });

  it("includes companion_protocols section", () => {
    const doc = generateDiscoveryJson({
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
    });

    const companion = doc.companion_protocols as Record<string, string>;
    expect(companion.a2a_agent_card).toBe("/.well-known/agent-card.json");
  });
});

// ---------------------------------------------------------------------------
// generateA2ACard
// ---------------------------------------------------------------------------

describe("generateA2ACard", () => {
  it("returns a proper A2A card structure", () => {
    const card = generateA2ACard({
      serviceName: "My API",
      serviceDescription: "A test service",
      scopes: basicScopes,
    });

    expect(card.name).toBe("My API");
    expect(card.description).toBe("A test service");
    expect(card.url).toBe("https://your-domain.com");
    expect(card.version).toBe("1.0");
  });

  it("includes capabilities section", () => {
    const card = generateA2ACard({
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
    });

    const capabilities = card.capabilities as Record<string, boolean>;
    expect(capabilities.streaming).toBe(false);
    expect(capabilities.pushNotifications).toBe(false);
  });

  it("generates skills from scopes", () => {
    const card = generateA2ACard({
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
    });

    const skills = card.skills as Array<{ id: string; name: string; description: string }>;
    expect(skills).toHaveLength(2);

    expect(skills[0].id).toBe("data.read");
    expect(skills[0].name).toBe("data read");
    expect(skills[0].description).toBe("Read data");

    expect(skills[1].id).toBe("data.write");
    expect(skills[1].name).toBe("data write");
    expect(skills[1].description).toBe("Write data");
  });

  it("includes authentication section with agentgate schemes", () => {
    const card = generateA2ACard({
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
    });

    const auth = card.authentication as Record<string, unknown>;
    expect(auth.schemes).toEqual(["agentgate-ed25519", "bearer"]);

    const agentgate = auth.agentgate as Record<string, string>;
    expect(agentgate.discovery).toBe("/.well-known/agentgate.json");
    expect(agentgate.registration).toBe("/agentgate/register");
  });

  it("includes default input and output modes", () => {
    const card = generateA2ACard({
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: basicScopes,
    });

    expect(card.defaultInputModes).toEqual(["application/json"]);
    expect(card.defaultOutputModes).toEqual(["application/json"]);
  });

  it("handles empty scopes array", () => {
    const card = generateA2ACard({
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: [],
    });

    const skills = card.skills as Array<unknown>;
    expect(skills).toEqual([]);
  });

  it("handles many scopes correctly", () => {
    const manyScopes = [
      { id: "users.read", description: "Read users" },
      { id: "users.write", description: "Write users" },
      { id: "orders.read", description: "Read orders" },
      { id: "orders.write", description: "Write orders" },
      { id: "products.read", description: "Read products" },
    ];

    const card = generateA2ACard({
      serviceName: "Big API",
      serviceDescription: "Large service",
      scopes: manyScopes,
    });

    const skills = card.skills as Array<{ id: string }>;
    expect(skills).toHaveLength(5);
    expect(skills.map((s) => s.id)).toEqual([
      "users.read",
      "users.write",
      "orders.read",
      "orders.write",
      "products.read",
    ]);
  });
});
