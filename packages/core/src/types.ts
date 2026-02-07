/**
 * @agentgate/core - Type Definitions
 *
 * All TypeScript interfaces for the AgentGate system.
 * Covers configuration, agents, auth flows, discovery, and storage.
 */

// ---------------------------------------------------------------------------
// Configuration Types
// ---------------------------------------------------------------------------

/** Defines a single scope that agents can request access to. */
export interface ScopeDefinition {
  /** Unique scope identifier, e.g. "weather.read" */
  id: string;
  /** Human-readable description of what this scope grants */
  description: string;
  /** Pricing string, e.g. "$0.001/req" */
  price?: string;
  /** Rate limit string, e.g. "1000/hour" */
  rateLimit?: string;
}

/** x402 payment protocol configuration. */
export interface X402Config {
  /** Blockchain network, e.g. "base", "solana" */
  network: "base" | "solana" | (string & {});
  /** Payment currency, e.g. "USDC" */
  currency: "USDC" | (string & {});
  /** x402 facilitator URL */
  facilitator?: string;
  /** SaaS owner's wallet address for receiving payments */
  paymentAddress: string;
}

/** Rate limiting configuration. */
export interface RateLimitConfig {
  /** Maximum number of requests in the window */
  requests: number;
  /** Time window string, e.g. "1h", "1m", "1d" */
  window: string;
}

/** Storage backend configuration. */
export interface StorageConfig {
  /** Storage driver to use */
  driver: "memory" | "sqlite" | "postgres" | "redis";
  /** Connection URL for database-backed stores */
  url?: string;
  /** Additional driver-specific options */
  options?: Record<string, unknown>;
}

/** Top-level AgentGate configuration. */
export interface AgentGateConfig {
  /** Available scopes that agents can request */
  scopes: ScopeDefinition[];
  /** Pricing map: scope_id -> price string, e.g. { "weather.read": "$0.001/req" } */
  pricing?: Record<string, string>;
  /** Default rate limit applied to new agents */
  rateLimit?: RateLimitConfig;
  /** x402 payment configuration */
  x402?: X402Config;
  /** Storage backend configuration */
  storage?: StorageConfig;
  /** Cryptographic signing settings */
  signing?: {
    algorithm: "ed25519" | "secp256k1";
  };
  /** JWT token settings */
  jwt?: {
    /** HMAC secret for JWT signing. Auto-generated if not provided. */
    secret?: string;
    /** Token expiration duration, e.g. "1h", "24h" */
    expiresIn?: string;
  };
  /** Companion protocol auto-generation flags */
  companion?: {
    /** Auto-generate /.well-known/agent-card.json for A2A protocol */
    a2aAgentCard?: boolean;
    /** Auto-generate /mcp endpoint */
    mcpServer?: boolean;
    /** Expose OAuth 2.1 compatibility endpoints for MCP clients */
    oauthCompat?: boolean;
  };
  /** Service metadata for discovery documents */
  service?: {
    name?: string;
    description?: string;
    docsUrl?: string;
    supportEmail?: string;
  };
  /** Rate limit for registration endpoint itself */
  registrationRateLimit?: RateLimitConfig;
  /** Challenge expiry duration in seconds. Default: 300 (5 minutes). */
  challengeExpirySeconds?: number;
  /** API key mode: "live" or "test" */
  mode?: "live" | "test";
  /** Callback invoked when an agent successfully registers */
  onAgentRegistered?: (agent: Agent) => void | Promise<void>;
  /** Callback invoked when an agent successfully authenticates */
  onAgentAuthenticated?: (agent: Agent) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Agent Types
// ---------------------------------------------------------------------------

/** Agent status in the system. */
export type AgentStatus = "active" | "suspended" | "banned";

/** A registered agent record. */
export interface Agent {
  /** Unique agent identifier, e.g. "ag_V1StGXR8_Z5jdHi6B" */
  id: string;
  /** Base64-encoded Ed25519 public key */
  publicKey: string;
  /** Optional x402 wallet address */
  x402Wallet?: string;
  /** Scopes granted to this agent */
  scopesGranted: string[];
  /** Hashed API key (SHA-256 hex). The raw key is only returned once at registration. */
  apiKeyHash: string;
  /** Agent-specific rate limit */
  rateLimit: RateLimitConfig;
  /** Reputation score 0-100 */
  reputation: number;
  /** Agent metadata: framework, version, name, etc. */
  metadata: Record<string, string>;
  /** Current status */
  status: AgentStatus;
  /** Creation timestamp */
  createdAt: Date;
  /** Last successful authentication timestamp */
  lastAuthAt: Date;
  /** Total requests made */
  totalRequests: number;
  /** Total amount paid via x402 */
  totalX402Paid: number;
}

/** Lightweight agent context attached to authenticated requests. */
export interface AgentContext {
  /** Agent identifier */
  id: string;
  /** Base64-encoded public key */
  publicKey: string;
  /** Granted scopes */
  scopes: string[];
  /** Rate limit for this agent */
  rateLimit: RateLimitConfig;
  /** Reputation score */
  reputation?: number;
  /** Agent metadata */
  metadata: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Challenge-Response Types
// ---------------------------------------------------------------------------

/** Data stored for a pending registration challenge. */
export interface ChallengeData {
  /** The agent_id this challenge belongs to */
  agentId: string;
  /** Random nonce (base64 encoded) */
  nonce: string;
  /** Full challenge message the agent must sign */
  message: string;
  /** When this challenge expires */
  expiresAt: Date;
  /** When this challenge was created */
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Registration API Types
// ---------------------------------------------------------------------------

/** POST /agentgate/register request body. */
export interface RegistrationRequest {
  /** Base64-encoded Ed25519 public key (32 bytes) */
  public_key: string;
  /** Scopes the agent is requesting */
  scopes_requested: string[];
  /** Optional x402 wallet address */
  x402_wallet?: string;
  /** Optional metadata about the agent */
  metadata?: Record<string, string>;
}

/** POST /agentgate/register response body. */
export interface RegistrationResponse {
  /** Assigned agent ID */
  agent_id: string;
  /** Challenge the agent must sign to complete registration */
  challenge: {
    /** Random nonce */
    nonce: string;
    /** Full message to sign */
    message: string;
    /** Challenge expiration timestamp (ISO 8601) */
    expires_at: string;
  };
}

/** POST /agentgate/register/verify request body. */
export interface VerifyRequest {
  /** Agent ID from registration step */
  agent_id: string;
  /** Base64-encoded signature of the challenge message */
  signature: string;
}

/** POST /agentgate/register/verify response body. */
export interface VerifyResponse {
  /** Agent ID */
  agent_id: string;
  /** API key (only returned once, prefixed agk_live_ or agk_test_) */
  api_key: string;
  /** Granted scopes */
  scopes_granted: string[];
  /** JWT token for immediate use */
  token: string;
  /** Token expiration timestamp (ISO 8601) */
  token_expires_at: string;
  /** Rate limit for this agent */
  rate_limit: {
    requests: number;
    window: string;
  };
  /** x402 payment info (if configured) */
  x402?: {
    payment_address: string;
    network: string;
    currency: string;
  };
}

// ---------------------------------------------------------------------------
// Auth API Types
// ---------------------------------------------------------------------------

/** POST /agentgate/auth request body (returning agents). */
export interface AuthRequest {
  /** Agent ID */
  agent_id: string;
  /** Current timestamp (ISO 8601) */
  timestamp: string;
  /** Signature of "agentgate:auth:{agent_id}:{timestamp}" */
  signature: string;
}

/** POST /agentgate/auth response body. */
export interface AuthResponse {
  /** Fresh JWT token */
  token: string;
  /** Token expiration timestamp (ISO 8601) */
  expires_at: string;
}

// ---------------------------------------------------------------------------
// Discovery Document
// ---------------------------------------------------------------------------

/** The /.well-known/agentgate.json discovery document. */
export interface DiscoveryDocument {
  /** Protocol version */
  agentgate_version: string;
  /** Service name */
  service_name: string;
  /** Service description */
  service_description: string;
  /** Registration endpoint path */
  registration_endpoint: string;
  /** Auth endpoint path */
  auth_endpoint: string;
  /** Available scopes */
  scopes_available: Array<{
    id: string;
    description: string;
    price?: string;
    rate_limit?: string;
  }>;
  /** Supported authentication methods */
  auth_methods: string[];
  /** x402 payment configuration (if enabled) */
  payment?: {
    protocol: string;
    version: string;
    networks: string[];
    currency: string[];
    facilitator?: string;
    deferred: boolean;
  };
  /** Rate limit information */
  rate_limits: {
    registration: string;
    default: string;
  };
  /** Links to companion protocol endpoints */
  companion_protocols: {
    a2a_agent_card?: string;
    mcp_server?: string;
    x402_bazaar?: boolean;
  };
  /** URL to documentation */
  docs_url?: string;
  /** Support email address */
  support_email?: string;
}

// ---------------------------------------------------------------------------
// A2A Agent Card
// ---------------------------------------------------------------------------

/** A2A protocol agent card (/.well-known/agent-card.json). */
export interface A2AAgentCard {
  /** Agent card schema version */
  schema_version: string;
  /** Service name */
  name: string;
  /** Service description */
  description: string;
  /** Service URL */
  url: string;
  /** Provider information */
  provider?: {
    organization: string;
    url?: string;
  };
  /** Capabilities offered */
  capabilities: Array<{
    id: string;
    description: string;
  }>;
  /** Authentication info */
  authentication: {
    schemes: string[];
    credentials?: string;
  };
  /** Supported protocols */
  protocols: string[];
}

// ---------------------------------------------------------------------------
// Detection Types
// ---------------------------------------------------------------------------

/** Classification result for agent traffic detection. */
export interface DetectionResult {
  /** Whether the request is likely from an agent */
  isAgent: boolean;
  /** Confidence score 0.0 - 1.0 */
  confidence: number;
  /** Detected framework name, if identifiable */
  framework?: string;
  /** Detected framework version */
  frameworkVersion?: string;
  /** Individual signal scores that contributed to the classification */
  signals: DetectionSignal[];
}

/** An individual detection signal. */
export interface DetectionSignal {
  /** Signal name */
  name: string;
  /** Whether this signal triggered */
  triggered: boolean;
  /** Weight of this signal (how much it contributes to overall score) */
  weight: number;
  /** Additional detail about the signal */
  detail?: string;
}

/** Normalized HTTP request info used for agent detection. */
export interface RequestInfo {
  /** User-Agent header value */
  userAgent?: string;
  /** All request headers as lowercase key-value pairs */
  headers: Record<string, string | string[] | undefined>;
  /** Client IP address */
  ip?: string;
  /** Request method */
  method: string;
  /** Request path */
  path: string;
  /** Timestamp of the request */
  timestamp?: number;
}

// ---------------------------------------------------------------------------
// Rate Limiter Types
// ---------------------------------------------------------------------------

/** Result of a rate limit check. */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in the current window */
  remaining: number;
  /** Total limit */
  limit: number;
  /** When the current window resets (unix timestamp in ms) */
  resetAt: number;
  /** Milliseconds until the window resets */
  retryAfter?: number;
}

// ---------------------------------------------------------------------------
// Express Request Augmentation
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      /** Agent context, set by AgentGate auth middleware when request is from a registered agent */
      agent?: AgentContext;
      /** Whether this request is from an agent (registered or detected) */
      isAgent: boolean;
    }
  }
}
