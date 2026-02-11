/**
 * Discovery client for AgentGate-enabled services.
 *
 * Fetches and parses /.well-known/agentgate.json from a target URL.
 * Validates the response shape.
 * Caches results in memory with configurable TTL.
 */

/** Scope definition returned by the discovery document. */
export interface DiscoveryScope {
  id: string;
  description: string;
  price?: string;
  rate_limit?: string;
}

/** Payment configuration from the discovery document. */
export interface DiscoveryPayment {
  protocol: string;
  version?: string;
  networks?: string[];
  currency?: string[];
  facilitator?: string;
  deferred?: boolean;
}

/** Rate limits from the discovery document. */
export interface DiscoveryRateLimits {
  registration?: string;
  default?: string;
  [key: string]: string | undefined;
}

/** Companion protocol pointers from the discovery document. */
export interface DiscoveryCompanionProtocols {
  a2a_agent_card?: string;
  mcp_server?: string;
  x402_bazaar?: boolean;
  [key: string]: string | boolean | undefined;
}

/** Full AgentGate discovery document shape. */
export interface AgentGateDiscoveryDocument {
  agentgate_version: string;
  service_name: string;
  service_description?: string;
  registration_endpoint: string;
  auth_endpoint: string;
  scopes_available: DiscoveryScope[];
  auth_methods?: string[];
  payment?: DiscoveryPayment;
  rate_limits?: DiscoveryRateLimits;
  companion_protocols?: DiscoveryCompanionProtocols;
  docs_url?: string;
  support_email?: string;
}

/** Cached discovery entry with expiration. */
interface CacheEntry {
  document: AgentGateDiscoveryDocument;
  expiresAt: number;
}

/** Default cache TTL: 1 hour (matches CDN max-age). */
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;

/** In-memory discovery cache keyed by base URL. */
const discoveryCache = new Map<string, CacheEntry>();

/**
 * Normalize a base URL for consistent cache keys.
 * Strips trailing slashes and ensures a scheme is present.
 */
function normalizeBaseUrl(url: string): string {
  let normalized = url.trim();

  // Add https:// if no scheme is specified
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = `https://${normalized}`;
  }

  // Strip trailing slashes
  normalized = normalized.replace(/\/+$/, "");

  return normalized;
}

/**
 * Validate that a parsed object has the required fields of an
 * AgentGate discovery document.
 *
 * Throws a descriptive error if validation fails.
 */
function validateDiscoveryDocument(
  data: unknown,
  sourceUrl: string,
): AgentGateDiscoveryDocument {
  if (typeof data !== "object" || data === null) {
    throw new DiscoveryError(
      `Discovery document at ${sourceUrl} is not a JSON object`,
      sourceUrl,
    );
  }

  const doc = data as Record<string, unknown>;

  // Required string fields
  const requiredStrings: Array<keyof AgentGateDiscoveryDocument> = [
    "agentgate_version",
    "service_name",
    "registration_endpoint",
    "auth_endpoint",
  ];

  for (const field of requiredStrings) {
    if (typeof doc[field] !== "string" || (doc[field] as string).length === 0) {
      throw new DiscoveryError(
        `Discovery document at ${sourceUrl} is missing required field "${field}" (must be a non-empty string)`,
        sourceUrl,
      );
    }
  }

  // scopes_available must be an array
  if (!Array.isArray(doc.scopes_available)) {
    throw new DiscoveryError(
      `Discovery document at ${sourceUrl} is missing required field "scopes_available" (must be an array)`,
      sourceUrl,
    );
  }

  // Validate each scope has at least an id and description
  for (let i = 0; i < doc.scopes_available.length; i++) {
    const scope = doc.scopes_available[i] as Record<string, unknown>;
    if (typeof scope !== "object" || scope === null) {
      throw new DiscoveryError(
        `Discovery document at ${sourceUrl}: scopes_available[${i}] is not an object`,
        sourceUrl,
      );
    }
    if (typeof scope.id !== "string" || scope.id.length === 0) {
      throw new DiscoveryError(
        `Discovery document at ${sourceUrl}: scopes_available[${i}] is missing "id"`,
        sourceUrl,
      );
    }
    if (typeof scope.description !== "string") {
      throw new DiscoveryError(
        `Discovery document at ${sourceUrl}: scopes_available[${i}] is missing "description"`,
        sourceUrl,
      );
    }
  }

  return doc as unknown as AgentGateDiscoveryDocument;
}

/**
 * Error thrown when discovery fails.
 */
export class DiscoveryError extends Error {
  public readonly sourceUrl: string;

  constructor(message: string, sourceUrl: string) {
    super(message);
    this.name = "DiscoveryError";
    this.sourceUrl = sourceUrl;
  }
}

export interface DiscoverOptions {
  /** Cache TTL in milliseconds. Defaults to 1 hour. */
  cacheTtlMs?: number;
  /** Skip the cache and force a fresh fetch. */
  forceRefresh?: boolean;
  /** Custom fetch function (useful for testing or custom transports). */
  fetchFn?: typeof globalThis.fetch;
  /** Request timeout in milliseconds. Defaults to 10 seconds. */
  timeoutMs?: number;
}

/**
 * Fetch and parse the AgentGate discovery document from a service URL.
 *
 * The well-known endpoint is `<baseUrl>/.well-known/agentgate.json`.
 * Results are cached in memory for the specified TTL.
 *
 * @param baseUrl - The target service URL (e.g. "https://api.example.com")
 * @param options - Optional fetch / caching configuration
 * @returns The validated discovery document
 */
export async function discover(
  baseUrl: string,
  options: DiscoverOptions = {},
): Promise<AgentGateDiscoveryDocument> {
  const {
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    forceRefresh = false,
    fetchFn = globalThis.fetch,
    timeoutMs = 10_000,
  } = options;

  const normalized = normalizeBaseUrl(baseUrl);

  // Check cache unless force-refreshing
  if (!forceRefresh) {
    const cached = discoveryCache.get(normalized);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.document;
    }
  }

  const discoveryUrl = `${normalized}/.well-known/agentgate.json`;

  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    response = await fetchFn(discoveryUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "agentgate-sdk/0.1.0",
      },
      signal: controller.signal,
    });

    clearTimeout(timer);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new DiscoveryError(
        `Discovery request to ${discoveryUrl} timed out after ${timeoutMs}ms`,
        discoveryUrl,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new DiscoveryError(
      `Failed to fetch discovery document from ${discoveryUrl}: ${message}`,
      discoveryUrl,
    );
  }

  if (!response.ok) {
    throw new DiscoveryError(
      `Discovery endpoint ${discoveryUrl} returned HTTP ${response.status} ${response.statusText}`,
      discoveryUrl,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new DiscoveryError(
      `Discovery endpoint ${discoveryUrl} returned invalid JSON`,
      discoveryUrl,
    );
  }

  const document = validateDiscoveryDocument(body, discoveryUrl);

  // Store in cache
  discoveryCache.set(normalized, {
    document,
    expiresAt: Date.now() + cacheTtlMs,
  });

  return document;
}

/**
 * Clear the in-memory discovery cache.
 * Optionally clear only a specific base URL.
 */
export function clearDiscoveryCache(baseUrl?: string): void {
  if (baseUrl) {
    discoveryCache.delete(normalizeBaseUrl(baseUrl));
  } else {
    discoveryCache.clear();
  }
}

/**
 * Return the number of entries currently in the discovery cache.
 * Mainly useful for testing.
 */
export function discoveryCacheSize(): number {
  return discoveryCache.size;
}
