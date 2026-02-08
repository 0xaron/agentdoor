/**
 * x402 Bazaar Integration
 *
 * Manages the lifecycle of AgentGate service listings on the x402 Bazaar
 * marketplace. Supports publishing, updating, delisting, searching, and
 * bulk syncing from a registry.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BazaarConfig {
  /** Base URL for the Bazaar API */
  apiUrl?: string;
  /** API key for authenticating with the Bazaar */
  apiKey?: string;
  /** Whether to auto-sync listings when services change */
  autoSync?: boolean;
}

export interface BazaarListing {
  /** Unique listing ID on the Bazaar */
  id: string;
  /** Base URL of the listed service */
  serviceUrl: string;
  /** Name of the service */
  serviceName: string;
  /** Description of the service */
  description: string;
  /** Available scopes with optional pricing */
  scopes: Array<{ id: string; price?: string }>;
  /** Wallet address for receiving payments */
  paymentAddress: string;
  /** Blockchain network (e.g. "base", "solana") */
  network: string;
  /** Payment currency (e.g. "USDC") */
  currency: string;
  /** Whether the listing is currently active */
  listed: boolean;
  /** When the listing was created */
  listedAt?: Date;
}

/**
 * Client interface for interacting with the x402 Bazaar API.
 *
 * Implementations should handle HTTP communication with the Bazaar backend.
 * A mock implementation is useful for testing.
 */
export interface BazaarClientInterface {
  /** Create a new service listing */
  listService(data: Record<string, unknown>): Promise<{ id: string }>;
  /** Update an existing listing */
  updateService(id: string, data: Record<string, unknown>): Promise<void>;
  /** Remove a listing */
  delistService(id: string): Promise<void>;
  /** Retrieve a listing by ID */
  getService(id: string): Promise<Record<string, unknown> | null>;
  /** Search the marketplace */
  searchServices(query: string): Promise<Array<Record<string, unknown>>>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_API_URL = "https://bazaar.x402.org/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPaymentInfo(doc: Record<string, unknown>): {
  paymentAddress: string;
  network: string;
  currency: string;
} {
  const x402 = doc.payment as Record<string, unknown> | undefined;
  const networks = Array.isArray(x402?.networks)
    ? (x402.networks as string[])
    : [];
  const currencies = Array.isArray(x402?.currency)
    ? (x402.currency as string[])
    : [];

  // Also check top-level x402 config fields
  const paymentAddress =
    (x402?.payment_address as string) ??
    (doc.payment_address as string) ??
    "";

  return {
    paymentAddress,
    network: networks[0] ?? "base",
    currency: currencies[0] ?? "USDC",
  };
}

function extractScopes(
  doc: Record<string, unknown>,
): Array<{ id: string; price?: string }> {
  const scopesAvailable = Array.isArray(doc.scopes_available)
    ? (doc.scopes_available as Array<Record<string, unknown>>)
    : [];

  return scopesAvailable.map((s) => ({
    id: String(s.id ?? ""),
    price: s.price != null ? String(s.price) : undefined,
  }));
}

function buildListingData(
  serviceUrl: string,
  doc: Record<string, unknown>,
): Record<string, unknown> {
  const { paymentAddress, network, currency } = extractPaymentInfo(doc);
  return {
    serviceUrl,
    serviceName: doc.service_name ?? "Unknown",
    description: doc.service_description ?? "",
    scopes: extractScopes(doc),
    paymentAddress,
    network,
    currency,
    agentgateVersion: doc.agentgate_version,
    registrationEndpoint: doc.registration_endpoint,
    authEndpoint: doc.auth_endpoint,
    authMethods: doc.auth_methods,
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class BazaarIntegration {
  readonly config: BazaarConfig;
  private client: BazaarClientInterface;
  private listings: Map<string, BazaarListing>;

  constructor(config: BazaarConfig, client: BazaarClientInterface) {
    this.config = {
      apiUrl: config.apiUrl ?? DEFAULT_API_URL,
      apiKey: config.apiKey,
      autoSync: config.autoSync ?? false,
    };
    this.client = client;
    this.listings = new Map();
  }

  /**
   * Publish a new service listing on the Bazaar marketplace.
   *
   * @param serviceUrl - Base URL of the AgentGate service
   * @param discoveryDoc - The parsed discovery document
   * @returns The created BazaarListing
   */
  async publishService(
    serviceUrl: string,
    discoveryDoc: Record<string, unknown>,
  ): Promise<BazaarListing> {
    const normalizedUrl = serviceUrl.replace(/\/+$/, "");

    // Check if already listed
    const existing = this.listings.get(normalizedUrl);
    if (existing && existing.listed) {
      return this.updateListing(normalizedUrl, discoveryDoc);
    }

    const data = buildListingData(normalizedUrl, discoveryDoc);
    const result = await this.client.listService(data);

    const { paymentAddress, network, currency } =
      extractPaymentInfo(discoveryDoc);

    const listing: BazaarListing = {
      id: result.id,
      serviceUrl: normalizedUrl,
      serviceName: String(discoveryDoc.service_name ?? "Unknown"),
      description: String(discoveryDoc.service_description ?? ""),
      scopes: extractScopes(discoveryDoc),
      paymentAddress,
      network,
      currency,
      listed: true,
      listedAt: new Date(),
    };

    this.listings.set(normalizedUrl, listing);
    return listing;
  }

  /**
   * Update an existing service listing on the Bazaar marketplace.
   *
   * @param serviceUrl - Base URL of the AgentGate service
   * @param discoveryDoc - The updated discovery document
   * @returns The updated BazaarListing
   */
  async updateListing(
    serviceUrl: string,
    discoveryDoc: Record<string, unknown>,
  ): Promise<BazaarListing> {
    const normalizedUrl = serviceUrl.replace(/\/+$/, "");
    const existing = this.listings.get(normalizedUrl);

    if (!existing) {
      // If not tracked locally, publish as new
      return this.publishService(normalizedUrl, discoveryDoc);
    }

    const data = buildListingData(normalizedUrl, discoveryDoc);
    await this.client.updateService(existing.id, data);

    const { paymentAddress, network, currency } =
      extractPaymentInfo(discoveryDoc);

    existing.serviceName = String(discoveryDoc.service_name ?? "Unknown");
    existing.description = String(discoveryDoc.service_description ?? "");
    existing.scopes = extractScopes(discoveryDoc);
    existing.paymentAddress = paymentAddress;
    existing.network = network;
    existing.currency = currency;

    return existing;
  }

  /**
   * Delist a service from the Bazaar marketplace.
   *
   * @param serviceUrl - Base URL of the service to delist
   */
  async delistService(serviceUrl: string): Promise<void> {
    const normalizedUrl = serviceUrl.replace(/\/+$/, "");
    const existing = this.listings.get(normalizedUrl);

    if (!existing) {
      return;
    }

    await this.client.delistService(existing.id);
    existing.listed = false;
    this.listings.delete(normalizedUrl);
  }

  /**
   * Search the Bazaar marketplace for services.
   *
   * @param query - Free-text search query
   * @returns Array of BazaarListings matching the query
   */
  async searchMarketplace(query: string): Promise<BazaarListing[]> {
    const results = await this.client.searchServices(query);

    return results.map((r) => ({
      id: String(r.id ?? ""),
      serviceUrl: String(r.serviceUrl ?? ""),
      serviceName: String(r.serviceName ?? "Unknown"),
      description: String(r.description ?? ""),
      scopes: Array.isArray(r.scopes)
        ? (r.scopes as Array<{ id: string; price?: string }>)
        : [],
      paymentAddress: String(r.paymentAddress ?? ""),
      network: String(r.network ?? "base"),
      currency: String(r.currency ?? "USDC"),
      listed: r.listed !== false,
      listedAt: r.listedAt ? new Date(String(r.listedAt)) : undefined,
    }));
  }

  /**
   * Sync multiple services from a registry into the Bazaar.
   *
   * For each entry, publishes a new listing or updates an existing one.
   *
   * @param entries - Array of service URLs with their discovery documents
   * @returns Array of published/updated BazaarListings
   */
  async syncFromRegistry(
    entries: Array<{
      url: string;
      discoveryDoc: Record<string, unknown>;
    }>,
  ): Promise<BazaarListing[]> {
    const results: BazaarListing[] = [];

    for (const entry of entries) {
      try {
        const existing = this.listings.get(entry.url.replace(/\/+$/, ""));
        let listing: BazaarListing;

        if (existing && existing.listed) {
          listing = await this.updateListing(entry.url, entry.discoveryDoc);
        } else {
          listing = await this.publishService(entry.url, entry.discoveryDoc);
        }

        results.push(listing);
      } catch (_error) {
        // Skip entries that fail to sync; callers can inspect the results
        // to see which entries were successfully synced.
      }
    }

    return results;
  }

  /**
   * Get the current listing for a service URL, if tracked locally.
   */
  getListing(serviceUrl: string): BazaarListing | undefined {
    return this.listings.get(serviceUrl.replace(/\/+$/, ""));
  }

  /**
   * Get all tracked listings.
   */
  getAllListings(): BazaarListing[] {
    return Array.from(this.listings.values());
  }
}
