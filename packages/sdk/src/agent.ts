/**
 * Main AgentDoor class -- the primary entry point for the agent-side SDK.
 *
 * Provides a single `connect(url)` method that performs the full flow:
 *   1. Discovery -- fetch /.well-known/agentdoor.json
 *   2. Check credential cache -- skip registration if valid credentials exist
 *   3. Register -- POST /agentdoor/register with public key + scopes
 *   4. Challenge-response -- sign the server's nonce, POST /agentdoor/register/verify
 *   5. Cache credentials -- store api_key, token, scopes on disk
 *   6. Return a Session -- ready for authenticated requests
 *
 * Usage:
 *   const agent = new AgentDoor({ keyPath: "~/.agentdoor/keys.json" });
 *   const session = await agent.connect("https://api.example.com");
 *   const data = await session.get("/weather/forecast", { params: { city: "sf" } });
 */

import {
  loadOrCreateKeypair,
  signMessage,
  type Keypair,
  DEFAULT_KEY_PATH,
} from "./keystore.js";
import {
  discover,
  type AgentDoorDiscoveryDocument,
  type DiscoverOptions,
} from "./discovery.js";
import {
  CredentialStore,
  DEFAULT_CREDENTIALS_PATH,
  type ServiceCredentials,
} from "./credentials.js";
import { Session, type SessionConfig, type TokenRefresher } from "./session.js";
import { type X402WalletConfig, validateWalletConfig } from "./x402.js";

/** Configuration for the AgentDoor SDK client. */
export interface AgentDoorOptions {
  /** Path to the keypair file. Defaults to ~/.agentdoor/keys.json */
  keyPath?: string;
  /** Path to the credentials cache file. Defaults to ~/.agentdoor/credentials.json */
  credentialsPath?: string;
  /** x402 wallet configuration for payment-enabled requests. */
  x402Wallet?: X402WalletConfig | string;
  /** Agent metadata to send during registration. */
  metadata?: Record<string, string>;
  /** Specific scopes to request during registration. If omitted, requests all available. */
  scopesRequested?: string[];
  /** Discovery fetch options. */
  discoveryOptions?: DiscoverOptions;
  /** Custom fetch function (useful for testing). */
  fetchFn?: typeof globalThis.fetch;
  /** Whether to skip credential caching entirely (ephemeral mode). */
  ephemeral?: boolean;
}

/**
 * Registration response from POST /agentdoor/register.
 */
interface RegisterResponse {
  agent_id: string;
  challenge: {
    nonce: string;
    message: string;
    expires_at: string;
  };
}

/**
 * Verification response from POST /agentdoor/register/verify.
 */
interface VerifyResponse {
  agent_id: string;
  api_key: string;
  scopes_granted: string[];
  token: string;
  token_expires_at: string;
  rate_limit?: {
    requests: number;
    window: string;
  };
  x402?: {
    payment_address: string;
    network: string;
    currency: string;
  };
}

/**
 * Auth response from POST /agentdoor/auth (token refresh).
 */
interface AuthResponse {
  token: string;
  expires_at: string;
}

/**
 * Normalize a base URL: ensure scheme is present, strip trailing slashes.
 */
function normalizeBaseUrl(url: string): string {
  let normalized = url.trim();
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = `https://${normalized}`;
  }
  return normalized.replace(/\/+$/, "");
}

/**
 * Build the wallet config from either a string address or full config object.
 */
function resolveWalletConfig(
  input: X402WalletConfig | string | undefined,
): X402WalletConfig | undefined {
  if (!input) return undefined;

  if (typeof input === "string") {
    return {
      address: input,
      network: "base",
      currency: "USDC",
    };
  }

  validateWalletConfig(input);
  return input;
}

/**
 * AgentDoor is the main SDK class for connecting to AgentDoor-enabled services.
 *
 * It manages keypairs, discovers services, registers the agent, and returns
 * authenticated Session objects for making API requests.
 */
export class AgentDoor {
  private readonly keypair: Keypair;
  private readonly credentialStore: CredentialStore | null;
  private readonly walletConfig: X402WalletConfig | undefined;
  private readonly metadata: Record<string, string>;
  private readonly scopesRequested: string[] | undefined;
  private readonly discoveryOptions: DiscoverOptions;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(options: AgentDoorOptions = {}) {
    // Load or generate keypair
    this.keypair = loadOrCreateKeypair(options.keyPath ?? DEFAULT_KEY_PATH);

    // Set up credential store (unless in ephemeral mode)
    this.credentialStore = options.ephemeral
      ? null
      : new CredentialStore(options.credentialsPath ?? DEFAULT_CREDENTIALS_PATH);

    // Resolve wallet config
    this.walletConfig = resolveWalletConfig(options.x402Wallet);

    // Agent metadata
    this.metadata = {
      sdk: "agentdoor-sdk",
      sdk_version: "0.1.0",
      ...options.metadata,
    };

    this.scopesRequested = options.scopesRequested;
    this.discoveryOptions = options.discoveryOptions ?? {};
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  /**
   * Connect to an AgentDoor-enabled service.
   *
   * Performs the full discovery -> registration -> challenge-response flow,
   * or uses cached credentials if available.
   *
   * @param url - The base URL of the service (e.g. "https://api.example.com")
   * @returns An authenticated Session for making API requests
   */
  async connect(url: string): Promise<Session> {
    const baseUrl = normalizeBaseUrl(url);

    // Step 1: Discovery
    const discovery = await discover(baseUrl, {
      ...this.discoveryOptions,
      fetchFn: this.fetchFn,
    });

    // Step 2: Check credential cache
    let credentials = this.credentialStore?.get(baseUrl) ?? null;

    if (credentials && this.credentialStore?.hasValidCredentials(baseUrl)) {
      // We have cached credentials -- return a session immediately
      return this.createSession(baseUrl, credentials, discovery);
    }

    // Step 3: Register and authenticate
    credentials = await this.register(baseUrl, discovery);

    // Step 5: Cache credentials
    if (this.credentialStore) {
      this.credentialStore.save(baseUrl, credentials);
    }

    // Step 6: Return session
    return this.createSession(baseUrl, credentials, discovery);
  }

  /**
   * Get the agent's public key in base64 format.
   */
  get publicKey(): string {
    return this.keypair.publicKeyBase64;
  }

  /**
   * Perform the registration + challenge-response flow against a service.
   */
  private async register(
    baseUrl: string,
    discovery: AgentDoorDiscoveryDocument,
  ): Promise<ServiceCredentials> {
    // Determine which scopes to request
    const availableScopeIds = discovery.scopes_available.map((s) => s.id);
    const requestedScopes =
      this.scopesRequested?.filter((s) => availableScopeIds.includes(s)) ??
      availableScopeIds;

    if (requestedScopes.length === 0) {
      throw new AgentDoorError(
        `No matching scopes found at ${baseUrl}. Available: [${availableScopeIds.join(", ")}]`,
        "NO_MATCHING_SCOPES",
      );
    }

    // Step 3a: POST /agentdoor/register
    const registrationEndpoint = `${baseUrl}${discovery.registration_endpoint}`;

    const registerBody: Record<string, unknown> = {
      public_key: this.keypair.publicKeyBase64,
      scopes_requested: requestedScopes,
      metadata: this.metadata,
    };

    if (this.walletConfig) {
      registerBody.x402_wallet = this.walletConfig.address;
    }

    const registerRes = await this.fetchJson<RegisterResponse>(
      registrationEndpoint,
      {
        method: "POST",
        body: registerBody,
      },
    );

    if (!registerRes.agent_id || !registerRes.challenge?.message) {
      throw new AgentDoorError(
        `Invalid registration response from ${baseUrl}: missing agent_id or challenge`,
        "INVALID_REGISTER_RESPONSE",
      );
    }

    // Step 3b: Sign the challenge nonce
    const signature = signMessage(
      registerRes.challenge.message,
      this.keypair.secretKey,
    );

    // Step 4: POST /agentdoor/register/verify
    const verifyEndpoint = `${baseUrl}${discovery.registration_endpoint}/verify`;

    const verifyRes = await this.fetchJson<VerifyResponse>(verifyEndpoint, {
      method: "POST",
      body: {
        agent_id: registerRes.agent_id,
        signature,
      },
    });

    if (!verifyRes.api_key) {
      throw new AgentDoorError(
        `Invalid verify response from ${baseUrl}: missing api_key`,
        "INVALID_VERIFY_RESPONSE",
      );
    }

    // Build credentials from the verify response
    const credentials: ServiceCredentials = {
      agentId: verifyRes.agent_id,
      apiKey: verifyRes.api_key,
      token: verifyRes.token,
      tokenExpiresAt: verifyRes.token_expires_at,
      scopesGranted: verifyRes.scopes_granted,
      storedAt: new Date().toISOString(),
    };

    if (verifyRes.x402) {
      credentials.x402 = {
        paymentAddress: verifyRes.x402.payment_address,
        network: verifyRes.x402.network,
        currency: verifyRes.x402.currency,
      };
    }

    if (verifyRes.rate_limit) {
      credentials.rateLimit = verifyRes.rate_limit;
    }

    return credentials;
  }

  /**
   * Create a Session from credentials and discovery info.
   */
  private createSession(
    baseUrl: string,
    credentials: ServiceCredentials,
    discovery: AgentDoorDiscoveryDocument,
  ): Session {
    // Build the token refresh callback
    const onTokenRefresh: TokenRefresher = async () => {
      return this.refreshToken(baseUrl, credentials.agentId, discovery);
    };

    // Determine effective wallet config for the session.
    // If the service returned x402 payment info, merge it with the agent's wallet.
    let sessionWallet = this.walletConfig;
    if (this.walletConfig && credentials.x402) {
      sessionWallet = {
        ...this.walletConfig,
        // The service's payment address is not part of the agent's wallet config,
        // but the network/currency from the service response should match.
      };
    }

    const sessionConfig: SessionConfig = {
      baseUrl,
      credentials,
      discovery,
      walletConfig: sessionWallet,
      onTokenRefresh,
      fetchFn: this.fetchFn,
    };

    return new Session(sessionConfig);
  }

  /**
   * Refresh an expired JWT token by calling the auth endpoint.
   * Signs a fresh timestamp for proof of identity.
   */
  private async refreshToken(
    baseUrl: string,
    agentId: string,
    discovery: AgentDoorDiscoveryDocument,
  ): Promise<{ token: string; expiresAt: string }> {
    const timestamp = new Date().toISOString();
    const message = `agentdoor:auth:${agentId}:${timestamp}`;
    const signature = signMessage(message, this.keypair.secretKey);

    const authEndpoint = `${baseUrl}${discovery.auth_endpoint}`;

    const response = await this.fetchJson<AuthResponse>(authEndpoint, {
      method: "POST",
      body: {
        agent_id: agentId,
        timestamp,
        signature,
      },
    });

    if (!response.token || !response.expires_at) {
      throw new AgentDoorError(
        `Invalid auth response from ${baseUrl}: missing token or expires_at`,
        "INVALID_AUTH_RESPONSE",
      );
    }

    // Update the credential cache with the new token
    if (this.credentialStore) {
      try {
        this.credentialStore.updateToken(
          baseUrl,
          response.token,
          response.expires_at,
        );
      } catch {
        // Non-fatal: if caching fails we still return the token
      }
    }

    return {
      token: response.token,
      expiresAt: response.expires_at,
    };
  }

  /**
   * Internal helper: make a JSON request and parse the response.
   */
  private async fetchJson<T>(
    url: string,
    options: {
      method: string;
      body?: unknown;
      timeoutMs?: number;
    },
  ): Promise<T> {
    const { method, body, timeoutMs = 15_000 } = options;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "agentdoor-sdk/0.1.0",
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new AgentDoorError(
          `Request to ${url} timed out after ${timeoutMs}ms`,
          "TIMEOUT",
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new AgentDoorError(
        `Request to ${url} failed: ${message}`,
        "NETWORK_ERROR",
      );
    }

    clearTimeout(timer);

    if (!response.ok) {
      let errorBody: string;
      try {
        errorBody = await response.text();
      } catch {
        errorBody = "";
      }

      // Specific error handling by status code
      if (response.status === 409) {
        throw new AgentDoorError(
          `Agent already registered at ${url}. Use cached credentials or clear them.`,
          "ALREADY_REGISTERED",
        );
      }

      if (response.status === 429) {
        throw new AgentDoorError(
          `Rate limited by ${url}. Try again later.`,
          "RATE_LIMITED",
        );
      }

      if (response.status === 410) {
        throw new AgentDoorError(
          `Challenge expired at ${url}. Restart registration.`,
          "CHALLENGE_EXPIRED",
        );
      }

      throw new AgentDoorError(
        `HTTP ${response.status} from ${url}: ${errorBody}`,
        "HTTP_ERROR",
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new AgentDoorError(
        `Invalid JSON response from ${url}`,
        "INVALID_JSON",
      );
    }
  }
}

/** Error codes for AgentDoor SDK errors. */
export type AgentDoorErrorCode =
  | "NO_MATCHING_SCOPES"
  | "INVALID_REGISTER_RESPONSE"
  | "INVALID_VERIFY_RESPONSE"
  | "INVALID_AUTH_RESPONSE"
  | "ALREADY_REGISTERED"
  | "RATE_LIMITED"
  | "CHALLENGE_EXPIRED"
  | "HTTP_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "INVALID_JSON";

/**
 * Error thrown by the AgentDoor SDK.
 */
export class AgentDoorError extends Error {
  public readonly code: AgentDoorErrorCode;

  constructor(message: string, code: AgentDoorErrorCode) {
    super(message);
    this.name = "AgentDoorError";
    this.code = code;
  }
}
