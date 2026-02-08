/**
 * Tests for the Agent Registry and Crawler.
 *
 * Uses mocked fetch to simulate discovery document responses.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentRegistry } from "../registry.js";
import { AgentGateCrawler } from "../crawler.js";
import { createRegistryApi } from "../api.js";

// ---------------------------------------------------------------------------
// Mock Discovery Document
// ---------------------------------------------------------------------------

function makeDiscoveryDoc(overrides?: Record<string, unknown>) {
  return {
    agentgate_version: "0.1.0",
    service_name: "Test Service",
    service_description: "A test AgentGate service",
    registration_endpoint: "/agentgate/register",
    auth_endpoint: "/agentgate/auth",
    scopes_available: [
      { id: "data.read", description: "Read data", price: "$0.001/req" },
      { id: "data.write", description: "Write data" },
    ],
    auth_methods: ["challenge-response", "api-key"],
    payment: {
      protocol: "x402",
      version: "1.0",
      networks: ["base"],
      currency: ["USDC"],
      deferred: false,
    },
    rate_limits: {
      registration: "10/hour",
      default: "1000/hour",
    },
    companion_protocols: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fetch Mock
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function mockFetchSuccess(doc: Record<string, unknown>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => doc,
  });
}

function mockFetchFailure(status = 404) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: "Not Found",
    json: async () => ({}),
  });
}

function mockFetchNetworkError() {
  return vi.fn().mockRejectedValue(new Error("Network error"));
}

// ---------------------------------------------------------------------------
// Crawler Tests
// ---------------------------------------------------------------------------

describe("AgentGateCrawler", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should crawl a valid discovery document", async () => {
    const doc = makeDiscoveryDoc();
    globalThis.fetch = mockFetchSuccess(doc);

    const crawler = new AgentGateCrawler({ retryCount: 0 });
    const result = await crawler.crawl("https://example.com");

    expect(result.status).toBe("success");
    expect(result.url).toBe("https://example.com");
    expect(result.discoveryDoc).toBeDefined();
    expect(result.discoveryDoc!.service_name).toBe("Test Service");
    expect(result.lastCrawled).toBeInstanceOf(Date);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://example.com/.well-known/agentgate.json",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/json",
        }),
      }),
    );
  });

  it("should strip trailing slashes from the URL", async () => {
    const doc = makeDiscoveryDoc();
    globalThis.fetch = mockFetchSuccess(doc);

    const crawler = new AgentGateCrawler({ retryCount: 0 });
    const result = await crawler.crawl("https://example.com///");

    expect(result.url).toBe("https://example.com");
    expect(result.status).toBe("success");
  });

  it("should return failed status for HTTP errors", async () => {
    globalThis.fetch = mockFetchFailure(500);

    const crawler = new AgentGateCrawler({ retryCount: 0 });
    const result = await crawler.crawl("https://example.com");

    expect(result.status).toBe("failed");
    expect(result.error).toContain("500");
  });

  it("should return failed status for network errors", async () => {
    globalThis.fetch = mockFetchNetworkError();

    const crawler = new AgentGateCrawler({ retryCount: 0 });
    const result = await crawler.crawl("https://example.com");

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Network error");
  });

  it("should reject invalid discovery documents", async () => {
    globalThis.fetch = mockFetchSuccess({ invalid: true });

    const crawler = new AgentGateCrawler({ retryCount: 0 });
    const result = await crawler.crawl("https://example.com");

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Invalid discovery document");
  });

  it("should retry on failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("Temporary failure"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => makeDiscoveryDoc(),
      });

    globalThis.fetch = fetchMock;

    const crawler = new AgentGateCrawler({ retryCount: 1 });
    const result = await crawler.crawl("https://example.com");

    expect(result.status).toBe("success");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("should crawl batch with concurrency control", async () => {
    const doc = makeDiscoveryDoc();
    globalThis.fetch = mockFetchSuccess(doc);

    const crawler = new AgentGateCrawler({
      maxConcurrency: 2,
      retryCount: 0,
    });
    const results = await crawler.crawlBatch([
      "https://a.com",
      "https://b.com",
      "https://c.com",
    ]);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === "success")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Registry Tests
// ---------------------------------------------------------------------------

describe("AgentRegistry", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry({ retryCount: 0 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should add a service via crawling", async () => {
    const doc = makeDiscoveryDoc();
    globalThis.fetch = mockFetchSuccess(doc);

    const entry = await registry.addService("https://example.com");

    expect(entry.id).toMatch(/^reg_/);
    expect(entry.url).toBe("https://example.com");
    expect(entry.serviceName).toBe("Test Service");
    expect(entry.serviceDescription).toBe("A test AgentGate service");
    expect(entry.scopes).toHaveLength(2);
    expect(entry.authMethods).toContain("challenge-response");
    expect(entry.hasPayment).toBe(true);
    expect(entry.paymentNetwork).toBe("base");
    expect(entry.status).toBe("active");
    expect(entry.lastVerified).toBeInstanceOf(Date);
  });

  it("should throw when crawling fails", async () => {
    globalThis.fetch = mockFetchFailure(404);

    await expect(
      registry.addService("https://nonexistent.com"),
    ).rejects.toThrow("Failed to crawl");
  });

  it("should re-crawl an existing service on re-add", async () => {
    const doc1 = makeDiscoveryDoc({ service_name: "V1" });
    globalThis.fetch = mockFetchSuccess(doc1);
    const entry1 = await registry.addService("https://example.com");

    const doc2 = makeDiscoveryDoc({ service_name: "V2" });
    globalThis.fetch = mockFetchSuccess(doc2);
    const entry2 = await registry.addService("https://example.com");

    expect(entry2.id).toBe(entry1.id);
    expect(entry2.serviceName).toBe("V2");
  });

  it("should remove a service by URL", async () => {
    const doc = makeDiscoveryDoc();
    globalThis.fetch = mockFetchSuccess(doc);

    await registry.addService("https://example.com");
    await registry.removeService("https://example.com");

    const result = await registry.getService("https://example.com");
    expect(result).toBeNull();
  });

  it("should list all services", async () => {
    const doc = makeDiscoveryDoc();
    globalThis.fetch = mockFetchSuccess(doc);

    await registry.addService("https://a.com");
    await registry.addService("https://b.com");

    const all = await registry.listAll();
    expect(all).toHaveLength(2);
  });

  it("should search by query text", async () => {
    globalThis.fetch = mockFetchSuccess(
      makeDiscoveryDoc({ service_name: "Weather API" }),
    );
    await registry.addService("https://weather.com");

    globalThis.fetch = mockFetchSuccess(
      makeDiscoveryDoc({ service_name: "Finance API" }),
    );
    await registry.addService("https://finance.com");

    const results = await registry.search({ query: "weather" });
    expect(results).toHaveLength(1);
    expect(results[0].serviceName).toBe("Weather API");
  });

  it("should search by scope", async () => {
    globalThis.fetch = mockFetchSuccess(
      makeDiscoveryDoc({
        scopes_available: [{ id: "weather.read", description: "Read weather" }],
      }),
    );
    await registry.addService("https://weather.com");

    globalThis.fetch = mockFetchSuccess(
      makeDiscoveryDoc({
        scopes_available: [{ id: "finance.read", description: "Read finance" }],
      }),
    );
    await registry.addService("https://finance.com");

    const results = await registry.search({ scope: "weather.read" });
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://weather.com");
  });

  it("should search by payment availability", async () => {
    globalThis.fetch = mockFetchSuccess(makeDiscoveryDoc());
    await registry.addService("https://paid.com");

    globalThis.fetch = mockFetchSuccess(
      makeDiscoveryDoc({ payment: undefined }),
    );
    await registry.addService("https://free.com");

    const paid = await registry.search({ hasPayment: true });
    expect(paid).toHaveLength(1);
    expect(paid[0].url).toBe("https://paid.com");

    const free = await registry.search({ hasPayment: false });
    expect(free).toHaveLength(1);
    expect(free[0].url).toBe("https://free.com");
  });

  it("should support pagination", async () => {
    const doc = makeDiscoveryDoc();
    globalThis.fetch = mockFetchSuccess(doc);

    for (let i = 0; i < 5; i++) {
      await registry.addService(`https://service-${i}.com`);
    }

    const page1 = await registry.search({ limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);

    const page2 = await registry.search({ limit: 2, offset: 2 });
    expect(page2).toHaveLength(2);

    const page3 = await registry.search({ limit: 2, offset: 4 });
    expect(page3).toHaveLength(1);
  });

  it("should refresh all services", async () => {
    const doc = makeDiscoveryDoc({ service_name: "Original" });
    globalThis.fetch = mockFetchSuccess(doc);
    await registry.addService("https://example.com");

    const updatedDoc = makeDiscoveryDoc({ service_name: "Updated" });
    globalThis.fetch = mockFetchSuccess(updatedDoc);
    await registry.refreshAll();

    const entry = await registry.getService("https://example.com");
    expect(entry!.serviceName).toBe("Updated");
  });

  it("should mark unreachable services during refresh", async () => {
    const doc = makeDiscoveryDoc();
    globalThis.fetch = mockFetchSuccess(doc);
    await registry.addService("https://example.com");

    globalThis.fetch = mockFetchFailure(500);
    await registry.refreshAll();

    const entry = await registry.getService("https://example.com");
    expect(entry!.status).toBe("unreachable");
  });
});

// ---------------------------------------------------------------------------
// API Route Handler Tests
// ---------------------------------------------------------------------------

describe("createRegistryApi", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry({ retryCount: 0 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createMockResponse() {
    const res = {
      statusCode: 200,
      body: null as unknown,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json(data: unknown) {
        res.body = data;
      },
    };
    return res;
  }

  it("should list services via GET handler", async () => {
    const doc = makeDiscoveryDoc();
    globalThis.fetch = mockFetchSuccess(doc);
    await registry.addService("https://example.com");

    const api = createRegistryApi(registry);
    const res = createMockResponse();
    await api.listServices({ query: {} }, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
  });

  it("should get a service by ID via GET handler", async () => {
    const doc = makeDiscoveryDoc();
    globalThis.fetch = mockFetchSuccess(doc);
    const entry = await registry.addService("https://example.com");

    const api = createRegistryApi(registry);
    const res = createMockResponse();
    await api.getService({ params: { id: entry.id } }, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as { success: boolean; data: { id: string } };
    expect(body.data.id).toBe(entry.id);
  });

  it("should return 404 for unknown service ID", async () => {
    const api = createRegistryApi(registry);
    const res = createMockResponse();
    await api.getService({ params: { id: "reg_nonexistent" } }, res);

    expect(res.statusCode).toBe(404);
  });

  it("should add a service via POST handler", async () => {
    const doc = makeDiscoveryDoc();
    globalThis.fetch = mockFetchSuccess(doc);

    const api = createRegistryApi(registry);
    const res = createMockResponse();
    await api.addService({ body: { url: "https://example.com" } }, res);

    expect(res.statusCode).toBe(201);
    const body = res.body as { success: boolean; data: { url: string } };
    expect(body.success).toBe(true);
    expect(body.data.url).toBe("https://example.com");
  });

  it("should reject POST without URL", async () => {
    const api = createRegistryApi(registry);
    const res = createMockResponse();
    await api.addService({ body: {} }, res);

    expect(res.statusCode).toBe(400);
  });

  it("should delete a service via DELETE handler", async () => {
    const doc = makeDiscoveryDoc();
    globalThis.fetch = mockFetchSuccess(doc);
    const entry = await registry.addService("https://example.com");

    const api = createRegistryApi(registry);
    const res = createMockResponse();
    await api.removeService({ params: { id: entry.id } }, res);

    expect(res.statusCode).toBe(200);
    const all = await registry.listAll();
    expect(all).toHaveLength(0);
  });

  it("should return 404 when deleting unknown service", async () => {
    const api = createRegistryApi(registry);
    const res = createMockResponse();
    await api.removeService({ params: { id: "reg_nonexistent" } }, res);

    expect(res.statusCode).toBe(404);
  });
});
