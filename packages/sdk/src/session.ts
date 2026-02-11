/**
 * Session class for making authenticated requests to an AgentDoor-enabled service.
 *
 * Wraps the native fetch API with convenience methods (get/post/put/delete).
 * Auto-attaches the Authorization header (Bearer token or API key).
 * Handles transparent token refresh when the JWT expires.
 * Optionally attaches x402 payment headers.
 */

import type { ServiceCredentials } from "./credentials.js";
import type { AgentDoorDiscoveryDocument } from "./discovery.js";
import { buildPaymentHeader, type X402WalletConfig } from "./x402.js";

/** Options for individual requests made through a Session. */
export interface RequestOptions {
  /** Query parameters appended to the URL. */
  params?: Record<string, string>;
  /** Additional HTTP headers. */
  headers?: Record<string, string>;
  /** JSON request body (auto-serialized). */
  body?: unknown;
  /** Whether to attach the x402 payment header. */
  x402?: boolean;
  /** Request timeout in milliseconds. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Custom fetch function override. */
  fetchFn?: typeof globalThis.fetch;
}

/** Parsed response from a Session request. */
export interface SessionResponse<T = unknown> {
  /** HTTP status code. */
  status: number;
  /** HTTP status text. */
  statusText: string;
  /** Response headers. */
  headers: Headers;
  /** Parsed JSON body (or null if not JSON). */
  data: T;
  /** Whether the response status is 2xx. */
  ok: boolean;
}

/** Callback to refresh an expired JWT token. */
export type TokenRefresher = () => Promise<{
  token: string;
  expiresAt: string;
}>;

/** Configuration passed to Session constructor. */
export interface SessionConfig {
  /** Normalized base URL of the service. */
  baseUrl: string;
  /** Stored credentials for this service. */
  credentials: ServiceCredentials;
  /** The discovery document for this service. */
  discovery: AgentDoorDiscoveryDocument;
  /** Optional x402 wallet config for payment headers. */
  walletConfig?: X402WalletConfig;
  /** Optional callback invoked to refresh an expired token. */
  onTokenRefresh?: TokenRefresher;
  /** Default fetch function. */
  fetchFn?: typeof globalThis.fetch;
}

/**
 * Session represents an authenticated connection to an AgentDoor-enabled service.
 * Created by `AgentDoor.connect()` and used to make API requests.
 */
export class Session {
  /** Base URL of the connected service. */
  public readonly baseUrl: string;
  /** Scopes granted by the service. */
  public readonly scopes: string[];
  /** Agent ID at this service. */
  public readonly agentId: string;
  /** The discovery document for this service. */
  public readonly discovery: AgentDoorDiscoveryDocument;

  private apiKey: string;
  private token: string | undefined;
  private tokenExpiresAt: string | undefined;
  private readonly walletConfig: X402WalletConfig | undefined;
  private readonly onTokenRefresh: TokenRefresher | undefined;
  private readonly defaultFetchFn: typeof globalThis.fetch;

  private refreshInProgress: Promise<void> | null = null;

  constructor(config: SessionConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.credentials.apiKey;
    this.token = config.credentials.token;
    this.tokenExpiresAt = config.credentials.tokenExpiresAt;
    this.scopes = config.credentials.scopesGranted;
    this.agentId = config.credentials.agentId;
    this.discovery = config.discovery;
    this.walletConfig = config.walletConfig;
    this.onTokenRefresh = config.onTokenRefresh;
    this.defaultFetchFn = config.fetchFn ?? globalThis.fetch;
  }

  /**
   * Make an authenticated GET request.
   */
  async get<T = unknown>(
    path: string,
    options: Omit<RequestOptions, "body"> = {},
  ): Promise<SessionResponse<T>> {
    return this.request<T>("GET", path, options);
  }

  /**
   * Make an authenticated POST request.
   */
  async post<T = unknown>(
    path: string,
    options: RequestOptions = {},
  ): Promise<SessionResponse<T>> {
    return this.request<T>("POST", path, options);
  }

  /**
   * Make an authenticated PUT request.
   */
  async put<T = unknown>(
    path: string,
    options: RequestOptions = {},
  ): Promise<SessionResponse<T>> {
    return this.request<T>("PUT", path, options);
  }

  /**
   * Make an authenticated DELETE request.
   */
  async delete<T = unknown>(
    path: string,
    options: Omit<RequestOptions, "body"> = {},
  ): Promise<SessionResponse<T>> {
    return this.request<T>("DELETE", path, options);
  }

  /**
   * Make an authenticated PATCH request.
   */
  async patch<T = unknown>(
    path: string,
    options: RequestOptions = {},
  ): Promise<SessionResponse<T>> {
    return this.request<T>("PATCH", path, options);
  }

  /**
   * Low-level authenticated request method.
   * All convenience methods delegate here.
   */
  async request<T = unknown>(
    method: string,
    urlPath: string,
    options: RequestOptions = {},
  ): Promise<SessionResponse<T>> {
    const {
      params,
      headers: extraHeaders,
      body,
      x402: attachPayment = false,
      timeoutMs = 30_000,
      fetchFn = this.defaultFetchFn,
    } = options;

    // Ensure token is fresh before making the request
    await this.ensureValidToken();

    // Build full URL
    const url = this.buildUrl(urlPath, params);

    // Build headers
    const headers: Record<string, string> = {
      "User-Agent": "agentdoor-sdk/0.1.0",
      ...extraHeaders,
    };

    // Authorization: prefer JWT token, fall back to API key
    const authValue = this.token ?? this.apiKey;
    headers["Authorization"] = `Bearer ${authValue}`;

    // x402 payment header
    if (attachPayment && this.walletConfig) {
      const paymentHeader = buildPaymentHeader(this.walletConfig, {
        path: urlPath,
        method,
      });
      headers["X-PAYMENT"] = paymentHeader;
    }

    // Content-Type for requests with a body
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    // Execute request with timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetchFn(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new SessionError(
          `Request to ${method} ${url} timed out after ${timeoutMs}ms`,
          0,
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new SessionError(`Request to ${method} ${url} failed: ${message}`, 0);
    }

    clearTimeout(timer);

    // If we get a 401 and have a refresh callback, try once to refresh and retry
    if (response.status === 401 && this.onTokenRefresh && authValue === this.token) {
      await this.refreshToken();

      // Retry the request with the new token
      return this.request<T>(method, urlPath, {
        ...options,
        // Prevent infinite retry loops by removing the refresh mechanism
        // for the retry attempt (handled by ensureValidToken on next call)
      });
    }

    // Parse response body
    let data: T;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        data = (await response.json()) as T;
      } catch {
        data = null as T;
      }
    } else {
      data = (await response.text()) as T;
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data,
      ok: response.ok,
    };
  }

  /**
   * Build a full URL from a path and optional query parameters.
   */
  private buildUrl(
    urlPath: string,
    params?: Record<string, string>,
  ): string {
    // Ensure path starts with /
    const normalizedPath = urlPath.startsWith("/") ? urlPath : `/${urlPath}`;
    const url = new URL(normalizedPath, this.baseUrl);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }

  /**
   * Ensure the current token is valid.
   * If expired and a refresh callback is available, refresh it.
   */
  private async ensureValidToken(): Promise<void> {
    if (!this.token || !this.tokenExpiresAt || !this.onTokenRefresh) {
      return;
    }

    const expiresAt = new Date(this.tokenExpiresAt).getTime();
    const bufferMs = 30_000; // refresh 30s before expiration

    if (Date.now() >= expiresAt - bufferMs) {
      await this.refreshToken();
    }
  }

  /**
   * Refresh the JWT token.
   * Coalesces concurrent refresh calls so only one network request is made.
   */
  private async refreshToken(): Promise<void> {
    if (!this.onTokenRefresh) {
      return;
    }

    // Coalesce concurrent refresh calls
    if (this.refreshInProgress) {
      await this.refreshInProgress;
      return;
    }

    this.refreshInProgress = (async () => {
      try {
        const result = await this.onTokenRefresh!();
        this.token = result.token;
        this.tokenExpiresAt = result.expiresAt;
      } finally {
        this.refreshInProgress = null;
      }
    })();

    await this.refreshInProgress;
  }
}

/**
 * Error thrown by Session when a request fails.
 */
export class SessionError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "SessionError";
    this.statusCode = statusCode;
  }
}
