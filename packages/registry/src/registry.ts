/**
 * Agent Registry
 *
 * In-memory searchable index of AgentGate-enabled services.
 * Backed by the AgentGateCrawler for discovery document fetching.
 */

import { AgentGateCrawler } from "./crawler.js";
import type { CrawlerConfig } from "./crawler.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegistryEntry {
  /** Unique registry entry ID */
  id: string;
  /** Base URL of the service */
  url: string;
  /** Service name from the discovery document */
  serviceName: string;
  /** Service description from the discovery document */
  serviceDescription: string;
  /** Available scopes */
  scopes: Array<{ id: string; description: string; price?: string }>;
  /** Supported authentication methods */
  authMethods: string[];
  /** Whether x402 payment is configured */
  hasPayment: boolean;
  /** Payment network (e.g. "base", "solana") */
  paymentNetwork?: string;
  /** When this entry was last verified via crawling */
  lastVerified: Date;
  /** Current status of the service */
  status: "active" | "unreachable" | "invalid";
}

export interface RegistrySearchOptions {
  /** Free-text search query (matched against name, description, URL) */
  query?: string;
  /** Filter by scope ID */
  scope?: string;
  /** Filter by payment availability */
  hasPayment?: boolean;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let entryCounter = 0;

function generateEntryId(): string {
  entryCounter++;
  const timestamp = Date.now().toString(36);
  const counter = entryCounter.toString(36).padStart(4, "0");
  return `reg_${timestamp}${counter}`;
}

function extractEntryFromDoc(
  url: string,
  doc: Record<string, unknown>,
): Omit<RegistryEntry, "id" | "lastVerified" | "status"> {
  const scopesAvailable = Array.isArray(doc.scopes_available)
    ? (doc.scopes_available as Array<Record<string, unknown>>)
    : [];

  const authMethods = Array.isArray(doc.auth_methods)
    ? (doc.auth_methods as string[])
    : [];

  const payment = doc.payment as Record<string, unknown> | undefined;
  const hasPayment = payment != null && typeof payment === "object";
  const networks = hasPayment && Array.isArray(payment.networks)
    ? (payment.networks as string[])
    : [];

  return {
    url,
    serviceName: (doc.service_name as string) || "Unknown",
    serviceDescription: (doc.service_description as string) || "",
    scopes: scopesAvailable.map((s) => ({
      id: String(s.id ?? ""),
      description: String(s.description ?? ""),
      price: s.price != null ? String(s.price) : undefined,
    })),
    authMethods,
    hasPayment,
    paymentNetwork: networks[0],
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class AgentRegistry {
  private entries: Map<string, RegistryEntry>;
  private crawler: AgentGateCrawler;

  constructor(crawlerConfig?: CrawlerConfig) {
    this.entries = new Map();
    this.crawler = new AgentGateCrawler(crawlerConfig);
  }

  /**
   * Add a service to the registry by crawling its discovery endpoint.
   *
   * @param url - Base URL of the service
   * @returns The created RegistryEntry
   * @throws Error if the crawl fails or the discovery doc is invalid
   */
  async addService(url: string): Promise<RegistryEntry> {
    const normalizedUrl = url.replace(/\/+$/, "");

    // Check if already registered
    const existing = this.findByUrl(normalizedUrl);
    if (existing) {
      // Re-crawl and update
      return this.refreshEntry(existing);
    }

    const result = await this.crawler.crawl(normalizedUrl);

    if (result.status !== "success" || !result.discoveryDoc) {
      throw new Error(
        `Failed to crawl ${normalizedUrl}: ${result.error ?? "Unknown error"}`,
      );
    }

    const extracted = extractEntryFromDoc(normalizedUrl, result.discoveryDoc);

    const entry: RegistryEntry = {
      id: generateEntryId(),
      ...extracted,
      lastVerified: new Date(),
      status: "active",
    };

    this.entries.set(entry.id, entry);
    return entry;
  }

  /**
   * Remove a service from the registry.
   *
   * @param url - Base URL of the service to remove
   */
  async removeService(url: string): Promise<void> {
    const normalizedUrl = url.replace(/\/+$/, "");
    const entry = this.findByUrl(normalizedUrl);
    if (entry) {
      this.entries.delete(entry.id);
    }
  }

  /**
   * Search the registry with optional filters.
   */
  async search(options: RegistrySearchOptions): Promise<RegistryEntry[]> {
    let results = Array.from(this.entries.values());

    // Free-text query
    if (options.query) {
      const q = options.query.toLowerCase();
      results = results.filter(
        (e) =>
          e.serviceName.toLowerCase().includes(q) ||
          e.serviceDescription.toLowerCase().includes(q) ||
          e.url.toLowerCase().includes(q),
      );
    }

    // Filter by scope
    if (options.scope) {
      results = results.filter((e) =>
        e.scopes.some((s) => s.id === options.scope),
      );
    }

    // Filter by payment
    if (options.hasPayment !== undefined) {
      results = results.filter((e) => e.hasPayment === options.hasPayment);
    }

    // Pagination
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    results = results.slice(offset, offset + limit);

    return results;
  }

  /**
   * Get a single service by its URL.
   */
  async getService(url: string): Promise<RegistryEntry | null> {
    const normalizedUrl = url.replace(/\/+$/, "");
    return this.findByUrl(normalizedUrl) ?? null;
  }

  /**
   * Get a single service by its registry ID.
   */
  async getServiceById(id: string): Promise<RegistryEntry | null> {
    return this.entries.get(id) ?? null;
  }

  /**
   * Remove a service by its registry ID.
   */
  async removeServiceById(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }

  /**
   * Re-crawl all registered services and update their entries.
   */
  async refreshAll(): Promise<void> {
    const entries = Array.from(this.entries.values());
    const urls = entries.map((e) => e.url);
    const results = await this.crawler.crawlBatch(urls);

    for (const result of results) {
      const entry = this.findByUrl(result.url);
      if (!entry) continue;

      if (result.status === "success" && result.discoveryDoc) {
        const extracted = extractEntryFromDoc(result.url, result.discoveryDoc);
        Object.assign(entry, extracted);
        entry.lastVerified = new Date();
        entry.status = "active";
      } else {
        entry.lastVerified = new Date();
        entry.status = "unreachable";
      }
    }
  }

  /**
   * List all entries in the registry.
   */
  async listAll(): Promise<RegistryEntry[]> {
    return Array.from(this.entries.values());
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private findByUrl(url: string): RegistryEntry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.url === url) {
        return entry;
      }
    }
    return undefined;
  }

  private async refreshEntry(entry: RegistryEntry): Promise<RegistryEntry> {
    const result = await this.crawler.crawl(entry.url);

    if (result.status === "success" && result.discoveryDoc) {
      const extracted = extractEntryFromDoc(entry.url, result.discoveryDoc);
      Object.assign(entry, extracted);
      entry.lastVerified = new Date();
      entry.status = "active";
    } else {
      entry.lastVerified = new Date();
      entry.status = "unreachable";
    }

    return entry;
  }
}
