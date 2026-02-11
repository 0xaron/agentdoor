/**
 * @agentdoor/core
 *
 * Shared core library for AgentDoor - the pre-auth layer for the agentic internet.
 * Provides cryptographic operations, challenge-response auth, JWT tokens,
 * rate limiting, storage interfaces, discovery document generation, and
 * agent traffic detection.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  // Configuration
  AgentDoorConfig,
  ScopeDefinition,
  X402Config,
  RateLimitConfig,
  StorageConfig,
  // Agent
  Agent,
  AgentStatus,
  AgentContext,
  // Challenge-Response
  ChallengeData,
  // Registration API
  RegistrationRequest,
  RegistrationResponse,
  VerifyRequest,
  VerifyResponse,
  // Auth API
  AuthRequest,
  AuthResponse,
  // Discovery
  DiscoveryDocument,
  // A2A
  A2AAgentCard,
  // Detection
  DetectionResult,
  DetectionSignal,
  RequestInfo,
  // Rate Limiting
  RateLimitResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export {
  // Version
  AGENTDOOR_VERSION,
  PACKAGE_VERSION,
  // Prefixes
  AGENT_ID_PREFIX,
  API_KEY_PREFIX,
  API_KEY_LIVE_PREFIX,
  API_KEY_TEST_PREFIX,
  // Lengths
  AGENT_ID_LENGTH,
  API_KEY_LENGTH,
  NONCE_LENGTH,
  // Endpoints
  DISCOVERY_PATH,
  A2A_AGENT_CARD_PATH,
  REGISTER_PATH,
  REGISTER_VERIFY_PATH,
  AUTH_PATH,
  HEALTH_PATH,
  // Defaults
  DEFAULT_RATE_LIMIT,
  DEFAULT_REGISTRATION_RATE_LIMIT,
  DEFAULT_CHALLENGE_EXPIRY_SECONDS,
  DEFAULT_JWT_EXPIRY,
  DEFAULT_SIGNING_ALGORITHM,
  DEFAULT_SERVICE_NAME,
  DEFAULT_SERVICE_DESCRIPTION,
  DEFAULT_REPUTATION,
  DEFAULT_AGENT_STATUS,
  // Challenge
  CHALLENGE_PREFIX,
  CHALLENGE_REGISTER_ACTION,
  CHALLENGE_AUTH_ACTION,
  // Auth
  AUTH_METHODS,
  // Discovery
  DISCOVERY_CACHE_CONTROL,
  // x402
  X402_PROTOCOL_VERSION,
  DEFAULT_X402_FACILITATOR,
  // Detection
  KNOWN_AGENT_USER_AGENTS,
  KNOWN_AGENT_IP_PREFIXES,
  BROWSER_TYPICAL_HEADERS,
  AGENT_FRAMEWORK_HEADER,
  // Crypto
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SECRET_KEY_BYTES,
  ED25519_SIGNATURE_BYTES,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export {
  AgentDoorError,
  InvalidSignatureError,
  ChallengeExpiredError,
  AgentNotFoundError,
  RateLimitExceededError,
  InvalidConfigError,
  DuplicateAgentError,
  InvalidScopeError,
  InvalidTokenError,
  AgentSuspendedError,
} from "./errors.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export {
  validateConfig,
  resolveConfig,
  // Zod schemas for advanced usage
  AgentDoorConfigSchema,
  ScopeDefinitionSchema,
  RateLimitConfigSchema,
  X402ConfigSchema,
  StorageConfigSchema,
  JwtConfigSchema,
  SigningConfigSchema,
  CompanionConfigSchema,
  ServiceConfigSchema,
} from "./config.js";

export type { ResolvedConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------

export {
  // Ed25519
  generateKeypair,
  signChallenge,
  verifySignature,
  // secp256k1 / wallet
  verifyWalletSignature,
  publicKeyToAddress,
  // ID & key generation
  generateAgentId,
  generateApiKey,
  hashApiKey,
  generateNonce,
  // Hashing
  sha256,
  sha256Sync,
  // Encoding utilities
  bytesToHex,
  hexToBytes,
  encodeBase64,
  decodeBase64,
  decodeUTF8,
} from "./crypto.js";

export type { Keypair } from "./crypto.js";

// ---------------------------------------------------------------------------
// Challenge-Response
// ---------------------------------------------------------------------------

export {
  buildRegistrationChallenge,
  buildAuthMessage,
  createChallenge,
  verifyChallenge,
  verifyAuthRequest,
  isChallengeExpired,
  parseChallengeMessage,
} from "./challenge.js";

// ---------------------------------------------------------------------------
// JWT Tokens
// ---------------------------------------------------------------------------

export {
  issueToken,
  verifyToken,
  computeExpirationDate,
} from "./tokens.js";

export type { AgentDoorJWTClaims, TokenVerifyResult } from "./tokens.js";

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

export { RateLimiter, parseWindow } from "./rate-limiter.js";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export type { AgentStore, CreateAgentInput, UpdateAgentInput } from "./storage/interface.js";
export { MemoryStore } from "./storage/memory.js";
export { SQLiteStore } from "./storage/sqlite.js";
export { PostgresStore } from "./storage/postgres.js";

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export {
  generateDiscoveryDocument,
  serializeDiscoveryDocument,
  getDiscoveryHeaders,
  validateDiscoveryDocument,
} from "./discovery.js";

// ---------------------------------------------------------------------------
// A2A
// ---------------------------------------------------------------------------

export {
  generateA2AAgentCard,
  serializeA2AAgentCard,
  getA2AAgentCardHeaders,
  validateA2AAgentCard,
} from "./a2a.js";

// ---------------------------------------------------------------------------
// Agent Detection
// ---------------------------------------------------------------------------

export {
  detectAgent,
  isLikelyAgent,
  extractFrameworkInfo,
  createRequestInfo,
} from "./detect.js";

// ---------------------------------------------------------------------------
// Webhooks (P1)
// ---------------------------------------------------------------------------

export { WebhookEmitter } from "./webhooks.js";

export type {
  WebhookEventType,
  WebhookEvent,
  WebhookEventListener,
  WebhookEndpointConfig,
  WebhooksConfig,
  WebhookDeliveryResult,
  AgentRegisteredData,
  AgentAuthenticatedData,
  AgentPaymentFailedData,
  AgentRateLimitedData,
  AgentFlaggedData,
  AgentSpendingCapData,
} from "./webhooks.js";

// ---------------------------------------------------------------------------
// Reputation (P1)
// ---------------------------------------------------------------------------

export { ReputationManager, DEFAULT_REPUTATION_WEIGHTS } from "./reputation.js";

export type {
  ReputationEvent,
  ReputationEventType,
  ReputationWeights,
  ReputationGateConfig,
  ReputationConfig,
  ReputationGateResult,
} from "./reputation.js";

// ---------------------------------------------------------------------------
// Spending Caps (P1)
// ---------------------------------------------------------------------------

export { SpendingTracker } from "./spending.js";

export type {
  SpendingPeriod,
  SpendingCapType,
  SpendingCapRule,
  SpendingCapsConfig,
  SpendingRecord,
  SpendingCheckResult,
} from "./spending.js";
