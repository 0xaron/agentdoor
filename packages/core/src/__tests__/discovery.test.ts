import { describe, it, expect } from "vitest";
import {
  generateDiscoveryDocument,
  validateDiscoveryDocument,
  resolveConfig,
} from "../index.js";

function getResolvedConfig() {
  return resolveConfig({
    scopes: [{ id: "test", description: "Test" }],
  });
}

describe("generateDiscoveryDocument", () => {
  it("returns a DiscoveryDocument with required fields", () => {
    const config = getResolvedConfig();
    const doc = generateDiscoveryDocument(config);

    expect(typeof doc.agentgate_version).toBe("string");
    expect(doc.agentgate_version.length).toBeGreaterThan(0);
    expect(typeof doc.service_name).toBe("string");
    expect(typeof doc.registration_endpoint).toBe("string");
    expect(typeof doc.auth_endpoint).toBe("string");
    expect(Array.isArray(doc.scopes_available)).toBe(true);
    expect(doc.scopes_available.length).toBe(1);
    expect(doc.scopes_available[0].id).toBe("test");
    expect(doc.scopes_available[0].description).toBe("Test");
  });

  it("includes auth_methods", () => {
    const config = getResolvedConfig();
    const doc = generateDiscoveryDocument(config);
    expect(Array.isArray(doc.auth_methods)).toBe(true);
    expect(doc.auth_methods.length).toBeGreaterThan(0);
    expect(doc.auth_methods).toContain("jwt");
  });

  it("includes rate_limits", () => {
    const config = getResolvedConfig();
    const doc = generateDiscoveryDocument(config);
    expect(doc.rate_limits).toHaveProperty("registration");
    expect(doc.rate_limits).toHaveProperty("default");
  });

  it("uses the configured service name", () => {
    const config = resolveConfig({
      scopes: [{ id: "data.read", description: "Read data" }],
      service: { name: "My Custom Service" },
    });
    const doc = generateDiscoveryDocument(config);
    expect(doc.service_name).toBe("My Custom Service");
  });
});

describe("validateDiscoveryDocument", () => {
  it("returns valid: true for a well-formed document", () => {
    const config = getResolvedConfig();
    const doc = generateDiscoveryDocument(config);
    const result = validateDiscoveryDocument(doc);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid: false for a non-object", () => {
    const result = validateDiscoveryDocument(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns valid: false when missing required fields", () => {
    const result = validateDiscoveryDocument({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("reports specific missing fields", () => {
    const result = validateDiscoveryDocument({
      agentgate_version: "1.0",
      // missing: service_name, registration_endpoint, auth_endpoint, scopes_available, auth_methods
    });
    expect(result.valid).toBe(false);
    const errorText = result.errors.join(" ");
    expect(errorText).toContain("service_name");
    expect(errorText).toContain("registration_endpoint");
  });
});
