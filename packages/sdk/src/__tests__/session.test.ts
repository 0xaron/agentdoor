import { describe, it, expect } from "vitest";
import { Session, SessionError } from "../session.js";
import type { ServiceCredentials } from "../credentials.js";
import type { AgentDoorDiscoveryDocument } from "../discovery.js";

/** Minimal valid discovery document for Session construction. */
const mockDiscovery: AgentDoorDiscoveryDocument = {
  agentdoor_version: "1.0",
  service_name: "Test Service",
  registration_endpoint: "/agentdoor/register",
  auth_endpoint: "/agentdoor/auth",
  scopes_available: [{ id: "test.read", description: "Read test data" }],
};

/** Minimal valid credentials for Session construction. */
function makeCreds(overrides: Partial<ServiceCredentials> = {}): ServiceCredentials {
  return {
    agentId: "ag_test123",
    apiKey: "agk_live_testkey",
    scopesGranted: ["test.read"],
    storedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock fetch that returns a fixed response.
 * Captures the request URL and init for assertions.
 */
function createMockFetch(
  status: number,
  data: unknown,
): {
  fetchFn: typeof globalThis.fetch;
  getCapturedUrl: () => string | undefined;
  getCapturedInit: () => RequestInit | undefined;
} {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  const fetchFn: typeof globalThis.fetch = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    capturedUrl = typeof url === "string" ? url : url.toString();
    capturedInit = init;
    return new Response(JSON.stringify(data), {
      status,
      statusText: status >= 200 && status < 300 ? "OK" : "Error",
      headers: { "Content-Type": "application/json" },
    });
  };

  return {
    fetchFn,
    getCapturedUrl: () => capturedUrl,
    getCapturedInit: () => capturedInit,
  };
}

describe("Session.get", () => {
  it("makes a GET request with Authorization header", async () => {
    const { fetchFn, getCapturedUrl, getCapturedInit } = createMockFetch(200, {
      message: "ok",
    });

    const session = new Session({
      baseUrl: "https://api.test.com",
      credentials: makeCreds(),
      discovery: mockDiscovery,
      fetchFn,
    });

    const response = await session.get("/data");

    expect(getCapturedUrl()).toBe("https://api.test.com/data");
    expect(getCapturedInit()?.method).toBe("GET");

    const headers = getCapturedInit()?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer agk_live_testkey");
  });

  it("returns a SessionResponse with parsed JSON data", async () => {
    const responseData = { items: [1, 2, 3], total: 3 };
    const { fetchFn } = createMockFetch(200, responseData);

    const session = new Session({
      baseUrl: "https://api.test.com",
      credentials: makeCreds(),
      discovery: mockDiscovery,
      fetchFn,
    });

    const response = await session.get("/items");

    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    expect(response.data).toEqual(responseData);
  });

  it("prefers JWT token over API key for Authorization header", async () => {
    const { fetchFn, getCapturedInit } = createMockFetch(200, { ok: true });

    const session = new Session({
      baseUrl: "https://api.test.com",
      credentials: makeCreds({
        token: "jwt.token.here",
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
      discovery: mockDiscovery,
      fetchFn,
    });

    await session.get("/data");

    const headers = getCapturedInit()?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer jwt.token.here");
  });

  it("appends query parameters to the URL", async () => {
    const { fetchFn, getCapturedUrl } = createMockFetch(200, { ok: true });

    const session = new Session({
      baseUrl: "https://api.test.com",
      credentials: makeCreds(),
      discovery: mockDiscovery,
      fetchFn,
    });

    await session.get("/search", { params: { q: "hello", page: "1" } });

    const url = getCapturedUrl()!;
    expect(url).toContain("q=hello");
    expect(url).toContain("page=1");
  });
});

describe("Session.post", () => {
  it("sends a POST request with JSON body", async () => {
    const { fetchFn, getCapturedInit } = createMockFetch(201, {
      id: "new_item",
    });

    const session = new Session({
      baseUrl: "https://api.test.com",
      credentials: makeCreds(),
      discovery: mockDiscovery,
      fetchFn,
    });

    const response = await session.post("/items", {
      body: { name: "Test Item", value: 42 },
    });

    expect(getCapturedInit()?.method).toBe("POST");
    expect(getCapturedInit()?.body).toBe(
      JSON.stringify({ name: "Test Item", value: 42 }),
    );

    const headers = getCapturedInit()?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");

    expect(response.status).toBe(201);
  });

  it("includes Authorization header on POST requests", async () => {
    const { fetchFn, getCapturedInit } = createMockFetch(200, { ok: true });

    const session = new Session({
      baseUrl: "https://api.test.com",
      credentials: makeCreds({ apiKey: "agk_post_key" }),
      discovery: mockDiscovery,
      fetchFn,
    });

    await session.post("/action", { body: { action: "run" } });

    const headers = getCapturedInit()?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer agk_post_key");
  });
});

describe("Session - URL construction", () => {
  it("constructs correct URL from base URL and path", async () => {
    const { fetchFn, getCapturedUrl } = createMockFetch(200, {});

    const session = new Session({
      baseUrl: "https://api.test.com",
      credentials: makeCreds(),
      discovery: mockDiscovery,
      fetchFn,
    });

    await session.get("/v1/data/items");

    expect(getCapturedUrl()).toBe("https://api.test.com/v1/data/items");
  });

  it("handles path without leading slash", async () => {
    const { fetchFn, getCapturedUrl } = createMockFetch(200, {});

    const session = new Session({
      baseUrl: "https://api.test.com",
      credentials: makeCreds(),
      discovery: mockDiscovery,
      fetchFn,
    });

    await session.get("v1/data");

    expect(getCapturedUrl()).toBe("https://api.test.com/v1/data");
  });

  it("properly encodes query parameters", async () => {
    const { fetchFn, getCapturedUrl } = createMockFetch(200, {});

    const session = new Session({
      baseUrl: "https://api.test.com",
      credentials: makeCreds(),
      discovery: mockDiscovery,
      fetchFn,
    });

    await session.get("/search", {
      params: { q: "hello world", filter: "a&b" },
    });

    const url = getCapturedUrl()!;
    // URL constructor encodes spaces and special characters
    expect(url).toContain("q=hello+world");
    expect(url).toContain("filter=a%26b");
  });
});

describe("Session - 401 token refresh", () => {
  it("triggers token refresh callback on 401 response", async () => {
    let refreshCalled = false;
    let requestCount = 0;

    const fetchFn: typeof globalThis.fetch = async (
      _url: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      requestCount++;
      if (requestCount === 1) {
        // First request returns 401
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          statusText: "Unauthorized",
          headers: { "Content-Type": "application/json" },
        });
      }
      // Retry after refresh returns 200
      return new Response(JSON.stringify({ data: "success" }), {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "application/json" },
      });
    };

    const session = new Session({
      baseUrl: "https://api.test.com",
      credentials: makeCreds({
        token: "expired.token",
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
      discovery: mockDiscovery,
      fetchFn,
      onTokenRefresh: async () => {
        refreshCalled = true;
        return {
          token: "new.fresh.token",
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        };
      },
    });

    const response = await session.get("/protected");

    expect(refreshCalled).toBe(true);
    expect(requestCount).toBe(2);
    expect(response.ok).toBe(true);
    expect(response.data).toEqual({ data: "success" });
  });

  it("does not trigger refresh when no onTokenRefresh callback is set", async () => {
    const { fetchFn } = createMockFetch(401, { error: "unauthorized" });

    const session = new Session({
      baseUrl: "https://api.test.com",
      credentials: makeCreds(),
      discovery: mockDiscovery,
      fetchFn,
      // No onTokenRefresh callback
    });

    const response = await session.get("/protected");

    // Should return the 401 response as-is
    expect(response.status).toBe(401);
    expect(response.ok).toBe(false);
  });
});

describe("Session - other HTTP methods", () => {
  it("Session.put sends PUT request", async () => {
    const { fetchFn, getCapturedInit } = createMockFetch(200, { updated: true });

    const session = new Session({
      baseUrl: "https://api.test.com",
      credentials: makeCreds(),
      discovery: mockDiscovery,
      fetchFn,
    });

    await session.put("/items/1", { body: { name: "Updated" } });

    expect(getCapturedInit()?.method).toBe("PUT");
  });

  it("Session.delete sends DELETE request", async () => {
    const { fetchFn, getCapturedInit } = createMockFetch(200, { deleted: true });

    const session = new Session({
      baseUrl: "https://api.test.com",
      credentials: makeCreds(),
      discovery: mockDiscovery,
      fetchFn,
    });

    await session.delete("/items/1");

    expect(getCapturedInit()?.method).toBe("DELETE");
  });

  it("Session.patch sends PATCH request", async () => {
    const { fetchFn, getCapturedInit } = createMockFetch(200, { patched: true });

    const session = new Session({
      baseUrl: "https://api.test.com",
      credentials: makeCreds(),
      discovery: mockDiscovery,
      fetchFn,
    });

    await session.patch("/items/1", { body: { name: "Patched" } });

    expect(getCapturedInit()?.method).toBe("PATCH");
  });
});

describe("Session - public properties", () => {
  it("exposes baseUrl, scopes, agentId, and discovery", () => {
    const { fetchFn } = createMockFetch(200, {});

    const creds = makeCreds({
      agentId: "ag_public_test",
      scopesGranted: ["read", "write"],
    });

    const session = new Session({
      baseUrl: "https://api.test.com",
      credentials: creds,
      discovery: mockDiscovery,
      fetchFn,
    });

    expect(session.baseUrl).toBe("https://api.test.com");
    expect(session.agentId).toBe("ag_public_test");
    expect(session.scopes).toEqual(["read", "write"]);
    expect(session.discovery).toBe(mockDiscovery);
  });
});

describe("Session - custom headers", () => {
  it("merges custom headers with default headers", async () => {
    const { fetchFn, getCapturedInit } = createMockFetch(200, {});

    const session = new Session({
      baseUrl: "https://api.test.com",
      credentials: makeCreds(),
      discovery: mockDiscovery,
      fetchFn,
    });

    await session.get("/data", {
      headers: { "X-Custom-Header": "custom-value" },
    });

    const headers = getCapturedInit()?.headers as Record<string, string>;
    expect(headers["X-Custom-Header"]).toBe("custom-value");
    expect(headers["Authorization"]).toBe("Bearer agk_live_testkey");
    expect(headers["User-Agent"]).toBe("agentdoor-sdk/0.1.0");
  });
});

describe("SessionError", () => {
  it("has name, message, and statusCode properties", () => {
    const error = new SessionError("test error message", 503);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SessionError);
    expect(error.name).toBe("SessionError");
    expect(error.message).toBe("test error message");
    expect(error.statusCode).toBe(503);
  });
});

describe("Session - non-JSON response", () => {
  it("returns text data when response is not JSON", async () => {
    const fetchFn: typeof globalThis.fetch = async (
      _url: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      return new Response("plain text response", {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "text/plain" },
      });
    };

    const session = new Session({
      baseUrl: "https://api.test.com",
      credentials: makeCreds(),
      discovery: mockDiscovery,
      fetchFn,
    });

    const response = await session.get("/text");

    expect(response.status).toBe(200);
    expect(response.data).toBe("plain text response");
  });
});
