/**
 * Tests for x402 Bazaar Integration.
 *
 * Uses a mock BazaarClientInterface to test publish, update, delist,
 * search, and sync operations.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BazaarIntegration } from "../bazaar.js";
import type { BazaarClientInterface, BazaarConfig } from "../bazaar.js";

// ---------------------------------------------------------------------------
// Mock Client
// ---------------------------------------------------------------------------

function createMockClient(): BazaarClientInterface & {
  _listings: Map<string, Record<string, unknown>>;
} {
  let idCounter = 0;
  const listings = new Map<string, Record<string, unknown>>();

  return {
    _listings: listings,

    async listService(data: Record<string, unknown>) {
      idCounter++;
      const id = `baz_${idCounter}`;
      listings.set(id, { id, ...data, listed: true });
      return { id };
    },

    async updateService(id: string, data: Record<string, unknown>) {
      const existing = listings.get(id);
      if (!existing) {
        throw new Error(`Listing ${id} not found`);
      }
      Object.assign(existing, data);
    },

    async delistService(id: string) {
      const existing = listings.get(id);
      if (!existing) {
        throw new Error(`Listing ${id} not found`);
      }
      listings.delete(id);
    },

    async getService(id: string) {
      return listings.get(id) ?? null;
    },

    async searchServices(query: string) {
      const results: Array<Record<string, unknown>> = [];
      for (const listing of listings.values()) {
        const name = String(listing.serviceName ?? "").toLowerCase();
        const desc = String(listing.description ?? "").toLowerCase();
        if (name.includes(query.toLowerCase()) || desc.includes(query.toLowerCase())) {
          results.push(listing);
        }
      }
      return results;
    },
  };
}

// ---------------------------------------------------------------------------
// Discovery Document Helper
// ---------------------------------------------------------------------------

function makeDiscoveryDoc(overrides?: Record<string, unknown>) {
  return {
    agentdoor_version: "0.1.0",
    service_name: "Test Service",
    service_description: "A test AgentDoor service for Bazaar",
    registration_endpoint: "/agentdoor/register",
    auth_endpoint: "/agentdoor/auth",
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
      payment_address: "0x1234567890abcdef",
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
// Tests
// ---------------------------------------------------------------------------

describe("BazaarIntegration", () => {
  let client: ReturnType<typeof createMockClient>;
  let bazaar: BazaarIntegration;
  const config: BazaarConfig = {
    apiUrl: "https://bazaar.x402.org/api",
    apiKey: "test-key",
  };

  beforeEach(() => {
    client = createMockClient();
    bazaar = new BazaarIntegration(config, client);
  });

  // -------------------------------------------------------------------------
  // Publish
  // -------------------------------------------------------------------------

  describe("publishService", () => {
    it("should publish a new listing", async () => {
      const doc = makeDiscoveryDoc();
      const listing = await bazaar.publishService("https://example.com", doc);

      expect(listing.id).toMatch(/^baz_/);
      expect(listing.serviceUrl).toBe("https://example.com");
      expect(listing.serviceName).toBe("Test Service");
      expect(listing.description).toBe(
        "A test AgentDoor service for Bazaar",
      );
      expect(listing.scopes).toHaveLength(2);
      expect(listing.paymentAddress).toBe("0x1234567890abcdef");
      expect(listing.network).toBe("base");
      expect(listing.currency).toBe("USDC");
      expect(listing.listed).toBe(true);
      expect(listing.listedAt).toBeInstanceOf(Date);
    });

    it("should strip trailing slashes from service URL", async () => {
      const doc = makeDiscoveryDoc();
      const listing = await bazaar.publishService(
        "https://example.com///",
        doc,
      );

      expect(listing.serviceUrl).toBe("https://example.com");
    });

    it("should update an existing listing when publishing again", async () => {
      const doc1 = makeDiscoveryDoc({ service_name: "V1" });
      const listing1 = await bazaar.publishService("https://example.com", doc1);

      const doc2 = makeDiscoveryDoc({ service_name: "V2" });
      const listing2 = await bazaar.publishService("https://example.com", doc2);

      expect(listing2.id).toBe(listing1.id);
      expect(listing2.serviceName).toBe("V2");
    });

    it("should call client.listService with correct data", async () => {
      const listSpy = vi.spyOn(client, "listService");
      const doc = makeDiscoveryDoc();
      await bazaar.publishService("https://example.com", doc);

      expect(listSpy).toHaveBeenCalledTimes(1);
      const data = listSpy.mock.calls[0][0];
      expect(data.serviceUrl).toBe("https://example.com");
      expect(data.serviceName).toBe("Test Service");
    });
  });

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  describe("updateListing", () => {
    it("should update an existing listing", async () => {
      const doc = makeDiscoveryDoc({ service_name: "Original" });
      await bazaar.publishService("https://example.com", doc);

      const updatedDoc = makeDiscoveryDoc({ service_name: "Updated" });
      const updated = await bazaar.updateListing(
        "https://example.com",
        updatedDoc,
      );

      expect(updated.serviceName).toBe("Updated");
    });

    it("should publish as new if not tracked locally", async () => {
      const doc = makeDiscoveryDoc();
      const listing = await bazaar.updateListing("https://new.com", doc);

      expect(listing.id).toMatch(/^baz_/);
      expect(listing.listed).toBe(true);
    });

    it("should call client.updateService for existing listings", async () => {
      const updateSpy = vi.spyOn(client, "updateService");
      const doc = makeDiscoveryDoc();
      const listing = await bazaar.publishService("https://example.com", doc);

      const updatedDoc = makeDiscoveryDoc({ service_name: "Updated" });
      await bazaar.updateListing("https://example.com", updatedDoc);

      expect(updateSpy).toHaveBeenCalledWith(
        listing.id,
        expect.objectContaining({ serviceName: "Updated" }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Delist
  // -------------------------------------------------------------------------

  describe("delistService", () => {
    it("should delist an existing service", async () => {
      const doc = makeDiscoveryDoc();
      const listing = await bazaar.publishService("https://example.com", doc);

      await bazaar.delistService("https://example.com");

      expect(bazaar.getListing("https://example.com")).toBeUndefined();
      expect(client._listings.has(listing.id)).toBe(false);
    });

    it("should be a no-op for unknown services", async () => {
      // Should not throw
      await bazaar.delistService("https://unknown.com");
    });

    it("should call client.delistService", async () => {
      const delistSpy = vi.spyOn(client, "delistService");
      const doc = makeDiscoveryDoc();
      const listing = await bazaar.publishService("https://example.com", doc);

      await bazaar.delistService("https://example.com");

      expect(delistSpy).toHaveBeenCalledWith(listing.id);
    });
  });

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  describe("searchMarketplace", () => {
    it("should search the marketplace", async () => {
      await bazaar.publishService(
        "https://weather.com",
        makeDiscoveryDoc({ service_name: "Weather API" }),
      );
      await bazaar.publishService(
        "https://finance.com",
        makeDiscoveryDoc({ service_name: "Finance API" }),
      );

      const results = await bazaar.searchMarketplace("weather");
      expect(results).toHaveLength(1);
      expect(results[0].serviceName).toBe("Weather API");
    });

    it("should return empty array for no matches", async () => {
      await bazaar.publishService(
        "https://example.com",
        makeDiscoveryDoc(),
      );

      const results = await bazaar.searchMarketplace("nonexistent");
      expect(results).toHaveLength(0);
    });

    it("should return proper listing shape", async () => {
      await bazaar.publishService(
        "https://example.com",
        makeDiscoveryDoc(),
      );

      const results = await bazaar.searchMarketplace("Test");
      expect(results).toHaveLength(1);

      const result = results[0];
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("serviceUrl");
      expect(result).toHaveProperty("serviceName");
      expect(result).toHaveProperty("description");
      expect(result).toHaveProperty("scopes");
      expect(result).toHaveProperty("paymentAddress");
      expect(result).toHaveProperty("network");
      expect(result).toHaveProperty("currency");
      expect(result).toHaveProperty("listed");
    });
  });

  // -------------------------------------------------------------------------
  // Sync from Registry
  // -------------------------------------------------------------------------

  describe("syncFromRegistry", () => {
    it("should publish all entries from a registry", async () => {
      const entries = [
        {
          url: "https://service-a.com",
          discoveryDoc: makeDiscoveryDoc({ service_name: "Service A" }),
        },
        {
          url: "https://service-b.com",
          discoveryDoc: makeDiscoveryDoc({ service_name: "Service B" }),
        },
      ];

      const results = await bazaar.syncFromRegistry(entries);

      expect(results).toHaveLength(2);
      expect(results[0].serviceName).toBe("Service A");
      expect(results[1].serviceName).toBe("Service B");
    });

    it("should update already-listed services during sync", async () => {
      const doc = makeDiscoveryDoc({ service_name: "Original" });
      await bazaar.publishService("https://service-a.com", doc);

      const entries = [
        {
          url: "https://service-a.com",
          discoveryDoc: makeDiscoveryDoc({ service_name: "Updated" }),
        },
      ];

      const results = await bazaar.syncFromRegistry(entries);

      expect(results).toHaveLength(1);
      expect(results[0].serviceName).toBe("Updated");
    });

    it("should skip entries that fail to sync", async () => {
      vi.spyOn(client, "listService").mockRejectedValueOnce(
        new Error("API error"),
      );

      const entries = [
        {
          url: "https://failing.com",
          discoveryDoc: makeDiscoveryDoc({ service_name: "Failing" }),
        },
        {
          url: "https://working.com",
          discoveryDoc: makeDiscoveryDoc({ service_name: "Working" }),
        },
      ];

      const results = await bazaar.syncFromRegistry(entries);

      // Only the second entry should succeed
      expect(results).toHaveLength(1);
      expect(results[0].serviceName).toBe("Working");
    });
  });

  // -------------------------------------------------------------------------
  // Local Listing Management
  // -------------------------------------------------------------------------

  describe("listing management", () => {
    it("should get a listing by URL", async () => {
      const doc = makeDiscoveryDoc();
      await bazaar.publishService("https://example.com", doc);

      const listing = bazaar.getListing("https://example.com");
      expect(listing).toBeDefined();
      expect(listing!.serviceUrl).toBe("https://example.com");
    });

    it("should return undefined for unknown URL", () => {
      const listing = bazaar.getListing("https://unknown.com");
      expect(listing).toBeUndefined();
    });

    it("should list all tracked listings", async () => {
      await bazaar.publishService(
        "https://a.com",
        makeDiscoveryDoc({ service_name: "A" }),
      );
      await bazaar.publishService(
        "https://b.com",
        makeDiscoveryDoc({ service_name: "B" }),
      );

      const all = bazaar.getAllListings();
      expect(all).toHaveLength(2);
    });
  });
});
