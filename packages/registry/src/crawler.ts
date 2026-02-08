/**
 * AgentGate Crawler
 *
 * Fetches and validates /.well-known/agentgate.json discovery documents
 * from target URLs. Supports batch crawling with concurrency control.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrawlTarget {
  /** The base URL that was crawled */
  url: string;
  /** When this URL was last crawled */
  lastCrawled?: Date;
  /** Crawl result status */
  status: "pending" | "success" | "failed";
  /** The parsed discovery document (if successful) */
  discoveryDoc?: Record<string, unknown>;
  /** Error message if the crawl failed */
  error?: string;
}

export interface CrawlerConfig {
  /** User-Agent header sent with crawl requests */
  userAgent?: string;
  /** Timeout per request in milliseconds */
  timeoutMs?: number;
  /** Maximum number of concurrent crawl requests */
  maxConcurrency?: number;
  /** Number of retry attempts for failed requests */
  retryCount?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_USER_AGENT = "AgentGateCrawler/0.1.0";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CONCURRENCY = 5;
const DEFAULT_RETRY_COUNT = 2;
const DISCOVERY_PATH = "/.well-known/agentgate.json";

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class AgentGateCrawler {
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxConcurrency: number;
  private readonly retryCount: number;

  constructor(config?: CrawlerConfig) {
    this.userAgent = config?.userAgent ?? DEFAULT_USER_AGENT;
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxConcurrency = config?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    this.retryCount = config?.retryCount ?? DEFAULT_RETRY_COUNT;
  }

  /**
   * Crawl a single URL to fetch its AgentGate discovery document.
   *
   * Fetches `{url}/.well-known/agentgate.json`, validates the response,
   * and returns a CrawlTarget with the result status.
   */
  async crawl(url: string): Promise<CrawlTarget> {
    const normalizedUrl = url.replace(/\/+$/, "");
    const discoveryUrl = `${normalizedUrl}${DISCOVERY_PATH}`;

    let lastError: string | undefined;

    for (let attempt = 0; attempt <= this.retryCount; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(discoveryUrl, {
          headers: {
            "User-Agent": this.userAgent,
            Accept: "application/json",
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          lastError = `HTTP ${response.status}: ${response.statusText}`;
          continue;
        }

        const body = await response.json();

        if (!this.isValidDiscoveryDoc(body)) {
          return {
            url: normalizedUrl,
            lastCrawled: new Date(),
            status: "failed",
            error: "Invalid discovery document: missing required fields",
          };
        }

        return {
          url: normalizedUrl,
          lastCrawled: new Date(),
          status: "success",
          discoveryDoc: body as Record<string, unknown>,
        };
      } catch (err) {
        lastError =
          err instanceof Error ? err.message : "Unknown fetch error";
      }
    }

    return {
      url: normalizedUrl,
      lastCrawled: new Date(),
      status: "failed",
      error: lastError ?? "Crawl failed after retries",
    };
  }

  /**
   * Crawl multiple URLs with concurrency control.
   *
   * Processes URLs in batches limited by `maxConcurrency`.
   */
  async crawlBatch(urls: string[]): Promise<CrawlTarget[]> {
    const results: CrawlTarget[] = [];
    const queue = [...urls];

    while (queue.length > 0) {
      const batch = queue.splice(0, this.maxConcurrency);
      const batchResults = await Promise.all(
        batch.map((url) => this.crawl(url)),
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Validate that a parsed JSON body looks like a valid AgentGate
   * discovery document by checking for required top-level fields.
   */
  private isValidDiscoveryDoc(doc: unknown): boolean {
    if (typeof doc !== "object" || doc === null) {
      return false;
    }

    const d = doc as Record<string, unknown>;

    return (
      typeof d.agentgate_version === "string" &&
      typeof d.service_name === "string" &&
      typeof d.registration_endpoint === "string" &&
      typeof d.auth_endpoint === "string" &&
      Array.isArray(d.scopes_available) &&
      Array.isArray(d.auth_methods)
    );
  }
}
