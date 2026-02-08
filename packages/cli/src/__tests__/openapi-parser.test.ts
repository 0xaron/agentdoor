/**
 * Tests for the OpenAPI spec parser.
 *
 * Covers: JSON parsing, YAML parsing, scope inference, pricing heuristics,
 * path grouping, deduplication, sorting, and edge cases.
 */

import { describe, it, expect } from "vitest";
import { parseOpenApiSpec } from "../openapi-parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJsonSpec(
  paths: Record<string, Record<string, { summary?: string; description?: string }>>,
): string {
  return JSON.stringify({
    openapi: "3.0.0",
    info: { title: "Test API", version: "1.0" },
    paths,
  });
}

// ---------------------------------------------------------------------------
// Basic JSON parsing
// ---------------------------------------------------------------------------

describe("parseOpenApiSpec", () => {
  it("parses a JSON spec with GET and POST endpoints", () => {
    const spec = makeJsonSpec({
      "/api/weather": {
        get: { summary: "Get weather data" },
      },
      "/api/weather/forecast": {
        post: { summary: "Create forecast" },
      },
    });

    const scopes = parseOpenApiSpec(spec);

    expect(scopes).toHaveLength(2);
    expect(scopes.find((s) => s.id === "weather.read")).toBeDefined();
    expect(scopes.find((s) => s.id === "weather.write")).toBeDefined();
  });

  it("generates correct scope IDs for multiple paths and methods", () => {
    const spec = makeJsonSpec({
      "/api/users": {
        get: { summary: "List users" },
        post: { summary: "Create user" },
      },
      "/api/users/{id}": {
        put: { summary: "Update user" },
        delete: { summary: "Remove user" },
      },
    });

    const scopes = parseOpenApiSpec(spec);

    expect(scopes).toHaveLength(3);
    expect(scopes.find((s) => s.id === "users.read")).toBeDefined();
    expect(scopes.find((s) => s.id === "users.write")).toBeDefined();
    expect(scopes.find((s) => s.id === "users.delete")).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Pricing suggestions
  // -------------------------------------------------------------------------

  describe("pricing suggestions", () => {
    it("suggests $0.001/req for GET", () => {
      const spec = makeJsonSpec({
        "/data": { get: { summary: "Read data" } },
      });
      const scopes = parseOpenApiSpec(spec);
      expect(scopes[0].suggestedPrice).toBe("$0.001/req");
    });

    it("suggests $0.01/req for POST", () => {
      const spec = makeJsonSpec({
        "/data": { post: { summary: "Create data" } },
      });
      const scopes = parseOpenApiSpec(spec);
      expect(scopes[0].suggestedPrice).toBe("$0.01/req");
    });

    it("suggests $0.005/req for PUT", () => {
      const spec = makeJsonSpec({
        "/data": { put: { summary: "Update data" } },
      });
      const scopes = parseOpenApiSpec(spec);
      expect(scopes[0].suggestedPrice).toBe("$0.005/req");
    });

    it("suggests $0.02/req for DELETE", () => {
      const spec = makeJsonSpec({
        "/data": { delete: { summary: "Delete data" } },
      });
      const scopes = parseOpenApiSpec(spec);
      expect(scopes[0].suggestedPrice).toBe("$0.02/req");
    });

    it("suggests $0.005/req for PATCH", () => {
      const spec = makeJsonSpec({
        "/data": { patch: { summary: "Patch data" } },
      });
      const scopes = parseOpenApiSpec(spec);
      expect(scopes[0].suggestedPrice).toBe("$0.005/req");
    });
  });

  // -------------------------------------------------------------------------
  // Path grouping
  // -------------------------------------------------------------------------

  describe("path grouping", () => {
    it("strips /api prefix from paths", () => {
      const spec = makeJsonSpec({
        "/api/weather": { get: { summary: "Weather" } },
      });
      const scopes = parseOpenApiSpec(spec);
      expect(scopes[0].id).toBe("weather.read");
    });

    it("strips /api/v1 prefix from paths", () => {
      const spec = makeJsonSpec({
        "/api/v1/weather": { get: { summary: "Weather" } },
      });
      const scopes = parseOpenApiSpec(spec);
      expect(scopes[0].id).toBe("weather.read");
    });

    it("strips /v2 prefix from paths", () => {
      const spec = makeJsonSpec({
        "/v2/orders": { get: { summary: "Get orders" } },
      });
      const scopes = parseOpenApiSpec(spec);
      expect(scopes[0].id).toBe("orders.read");
    });

    it("groups sub-paths under the first meaningful segment", () => {
      const spec = makeJsonSpec({
        "/api/weather": { get: { summary: "Current weather" } },
        "/api/weather/forecast": { get: { summary: "Forecast" } },
        "/api/weather/historical": { get: { summary: "Historical" } },
      });
      const scopes = parseOpenApiSpec(spec);
      // All three GET paths map to weather.read
      expect(scopes).toHaveLength(1);
      expect(scopes[0].id).toBe("weather.read");
    });

    it("uses 'root' group when path has no meaningful segments", () => {
      const spec = makeJsonSpec({
        "/": { get: { summary: "Root" } },
      });
      const scopes = parseOpenApiSpec(spec);
      expect(scopes[0].id).toBe("root.read");
    });

    it("uses 'root' group when path only has api/version prefixes", () => {
      const spec = makeJsonSpec({
        "/api/v1": { get: { summary: "API root" } },
      });
      const scopes = parseOpenApiSpec(spec);
      expect(scopes[0].id).toBe("root.read");
    });
  });

  // -------------------------------------------------------------------------
  // Multiple methods on same group
  // -------------------------------------------------------------------------

  describe("scope deduplication", () => {
    it("merges multiple methods into a single scope per action", () => {
      const spec = makeJsonSpec({
        "/api/products": { get: { summary: "List products" } },
        "/api/products/{id}": { get: { summary: "Get product" } },
      });
      const scopes = parseOpenApiSpec(spec);
      // Both GETs on /products should produce one products.read scope
      expect(scopes).toHaveLength(1);
      expect(scopes[0].id).toBe("products.read");
    });

    it("merges POST and PUT into a single write scope", () => {
      const spec = makeJsonSpec({
        "/api/items": { post: { summary: "Create item" } },
        "/api/items/{id}": { put: { summary: "Update item" } },
      });
      const scopes = parseOpenApiSpec(spec);
      const writeScope = scopes.find((s) => s.id === "items.write");
      expect(writeScope).toBeDefined();
      // Method field should contain both methods
      expect(writeScope!.method).toContain("POST");
      expect(writeScope!.method).toContain("PUT");
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    it("returns empty array for empty string", () => {
      expect(parseOpenApiSpec("")).toEqual([]);
    });

    it("returns empty array for invalid JSON/YAML", () => {
      expect(parseOpenApiSpec("not valid json or yaml {{{")).toEqual([]);
    });

    it("returns empty array for valid JSON with no paths", () => {
      const spec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Empty", version: "1.0" },
      });
      expect(parseOpenApiSpec(spec)).toEqual([]);
    });

    it("returns empty array for spec with empty paths object", () => {
      const spec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Empty", version: "1.0" },
        paths: {},
      });
      expect(parseOpenApiSpec(spec)).toEqual([]);
    });

    it("ignores non-HTTP-method keys in path objects", () => {
      const spec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Test", version: "1.0" },
        paths: {
          "/api/data": {
            get: { summary: "Get data" },
            parameters: [{ name: "id", in: "query" }],
          },
        },
      });
      const scopes = parseOpenApiSpec(spec);
      expect(scopes).toHaveLength(1);
      expect(scopes[0].id).toBe("data.read");
    });
  });

  // -------------------------------------------------------------------------
  // Descriptions
  // -------------------------------------------------------------------------

  describe("descriptions", () => {
    it("uses operation summary as description when available", () => {
      const spec = makeJsonSpec({
        "/api/weather": { get: { summary: "Get current weather conditions" } },
      });
      const scopes = parseOpenApiSpec(spec);
      expect(scopes[0].description).toBe("Get current weather conditions");
    });

    it("auto-generates description when no summary provided", () => {
      const spec = makeJsonSpec({
        "/api/weather": { get: {} },
      });
      const scopes = parseOpenApiSpec(spec);
      // Auto-generated: "Read weather data"
      expect(scopes[0].description).toContain("Read");
      expect(scopes[0].description).toContain("weather");
    });

    it("uses description field as fallback when summary is missing", () => {
      const spec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Test", version: "1.0" },
        paths: {
          "/api/weather": {
            get: { description: "Returns current weather data\nWith details" },
          },
        },
      });
      const scopes = parseOpenApiSpec(spec);
      // Should use first line of description
      expect(scopes[0].description).toBe("Returns current weather data");
    });

    it("auto-generates write description for POST without summary", () => {
      const spec = makeJsonSpec({
        "/api/orders": { post: {} },
      });
      const scopes = parseOpenApiSpec(spec);
      expect(scopes[0].description).toContain("Write");
      expect(scopes[0].description).toContain("orders");
    });
  });

  // -------------------------------------------------------------------------
  // YAML parsing
  // -------------------------------------------------------------------------

  describe("YAML parsing", () => {
    it("parses a simple YAML spec", () => {
      const yaml = `openapi: "3.0.0"
info:
  title: Weather API
  version: "1.0"
paths:
  /api/weather:
    get:
      summary: Get weather data
  /api/weather/forecast:
    post:
      summary: Create forecast`;

      const scopes = parseOpenApiSpec(yaml);

      expect(scopes).toHaveLength(2);
      expect(scopes.find((s) => s.id === "weather.read")).toBeDefined();
      expect(scopes.find((s) => s.id === "weather.write")).toBeDefined();
    });

    it("handles YAML with quoted string values", () => {
      const yaml = `openapi: "3.0.0"
info:
  title: "My Service"
  version: "2.0"
paths:
  /api/data:
    get:
      summary: "Retrieve all data"`;

      const scopes = parseOpenApiSpec(yaml);

      expect(scopes).toHaveLength(1);
      expect(scopes[0].id).toBe("data.read");
      expect(scopes[0].description).toBe("Retrieve all data");
    });

    it("handles YAML with multiple methods under one path", () => {
      const yaml = `openapi: "3.0.0"
info:
  title: Test
  version: "1.0"
paths:
  /api/items:
    get:
      summary: List items
    post:
      summary: Create item
    delete:
      summary: Remove item`;

      const scopes = parseOpenApiSpec(yaml);

      expect(scopes).toHaveLength(3);
      expect(scopes.find((s) => s.id === "items.read")).toBeDefined();
      expect(scopes.find((s) => s.id === "items.write")).toBeDefined();
      expect(scopes.find((s) => s.id === "items.delete")).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Sorting
  // -------------------------------------------------------------------------

  describe("sorting", () => {
    it("returns scopes sorted alphabetically by ID", () => {
      const spec = makeJsonSpec({
        "/api/zebra": { get: { summary: "Zebra" } },
        "/api/alpha": { get: { summary: "Alpha" } },
        "/api/middle": { get: { summary: "Middle" } },
      });
      const scopes = parseOpenApiSpec(spec);
      const ids = scopes.map((s) => s.id);
      expect(ids).toEqual(["alpha.read", "middle.read", "zebra.read"]);
    });

    it("sorts mixed action scopes correctly", () => {
      const spec = makeJsonSpec({
        "/api/data": {
          delete: { summary: "Delete data" },
          post: { summary: "Create data" },
          get: { summary: "Read data" },
        },
      });
      const scopes = parseOpenApiSpec(spec);
      const ids = scopes.map((s) => s.id);
      expect(ids).toEqual(["data.delete", "data.read", "data.write"]);
    });
  });

  // -------------------------------------------------------------------------
  // Path pattern and method fields
  // -------------------------------------------------------------------------

  describe("output fields", () => {
    it("sets pathPattern to the single path when only one exists", () => {
      const spec = makeJsonSpec({
        "/api/v1/weather": { get: { summary: "Weather" } },
      });
      const scopes = parseOpenApiSpec(spec);
      expect(scopes[0].pathPattern).toBe("/api/v1/weather");
    });

    it("sets pathPattern to common prefix with wildcard for multiple paths", () => {
      const spec = makeJsonSpec({
        "/api/weather": { get: { summary: "Current" } },
        "/api/weather/forecast": { get: { summary: "Forecast" } },
      });
      const scopes = parseOpenApiSpec(spec);
      // commonPrefix trims to last complete segment: /api/weather and /api/weather/forecast → /api/
      expect(scopes[0].pathPattern).toContain("/api/");
      expect(scopes[0].pathPattern).toContain("*");
    });

    it("sets method field to the HTTP method used", () => {
      const spec = makeJsonSpec({
        "/api/items": { get: { summary: "Get items" } },
      });
      const scopes = parseOpenApiSpec(spec);
      expect(scopes[0].method).toBe("GET");
    });

    it("joins multiple methods with slash", () => {
      const spec = makeJsonSpec({
        "/api/items": { post: { summary: "Create" } },
        "/api/items/{id}": { put: { summary: "Update" } },
      });
      const scopes = parseOpenApiSpec(spec);
      const writeScope = scopes.find((s) => s.id === "items.write");
      expect(writeScope!.method).toMatch(/POST\/PUT|PUT\/POST/);
    });
  });
});
