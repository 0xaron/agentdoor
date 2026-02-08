/**
 * @agentgate/core - Constants
 *
 * Default values, version strings, prefixes, and configuration defaults.
 */

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

/** Current AgentGate protocol version */
export const AGENTGATE_VERSION = "1.0";

/** Current package version */
export const PACKAGE_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// ID & Key Prefixes
// ---------------------------------------------------------------------------

/** Prefix for agent IDs */
export const AGENT_ID_PREFIX = "ag_";

/** Common prefix for all API keys (used for token type detection) */
export const API_KEY_PREFIX = "agk_";

/** Prefix for live API keys */
export const API_KEY_LIVE_PREFIX = "agk_live_";

/** Prefix for test API keys */
export const API_KEY_TEST_PREFIX = "agk_test_";

// ---------------------------------------------------------------------------
// Nanoid Lengths
// ---------------------------------------------------------------------------

/** Length of the random portion of agent IDs (after prefix) */
export const AGENT_ID_LENGTH = 21;

/** Length of the random portion of API keys (after prefix) */
export const API_KEY_LENGTH = 32;

/** Length of the nonce used in challenges */
export const NONCE_LENGTH = 32;

// ---------------------------------------------------------------------------
// Endpoint Paths
// ---------------------------------------------------------------------------

/** Discovery document endpoint */
export const DISCOVERY_PATH = "/.well-known/agentgate.json";

/** A2A agent card endpoint */
export const A2A_AGENT_CARD_PATH = "/.well-known/agent-card.json";

/** Registration endpoint */
export const REGISTER_PATH = "/agentgate/register";

/** Registration verification endpoint */
export const REGISTER_VERIFY_PATH = "/agentgate/register/verify";

/** Auth endpoint for returning agents */
export const AUTH_PATH = "/agentgate/auth";

/** Health check endpoint */
export const HEALTH_PATH = "/agentgate/health";

// ---------------------------------------------------------------------------
// Default Rate Limits
// ---------------------------------------------------------------------------

/** Default rate limit for registered agents */
export const DEFAULT_RATE_LIMIT = {
  requests: 1000,
  window: "1h",
} as const;

/** Default rate limit for the registration endpoint */
export const DEFAULT_REGISTRATION_RATE_LIMIT = {
  requests: 10,
  window: "1h",
} as const;

// ---------------------------------------------------------------------------
// Challenge & Token Defaults
// ---------------------------------------------------------------------------

/** Default challenge expiry in seconds (5 minutes) */
export const DEFAULT_CHALLENGE_EXPIRY_SECONDS = 300;

/** Default JWT expiry duration */
export const DEFAULT_JWT_EXPIRY = "1h";

/** Challenge message format prefix */
export const CHALLENGE_PREFIX = "agentgate";

/** Challenge message format for registration: agentgate:register:{agent_id}:{timestamp}:{nonce} */
export const CHALLENGE_REGISTER_ACTION = "register";

/** Challenge message format for auth: agentgate:auth:{agent_id}:{timestamp} */
export const CHALLENGE_AUTH_ACTION = "auth";

// ---------------------------------------------------------------------------
// Crypto Defaults
// ---------------------------------------------------------------------------

/** Default signing algorithm */
export const DEFAULT_SIGNING_ALGORITHM = "ed25519" as const;

/** Ed25519 public key length in bytes */
export const ED25519_PUBLIC_KEY_BYTES = 32;

/** Ed25519 secret key length in bytes */
export const ED25519_SECRET_KEY_BYTES = 64;

/** Ed25519 signature length in bytes */
export const ED25519_SIGNATURE_BYTES = 64;

// ---------------------------------------------------------------------------
// Auth Methods
// ---------------------------------------------------------------------------

/** Supported authentication methods */
export const AUTH_METHODS = [
  "ed25519-challenge",
  "x402-wallet",
  "jwt",
] as const;

// ---------------------------------------------------------------------------
// Discovery Document Defaults
// ---------------------------------------------------------------------------

/** Default cache control header for discovery documents */
export const DISCOVERY_CACHE_CONTROL = "public, max-age=3600";

/** Default service name if not configured */
export const DEFAULT_SERVICE_NAME = "AgentGate Service";

/** Default service description if not configured */
export const DEFAULT_SERVICE_DESCRIPTION = "An AgentGate-enabled API service";

// ---------------------------------------------------------------------------
// x402 Defaults
// ---------------------------------------------------------------------------

/** Default x402 protocol version */
export const X402_PROTOCOL_VERSION = "2.0";

/** Default x402 facilitator URL */
export const DEFAULT_X402_FACILITATOR = "https://x402.org/facilitator";

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Known agent framework User-Agent patterns */
export const KNOWN_AGENT_USER_AGENTS: ReadonlyArray<{
  pattern: RegExp;
  framework: string;
}> = [
  { pattern: /langchain/i, framework: "langchain" },
  { pattern: /langgraph/i, framework: "langgraph" },
  { pattern: /crewai/i, framework: "crewai" },
  { pattern: /autogen/i, framework: "autogen" },
  { pattern: /openclaw/i, framework: "openclaw" },
  { pattern: /openai-agents/i, framework: "openai-agents" },
  { pattern: /agentgate-sdk/i, framework: "agentgate-sdk" },
  { pattern: /python-requests/i, framework: "python-requests" },
  { pattern: /python-httpx/i, framework: "python-httpx" },
  { pattern: /axios/i, framework: "axios" },
  { pattern: /node-fetch/i, framework: "node-fetch" },
  { pattern: /got\//i, framework: "got" },
  { pattern: /undici/i, framework: "undici" },
  { pattern: /httpie/i, framework: "httpie" },
  { pattern: /curl/i, framework: "curl" },
  { pattern: /wget/i, framework: "wget" },
  { pattern: /scrapy/i, framework: "scrapy" },
  { pattern: /headless/i, framework: "headless-browser" },
  { pattern: /puppeteer/i, framework: "puppeteer" },
  { pattern: /playwright/i, framework: "playwright" },
  { pattern: /selenium/i, framework: "selenium" },
  { pattern: /chatgpt-user/i, framework: "chatgpt" },
  { pattern: /claude-web/i, framework: "claude" },
  { pattern: /gptbot/i, framework: "gptbot" },
  { pattern: /anthropic-ai/i, framework: "anthropic" },
  { pattern: /perplexitybot/i, framework: "perplexity" },
  { pattern: /dify/i, framework: "dify" },
  { pattern: /flowise/i, framework: "flowise" },
  { pattern: /superagent/i, framework: "superagent" },
];

/** Known cloud / agent hosting IP ranges (CIDR prefixes for quick matching) */
export const KNOWN_AGENT_IP_PREFIXES: readonly string[] = [
  // Common cloud prefixes (simplified for quick matching)
  "34.", // GCP
  "35.", // GCP
  "104.196.", // GCP
  "13.", // Azure
  "20.", // Azure
  "40.", // Azure
  "52.", // AWS
  "54.", // AWS
  "18.", // AWS
  "3.", // AWS
];

/** Headers typically present in browser requests but missing from agent requests */
export const BROWSER_TYPICAL_HEADERS = [
  "accept-language",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-dest",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
] as const;

/** The X-Agent-Framework header (emerging convention) */
export const AGENT_FRAMEWORK_HEADER = "x-agent-framework";

/** Default agent reputation score for new agents */
export const DEFAULT_REPUTATION = 50;

/** Default agent status */
export const DEFAULT_AGENT_STATUS = "active" as const;
