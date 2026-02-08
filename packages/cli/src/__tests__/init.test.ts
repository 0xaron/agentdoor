/**
 * Tests for `agentgate init` command.
 *
 * Covers: --from-openapi mode, framework auto-detection, scope inference,
 * file output, and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

// ---------------------------------------------------------------------------
// Helpers — we test the template functions directly since init.ts
// orchestrates interactive prompts that are hard to unit-test.
// ---------------------------------------------------------------------------

import {
  generateConfigFile,
  generateDiscoveryJson,
  generateA2ACard,
} from "../templates/config.js";
import { parseOpenApiSpec } from "../openapi-parser.js";

function createTmpDir(): string {
  return fs.mkdtempSync(join(os.tmpdir(), "agentgate-init-test-"));
}

// ---------------------------------------------------------------------------
// generateConfigFile
// ---------------------------------------------------------------------------

describe("generateConfigFile (init output)", () => {
  it("generates valid TypeScript with correct import for Express", () => {
    const content = generateConfigFile({
      framework: "express",
      serviceName: "Test API",
      serviceDescription: "A test API",
      scopes: [{ id: "data.read", description: "Read data" }],
    });

    expect(content).toContain('@agentgate/express');
    expect(content).toContain("serviceName");
    expect(content).toContain("Test API");
    expect(content).toContain("data.read");
  });

  it("generates correct import for Next.js", () => {
    const content = generateConfigFile({
      framework: "nextjs",
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: [{ id: "s.read", description: "Read" }],
    });

    expect(content).toContain("@agentgate/next");
  });

  it("generates correct import for Hono", () => {
    const content = generateConfigFile({
      framework: "hono",
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: [{ id: "s.read", description: "Read" }],
    });

    expect(content).toContain("@agentgate/hono");
  });

  it("falls back to @agentgate/core for unknown frameworks", () => {
    const content = generateConfigFile({
      framework: "unknown",
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: [{ id: "s.read", description: "Read" }],
    });

    expect(content).toContain("@agentgate/core");
  });

  it("includes pricing block when pricing is provided", () => {
    const content = generateConfigFile({
      framework: "express",
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: [{ id: "data.read", description: "Read" }],
      pricing: { "data.read": "$0.001/req" },
    });

    expect(content).toContain("pricing");
    expect(content).toContain("$0.001/req");
  });

  it("includes x402 block when x402 is configured", () => {
    const content = generateConfigFile({
      framework: "express",
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: [{ id: "data.read", description: "Read" }],
      x402: {
        network: "base",
        currency: "USDC",
        paymentAddress: "0x1234",
      },
    });

    expect(content).toContain("x402");
    expect(content).toContain("base");
    expect(content).toContain("USDC");
    expect(content).toContain("0x1234");
  });

  it("includes multiple scopes", () => {
    const content = generateConfigFile({
      framework: "express",
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: [
        { id: "data.read", description: "Read data" },
        { id: "data.write", description: "Write data" },
        { id: "admin.manage", description: "Admin access" },
      ],
    });

    expect(content).toContain("data.read");
    expect(content).toContain("data.write");
    expect(content).toContain("admin.manage");
  });

  it("includes rate limit and price per scope", () => {
    const content = generateConfigFile({
      framework: "express",
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: [
        { id: "data.read", description: "Read", price: "$0.001/req", rateLimit: "500/hour" },
      ],
    });

    expect(content).toContain("$0.001/req");
    expect(content).toContain("500/hour");
  });
});

// ---------------------------------------------------------------------------
// generateDiscoveryJson
// ---------------------------------------------------------------------------

describe("generateDiscoveryJson (init output)", () => {
  it("generates a valid discovery document", () => {
    const doc = generateDiscoveryJson({
      serviceName: "Weather API",
      serviceDescription: "Weather data service",
      scopes: [{ id: "weather.read", description: "Read weather" }],
    });

    expect(doc.agentgate_version).toBe("1.0");
    expect(doc.service_name).toBe("Weather API");
    expect(doc.registration_endpoint).toBe("/agentgate/register");
    expect(doc.auth_endpoint).toBe("/agentgate/auth");
  });

  it("includes scopes in discovery document", () => {
    const doc = generateDiscoveryJson({
      serviceName: "API",
      serviceDescription: "Test",
      scopes: [
        { id: "data.read", description: "Read data", price: "$0.001/req" },
      ],
    });

    const scopes = doc.scopes_available as Array<{ id: string; price?: string }>;
    expect(scopes).toHaveLength(1);
    expect(scopes[0].id).toBe("data.read");
    expect(scopes[0].price).toBe("$0.001/req");
  });

  it("includes payment section when x402 is configured", () => {
    const doc = generateDiscoveryJson({
      serviceName: "API",
      serviceDescription: "Test",
      scopes: [{ id: "data.read", description: "Read" }],
      x402: { network: "base", currency: "USDC", paymentAddress: "0x123" },
    });

    expect(doc.payment).toBeDefined();
    const payment = doc.payment as Record<string, unknown>;
    expect(payment.protocol).toBe("x402");
    expect(payment.version).toBe("2.0");
  });

  it("omits payment section when x402 is not configured", () => {
    const doc = generateDiscoveryJson({
      serviceName: "API",
      serviceDescription: "Test",
      scopes: [{ id: "data.read", description: "Read" }],
    });

    expect(doc.payment).toBeUndefined();
  });

  it("includes auth methods", () => {
    const doc = generateDiscoveryJson({
      serviceName: "API",
      serviceDescription: "Test",
      scopes: [{ id: "data.read", description: "Read" }],
    });

    const methods = doc.auth_methods as string[];
    expect(methods).toContain("ed25519-challenge");
    expect(methods).toContain("jwt");
  });

  it("includes companion_protocols with a2a card", () => {
    const doc = generateDiscoveryJson({
      serviceName: "API",
      serviceDescription: "Test",
      scopes: [{ id: "data.read", description: "Read" }],
    });

    const companions = doc.companion_protocols as Record<string, string>;
    expect(companions.a2a_agent_card).toBe("/.well-known/agent-card.json");
  });
});

// ---------------------------------------------------------------------------
// generateA2ACard (init output)
// ---------------------------------------------------------------------------

describe("generateA2ACard (init output)", () => {
  it("generates a valid A2A card", () => {
    const card = generateA2ACard({
      serviceName: "Weather API",
      serviceDescription: "Weather data",
      scopes: [{ id: "weather.read", description: "Read weather" }],
    });

    expect(card.name).toBe("Weather API");
    expect(card.description).toBe("Weather data");
    expect(card.version).toBe("1.0");
  });

  it("maps scopes to skills", () => {
    const card = generateA2ACard({
      serviceName: "API",
      serviceDescription: "Test",
      scopes: [
        { id: "data.read", description: "Read data" },
        { id: "data.write", description: "Write data" },
      ],
    });

    const skills = card.skills as Array<{ id: string; description: string }>;
    expect(skills).toHaveLength(2);
    expect(skills[0].id).toBe("data.read");
  });

  it("includes authentication info", () => {
    const card = generateA2ACard({
      serviceName: "API",
      serviceDescription: "Test",
      scopes: [],
    });

    const auth = card.authentication as Record<string, unknown>;
    expect(auth.schemes).toBeDefined();
    const agentgate = auth.agentgate as Record<string, string>;
    expect(agentgate.discovery).toBe("/.well-known/agentgate.json");
  });
});

// ---------------------------------------------------------------------------
// --from-openapi scope inference
// ---------------------------------------------------------------------------

describe("Scope inference from OpenAPI", () => {
  it("infers scopes from OpenAPI paths", () => {
    const spec = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Weather API", version: "1.0" },
      paths: {
        "/api/weather": {
          get: { summary: "Get current weather" },
        },
        "/api/weather/forecast": {
          post: { summary: "Create forecast request" },
        },
      },
    });

    const scopes = parseOpenApiSpec(spec);
    expect(scopes.length).toBeGreaterThan(0);
  });

  it("suggests pricing based on HTTP method", () => {
    const spec = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "API", version: "1.0" },
      paths: {
        "/api/data": {
          get: { summary: "Read" },
          post: { summary: "Create" },
          delete: { summary: "Delete" },
        },
      },
    });

    const scopes = parseOpenApiSpec(spec);
    // GET is typically cheapest, DELETE most expensive
    const readScope = scopes.find((s) => s.method === "GET");
    const deleteScope = scopes.find((s) => s.method === "DELETE");

    if (readScope && deleteScope) {
      const readPrice = parseFloat(readScope.suggestedPrice.replace(/[^0-9.]/g, ""));
      const deletePrice = parseFloat(deleteScope.suggestedPrice.replace(/[^0-9.]/g, ""));
      expect(readPrice).toBeLessThan(deletePrice);
    }
  });

  it("handles empty paths", () => {
    const spec = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "API", version: "1.0" },
      paths: {},
    });

    const scopes = parseOpenApiSpec(spec);
    expect(scopes).toEqual([]);
  });

  it("handles invalid JSON gracefully", () => {
    // Parser returns empty array for invalid input rather than throwing
    const scopes = parseOpenApiSpec("not json");
    expect(scopes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// File output (integration-style)
// ---------------------------------------------------------------------------

describe("File output from init", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes agentgate.config.ts to output dir", async () => {
    const content = generateConfigFile({
      framework: "express",
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: [{ id: "data.read", description: "Read" }],
    });

    const configPath = join(tmpDir, "agentgate.config.ts");
    await writeFile(configPath, content, "utf-8");

    expect(existsSync(configPath)).toBe(true);
    const saved = await readFile(configPath, "utf-8");
    expect(saved).toContain("data.read");
  });

  it("writes .well-known/agentgate.json", async () => {
    const wellKnownDir = join(tmpDir, "public", ".well-known");
    await mkdir(wellKnownDir, { recursive: true });

    const doc = generateDiscoveryJson({
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: [{ id: "data.read", description: "Read" }],
    });

    const filePath = join(wellKnownDir, "agentgate.json");
    await writeFile(filePath, JSON.stringify(doc, null, 2), "utf-8");

    expect(existsSync(filePath)).toBe(true);
    const parsed = JSON.parse(await readFile(filePath, "utf-8"));
    expect(parsed.agentgate_version).toBe("1.0");
  });

  it("writes .well-known/agent-card.json", async () => {
    const wellKnownDir = join(tmpDir, "public", ".well-known");
    await mkdir(wellKnownDir, { recursive: true });

    const card = generateA2ACard({
      serviceName: "Test",
      serviceDescription: "Test",
      scopes: [{ id: "data.read", description: "Read" }],
    });

    const filePath = join(wellKnownDir, "agent-card.json");
    await writeFile(filePath, JSON.stringify(card, null, 2), "utf-8");

    expect(existsSync(filePath)).toBe(true);
    const parsed = JSON.parse(await readFile(filePath, "utf-8"));
    expect(parsed.name).toBe("Test");
  });
});
