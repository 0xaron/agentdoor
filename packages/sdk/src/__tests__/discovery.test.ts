import { describe, it, expect, afterEach } from "vitest";
import {
  discover,
  clearDiscoveryCache,
  discoveryCacheSize,
  DiscoveryError,
} from "../discovery.js";

const mockDiscoveryDoc = {
  agentdoor_version: "1.0",
  service_name: "Test Service",
  service_description: "A test service",
  registration_endpoint: "/agentdoor/register",
  auth_endpoint: "/agentdoor/auth",
  scopes_available: [{ id: "test.read", description: "Read test data" }],
  auth_methods: ["ed25519-challenge", "jwt"],
};

function createMockFetch(doc: unknown, status = 200): typeof globalThis.fetch {
  return async (
    _url: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    return new Response(JSON.stringify(doc), {
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: { "Content-Type": "application/json" },
    });
  };
}

afterEach(() => {
  clearDiscoveryCache();
});

describe("discover - successful discovery", () => {
  it("fetches and returns a valid discovery document", async () => {
    const result = await discover("https://api.test.com", {
      fetchFn: createMockFetch(mockDiscoveryDoc),
    });

    expect(result.agentdoor_version).toBe("1.0");
    expect(result.service_name).toBe("Test Service");
    expect(result.registration_endpoint).toBe("/agentdoor/register");
    expect(result.auth_endpoint).toBe("/agentdoor/auth");
    expect(result.scopes_available).toHaveLength(1);
    expect(result.scopes_available[0].id).toBe("test.read");
  });

  it("includes optional fields when present", async () => {
    const result = await discover("https://api.test.com", {
      fetchFn: createMockFetch(mockDiscoveryDoc),
    });

    expect(result.service_description).toBe("A test service");
    expect(result.auth_methods).toEqual(["ed25519-challenge", "jwt"]);
  });

  it("constructs the correct well-known URL", async () => {
    let capturedUrl: string | undefined;
    const fetchFn: typeof globalThis.fetch = async (
      url: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return new Response(JSON.stringify(mockDiscoveryDoc), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await discover("https://api.test.com", { fetchFn });

    expect(capturedUrl).toBe("https://api.test.com/.well-known/agentdoor.json");
  });

  it("adds https:// scheme when not provided", async () => {
    let capturedUrl: string | undefined;
    const fetchFn: typeof globalThis.fetch = async (
      url: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return new Response(JSON.stringify(mockDiscoveryDoc), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await discover("api.test.com", { fetchFn });

    expect(capturedUrl).toBe("https://api.test.com/.well-known/agentdoor.json");
  });
});

describe("discover - caching", () => {
  it("caches the result after the first fetch", async () => {
    let fetchCount = 0;
    const fetchFn: typeof globalThis.fetch = async (
      _url: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      fetchCount++;
      return new Response(JSON.stringify(mockDiscoveryDoc), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await discover("https://api.test.com", { fetchFn });
    await discover("https://api.test.com", { fetchFn });

    expect(fetchCount).toBe(1);
  });

  it("returns the cached document on second call", async () => {
    const fetchFn = createMockFetch(mockDiscoveryDoc);

    const result1 = await discover("https://api.test.com", { fetchFn });
    const result2 = await discover("https://api.test.com", { fetchFn });

    expect(result1).toEqual(result2);
  });

  it("increments cache size after discovery", async () => {
    expect(discoveryCacheSize()).toBe(0);

    await discover("https://api.test.com", {
      fetchFn: createMockFetch(mockDiscoveryDoc),
    });

    expect(discoveryCacheSize()).toBe(1);
  });

  it("forceRefresh bypasses the cache", async () => {
    let fetchCount = 0;
    const fetchFn: typeof globalThis.fetch = async (
      _url: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      fetchCount++;
      return new Response(JSON.stringify(mockDiscoveryDoc), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await discover("https://api.test.com", { fetchFn });
    await discover("https://api.test.com", { fetchFn, forceRefresh: true });

    expect(fetchCount).toBe(2);
  });
});

describe("clearDiscoveryCache", () => {
  it("clears the entire cache", async () => {
    await discover("https://api.alpha.com", {
      fetchFn: createMockFetch(mockDiscoveryDoc),
    });
    await discover("https://api.beta.com", {
      fetchFn: createMockFetch(mockDiscoveryDoc),
    });

    expect(discoveryCacheSize()).toBe(2);

    clearDiscoveryCache();

    expect(discoveryCacheSize()).toBe(0);
  });

  it("clears only a specific URL when provided", async () => {
    await discover("https://api.alpha.com", {
      fetchFn: createMockFetch(mockDiscoveryDoc),
    });
    await discover("https://api.beta.com", {
      fetchFn: createMockFetch(mockDiscoveryDoc),
    });

    clearDiscoveryCache("https://api.alpha.com");

    expect(discoveryCacheSize()).toBe(1);
  });
});

describe("discover - error handling", () => {
  it("throws DiscoveryError on non-200 response", async () => {
    const fetchFn = createMockFetch({ error: "not found" }, 404);

    await expect(
      discover("https://api.test.com", { fetchFn }),
    ).rejects.toThrow(DiscoveryError);

    await expect(
      discover("https://api.test.com", { fetchFn }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("throws DiscoveryError when response is not valid JSON", async () => {
    const fetchFn: typeof globalThis.fetch = async (
      _url: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      return new Response("this is not json {{{{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await expect(
      discover("https://api.test.com", { fetchFn }),
    ).rejects.toThrow(DiscoveryError);

    await expect(
      discover("https://api.test.com", { fetchFn }),
    ).rejects.toThrow(/invalid JSON/);
  });

  it("throws DiscoveryError when required fields are missing", async () => {
    const incompleteDoc = {
      agentdoor_version: "1.0",
      service_name: "Test",
      // Missing registration_endpoint, auth_endpoint, scopes_available
    };

    const fetchFn = createMockFetch(incompleteDoc);

    await expect(
      discover("https://api.test.com", { fetchFn }),
    ).rejects.toThrow(DiscoveryError);

    await expect(
      discover("https://api.test.com", { fetchFn }),
    ).rejects.toThrow(/missing required field/);
  });

  it("throws DiscoveryError when scopes_available is not an array", async () => {
    const badDoc = {
      ...mockDiscoveryDoc,
      scopes_available: "not an array",
    };

    const fetchFn = createMockFetch(badDoc);

    await expect(
      discover("https://api.test.com", { fetchFn }),
    ).rejects.toThrow(DiscoveryError);
  });

  it("throws DiscoveryError when a scope is missing its id", async () => {
    const badDoc = {
      ...mockDiscoveryDoc,
      scopes_available: [{ description: "missing id" }],
    };

    const fetchFn = createMockFetch(badDoc);

    await expect(
      discover("https://api.test.com", { fetchFn }),
    ).rejects.toThrow(DiscoveryError);

    await expect(
      discover("https://api.test.com", { fetchFn }),
    ).rejects.toThrow(/missing "id"/);
  });

  it("throws DiscoveryError when fetch itself fails (network error)", async () => {
    const fetchFn: typeof globalThis.fetch = async (): Promise<Response> => {
      throw new Error("Network unreachable");
    };

    await expect(
      discover("https://api.test.com", { fetchFn }),
    ).rejects.toThrow(DiscoveryError);

    await expect(
      discover("https://api.test.com", { fetchFn }),
    ).rejects.toThrow(/Network unreachable/);
  });

  it("DiscoveryError includes sourceUrl property", async () => {
    const fetchFn = createMockFetch({ error: "not found" }, 500);

    try {
      await discover("https://api.test.com", { fetchFn });
      expect.fail("Expected DiscoveryError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DiscoveryError);
      expect((err as DiscoveryError).sourceUrl).toContain("api.test.com");
    }
  });
});
