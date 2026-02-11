# Configuration Reference

AgentDoor is configured through the `AgentDoorConfig` object passed to your framework middleware. This document covers every configuration option with examples.

## Full Type Definition

```typescript
interface AgentDoorConfig {
  scopes: ScopeDefinition[];
  pricing?: Record<string, string>;
  rateLimit?: RateLimitConfig;
  x402?: X402Config;
  storage?: StorageConfig;
  signing?: { algorithm: "ed25519" | "secp256k1" };
  jwt?: { secret?: string; expiresIn?: string };
  companion?: {
    a2aAgentCard?: boolean;
    mcpServer?: boolean;
    oauthCompat?: boolean;
  };
  service?: {
    name?: string;
    description?: string;
    docsUrl?: string;
    supportEmail?: string;
  };
  registrationRateLimit?: RateLimitConfig;
  challengeExpirySeconds?: number;
  mode?: "live" | "test";
  onAgentRegistered?: (agent: Agent) => void | Promise<void>;
  onAgentAuthenticated?: (agent: Agent) => void | Promise<void>;
  webhooks?: WebhooksConfig;
  reputation?: ReputationConfig;
  spendingCaps?: SpendingCapsConfig;
}
```

## `scopes`

**Required.** Defines what capabilities agents can request access to.

```typescript
interface ScopeDefinition {
  id: string;           // Unique scope identifier, e.g. "weather.read"
  description: string;  // Human/agent-readable description
  price?: string;       // Per-request price, e.g. "$0.001/req"
  rateLimit?: string;   // Scope-specific rate limit, e.g. "1000/hour"
}
```

### Example

```typescript
agentdoor({
  scopes: [
    {
      id: "weather.read",
      description: "Read current weather data for any city",
      price: "$0.001/req",
      rateLimit: "1000/hour",
    },
    {
      id: "weather.forecast",
      description: "Get 7-day weather forecasts",
      price: "$0.01/req",
      rateLimit: "100/hour",
    },
    {
      id: "weather.alerts",
      description: "Subscribe to severe weather alerts",
      price: "$0.005/req",
      rateLimit: "500/hour",
    },
  ],
});
```

Scopes appear in the discovery document at `/.well-known/agentdoor.json` under `scopes_available`. Agents request specific scopes during registration, and the server grants a subset based on configuration.

Use dot-notation naming (e.g. `resource.action`) for consistency. Suggested patterns:
- `resource.read` -- read access
- `resource.write` -- create/update access
- `resource.delete` -- destructive access (consider excluding from default agent grants)
- `resource.admin` -- administrative access

## `pricing`

**Optional.** Maps scope IDs to per-request prices. This is a convenience shorthand -- you can also specify `price` directly on each `ScopeDefinition`.

```typescript
agentdoor({
  scopes: [
    { id: "data.read", description: "Read data" },
    { id: "data.write", description: "Write data" },
  ],
  pricing: {
    "data.read": "$0.001/req",
    "data.write": "$0.01/req",
  },
});
```

Pricing strings follow the format `$<amount>/req`. When both `ScopeDefinition.price` and `pricing[scopeId]` are set, the `pricing` map takes precedence.

Pricing information is published in the discovery document so agents can evaluate costs before registering.

## `rateLimit`

**Optional.** Configures global and per-scope rate limiting using a token bucket algorithm.

```typescript
interface RateLimitConfig {
  default: string;          // Default rate limit for all scopes, e.g. "1000/hour"
  registration?: string;    // Rate limit for registration endpoint, e.g. "10/hour"
  perScope?: Record<string, string>;  // Per-scope overrides
}
```

### Example

```typescript
agentdoor({
  scopes: [
    { id: "data.read", description: "Read data" },
    { id: "data.write", description: "Write data" },
  ],
  rateLimit: {
    default: "1000/hour",
    registration: "10/hour",
    perScope: {
      "data.write": "100/hour",
    },
  },
});
```

Rate limit strings use the format `<count>/<window>` where window is one of: `second`, `minute`, `hour`, `day`.

Rate limits are enforced per-agent. When an agent exceeds its limit, requests receive a `429 Too Many Requests` response with a `Retry-After` header.

## `x402`

**Optional.** Configures x402 payment integration. When set, agents can pay per-request using their x402 wallet, and payment details are included in the discovery document.

```typescript
interface X402Config {
  network: "base" | "solana" | string;   // Blockchain network
  currency: "USDC" | string;             // Payment currency
  facilitator?: string;                  // x402 facilitator URL
  paymentAddress: string;                // Your wallet address to receive payments
}
```

### Example

```typescript
agentdoor({
  scopes: [
    { id: "data.read", description: "Read data", price: "$0.001/req" },
  ],
  x402: {
    network: "base",
    currency: "USDC",
    paymentAddress: "0x1234567890abcdef1234567890abcdef12345678",
    facilitator: "https://x402.org/facilitator",
  },
});
```

When `x402` is configured:
- The discovery document includes a `payment` section with network, currency, and facilitator details.
- Agents can optionally register with an `x402_wallet` address, linking their auth identity to their payment wallet.
- The registration verify response includes `x402.payment_address` so agents know where to send payments.
- The auth middleware accepts `X-PAYMENT` headers containing x402 payment payloads.

## `storage`

**Optional.** Configures where agent registrations and challenges are persisted. Defaults to in-memory storage (suitable for development only).

```typescript
interface StorageConfig {
  driver: "memory" | "sqlite" | "postgres" | "redis";
  url?: string;
  options?: Record<string, unknown>;
}
```

### Examples

**In-memory (default, development only):**

```typescript
agentdoor({
  scopes: [...],
  storage: { driver: "memory" },
});
```

Data is lost on server restart. Use only for development and testing.

**SQLite:**

```typescript
agentdoor({
  scopes: [...],
  storage: {
    driver: "sqlite",
    url: "./data/agentdoor.db",
  },
});
```

Good for single-server deployments. The database file is created automatically.

**PostgreSQL:**

```typescript
agentdoor({
  scopes: [...],
  storage: {
    driver: "postgres",
    url: process.env.DATABASE_URL,
  },
});
```

Recommended for production. Works with standard PostgreSQL, Neon, Supabase, and any Postgres-compatible database.

**Redis:**

```typescript
agentdoor({
  scopes: [...],
  storage: {
    driver: "redis",
    url: process.env.REDIS_URL,
  },
});
```

Good for distributed setups. Works with Redis, Upstash, and any Redis-compatible service.

**Custom storage via the `AgentStore` interface:**

You can implement the `AgentStore` interface to integrate with any database or service. Pass it using the `options` field:

```typescript
import type { AgentStore } from "@agentdoor/core/storage";

const myStore: AgentStore = {
  async createAgent(agent) { /* ... */ },
  async getAgent(id) { /* ... */ },
  async getAgentByApiKeyHash(hash) { /* ... */ },
  async getAgentByPublicKey(publicKey) { /* ... */ },
  async updateAgent(id, updates) { /* ... */ },
  async createChallenge(challenge) { /* ... */ },
  async getChallenge(agentId) { /* ... */ },
  async deleteChallenge(agentId) { /* ... */ },
};

agentdoor({
  scopes: [...],
  storage: { driver: "memory", options: { store: myStore } },
});
```

## `signing`

**Optional.** Configures the cryptographic algorithm used for agent keypairs and challenge-response verification.

```typescript
agentdoor({
  scopes: [...],
  signing: { algorithm: "ed25519" },  // default
});
```

| Algorithm | Use Case | Notes |
|---|---|---|
| `ed25519` | Default. Fast, small keys, widely supported. | 32-byte public keys. ~1ms verify. Used by most agent frameworks. |
| `secp256k1` | x402 wallet compatibility. | 33-byte compressed public keys. Compatible with Ethereum/Base wallets. Use when agents register with x402 wallet identity. |

## `jwt`

**Optional.** Configures JWT token issuance for authenticated agents. After a successful challenge-response, the server issues a JWT that agents can use as a Bearer token.

```typescript
agentdoor({
  scopes: [...],
  jwt: {
    secret: process.env.AGENTDOOR_JWT_SECRET,  // HMAC secret or leave empty for auto-generated
    expiresIn: "1h",                           // Token lifetime (default: "1h")
  },
});
```

If `secret` is not provided, a random secret is generated at startup. This works for single-server deployments but not for multi-server environments -- set an explicit secret in production.

The `expiresIn` value accepts any string parseable by the `jose` library: `"30m"`, `"1h"`, `"24h"`, `"7d"`, etc.

JWTs issued by AgentDoor contain the following claims:

```json
{
  "sub": "ag_V1StGXR8_Z5jdHi6B",
  "scopes": ["data.read", "data.write"],
  "type": "agent",
  "iat": 1707400000,
  "exp": 1707403600
}
```

## `companion`

**Optional.** Enables auto-generation of companion protocol endpoints. One AgentDoor integration can make your service discoverable across multiple agent protocols.

```typescript
agentdoor({
  scopes: [...],
  companion: {
    a2aAgentCard: true,   // Serve /.well-known/agent-card.json (Google A2A)
    mcpServer: true,       // Serve /mcp endpoint (Anthropic MCP)
    oauthCompat: true,     // Serve OAuth 2.1 endpoints for MCP client compatibility
  },
});
```

### `companion.a2aAgentCard`

When `true`, AgentDoor auto-generates and serves a Google A2A-compatible agent card at `/.well-known/agent-card.json`. The card is derived from your AgentDoor configuration -- scopes become capabilities, pricing and auth methods are mapped to the A2A schema.

### `companion.mcpServer`

When `true`, AgentDoor serves an MCP-compatible endpoint at `/mcp`. This allows MCP-aware agents (Claude, ChatGPT tool-use) to discover and call your API through the MCP protocol. Scope definitions are mapped to MCP tool descriptions.

### `companion.oauthCompat`

When `true`, AgentDoor exposes standard OAuth 2.1 endpoints (`/.well-known/oauth-authorization-server`, `/oauth/token`, etc.) for MCP clients that require OAuth-based authentication. This bridges AgentDoor's headless challenge-response auth into the OAuth flow that MCP clients expect.

## Lifecycle Hooks

### `onAgentRegistered`

**Optional.** Called after an agent successfully completes registration (challenge-response verified, credentials issued).

```typescript
agentdoor({
  scopes: [...],
  onAgentRegistered: async (agent) => {
    console.log(`New agent registered: ${agent.id}`);
    console.log(`  Public key: ${agent.publicKey}`);
    console.log(`  Scopes: ${agent.scopesGranted.join(", ")}`);
    console.log(`  Wallet: ${agent.x402Wallet ?? "none"}`);

    // Send a webhook, update your database, notify Slack, etc.
    await fetch("https://hooks.slack.com/services/...", {
      method: "POST",
      body: JSON.stringify({ text: `New agent: ${agent.id}` }),
    });
  },
});
```

The `agent` parameter has the following shape:

```typescript
interface Agent {
  id: string;                            // "ag_V1StGXR8_Z5jdHi6B"
  publicKey: string;                     // Base64 Ed25519 public key
  x402Wallet?: string;                   // Optional x402 wallet address
  scopesGranted: string[];               // Scopes the agent was granted
  apiKeyHash: string;                    // SHA-256 hash of the API key
  rateLimit: RateLimitConfig;
  reputation: number;                    // 0-100, starts at 50
  metadata: Record<string, string>;      // Agent-provided metadata
  status: "active" | "suspended" | "banned";
  createdAt: Date;
  lastAuthAt: Date;
  totalRequests: number;                 // Total requests made
  totalX402Paid: number;                 // Total amount paid via x402
}
```

### `onAgentAuthenticated`

**Optional.** Called each time an agent successfully authenticates (valid API key or JWT on a protected route).

```typescript
agentdoor({
  scopes: [...],
  onAgentAuthenticated: async (agent) => {
    console.log(`Agent ${agent.id} authenticated at ${new Date().toISOString()}`);

    // Track usage, update analytics, check spending caps, etc.
    await analytics.track("agent_authenticated", {
      agentId: agent.id,
      scopes: agent.scopesGranted,
      framework: agent.metadata.framework,
    });
  },
});
```

This hook fires on every authenticated request, so keep the implementation fast. Offload heavy work to a queue or background process.

## Complete Example

A full production configuration combining all options:

```typescript
import { agentdoor } from "@agentdoor/express";

app.use(agentdoor({
  scopes: [
    {
      id: "weather.read",
      description: "Read current weather data",
      price: "$0.001/req",
      rateLimit: "1000/hour",
    },
    {
      id: "weather.forecast",
      description: "7-day weather forecasts",
      price: "$0.01/req",
      rateLimit: "100/hour",
    },
    {
      id: "weather.alerts",
      description: "Severe weather alerts",
      price: "$0.005/req",
      rateLimit: "500/hour",
    },
  ],

  pricing: {
    "weather.read": "$0.001/req",
    "weather.forecast": "$0.01/req",
    "weather.alerts": "$0.005/req",
  },

  rateLimit: {
    default: "1000/hour",
    registration: "10/hour",
    perScope: {
      "weather.forecast": "100/hour",
    },
  },

  x402: {
    network: "base",
    currency: "USDC",
    paymentAddress: process.env.X402_WALLET_ADDRESS,
    facilitator: "https://x402.org/facilitator",
  },

  storage: {
    driver: "postgres",
    url: process.env.DATABASE_URL,
  },

  signing: { algorithm: "ed25519" },

  jwt: {
    secret: process.env.AGENTDOOR_JWT_SECRET,
    expiresIn: "1h",
  },

  companion: {
    a2aAgentCard: true,
    mcpServer: false,
    oauthCompat: false,
  },

  service: {
    name: "Example API",
    description: "Real-time weather data and forecasts",
    docsUrl: "https://docs.example.com/agents",
    supportEmail: "agents@example.com",
  },

  mode: "live",
  challengeExpirySeconds: 300,

  onAgentRegistered: async (agent) => {
    console.log(`Agent registered: ${agent.id}`);
    await notifySlack(`New agent: ${agent.id} (${agent.metadata.framework})`);
  },

  onAgentAuthenticated: async (agent) => {
    await analytics.increment("agent_requests", { agentId: agent.id });
  },
}));
```

## Configuration via File

When using `npx agentdoor init`, configuration is written to `agentdoor.config.ts`:

```typescript
// agentdoor.config.ts
import type { AgentDoorConfig } from "@agentdoor/core";

const config: AgentDoorConfig = {
  scopes: [
    { id: "weather.read", description: "Read current weather data" },
    { id: "weather.forecast", description: "7-day weather forecasts" },
  ],
  pricing: {
    "weather.read": "$0.001/req",
    "weather.forecast": "$0.01/req",
  },
  rateLimit: { default: "1000/hour" },
};

export default config;
```

Then import it in your server:

```typescript
import { agentdoor } from "@agentdoor/express";
import config from "./agentdoor.config";

app.use(agentdoor(config));
```

## `service`

**Optional.** Metadata about your service, used in the discovery document and companion protocol endpoints.

```typescript
agentdoor({
  scopes: [...],
  service: {
    name: "Example API",                      // Default: "AgentDoor Service"
    description: "Real-time weather data",       // Default: "An AgentDoor-enabled API service"
    docsUrl: "https://docs.example.com",       // Link to documentation
    supportEmail: "agents@example.com",        // Support contact
  },
});
```

These values appear in the `/.well-known/agentdoor.json` discovery document.

## `registrationRateLimit`

**Optional.** Separate rate limit for the registration endpoint itself. Defaults to 10 requests per hour.

```typescript
agentdoor({
  scopes: [...],
  registrationRateLimit: {
    requests: 20,
    window: "1h",
  },
});
```

This is independent of the per-agent `rateLimit`. It limits how many new registrations can be processed from a given IP.

## `challengeExpirySeconds`

**Optional.** How long a registration challenge nonce remains valid. Default: `300` (5 minutes).

```typescript
agentdoor({
  scopes: [...],
  challengeExpirySeconds: 600,  // 10 minutes
});
```

## `mode`

**Optional.** Controls the API key prefix. In `"live"` mode, keys are prefixed with `agk_live_`. In `"test"` mode, keys are prefixed with `agk_test_`. Default: `"live"`.

```typescript
agentdoor({
  scopes: [...],
  mode: "test",  // Issue test keys: agk_test_...
});
```

## `webhooks`

**Optional.** Configures webhook delivery for agent lifecycle events.

```typescript
agentdoor({
  scopes: [...],
  webhooks: {
    enabled: true,
    endpoints: [
      {
        url: "https://hooks.yoursite.com/agent-events",
        events: ["agent.registered", "agent.authenticated", "agent.suspended"],
        secret: process.env.WEBHOOK_SECRET,   // Used to sign payloads
        maxRetries: 3,                         // Retry on failure (default: 3)
        timeoutMs: 5000,                       // Request timeout (default: 5000)
      },
    ],
  },
});
```

Webhook payloads include the event type, agent data, and a timestamp. Payloads are signed with HMAC-SHA256 using the endpoint `secret`.

## `reputation`

**Optional.** Enables the agent reputation scoring system. Agents start with an initial score (default: 50) that increases or decreases based on behavior.

```typescript
agentdoor({
  scopes: [...],
  reputation: {
    enabled: true,
    initialScore: 50,        // Starting reputation (0-100)
    minScore: 0,
    maxScore: 100,
    flagThreshold: 20,       // Flag agents below this score
    suspendThreshold: 10,    // Auto-suspend agents below this score
    gates: [
      {
        minReputation: 30,
        scopes: ["data.write"],
        action: "block",     // Block low-reputation agents from write scopes
      },
    ],
  },
});
```

## `spendingCaps`

**Optional.** Configures spending caps for x402 payments.

```typescript
agentdoor({
  scopes: [...],
  spendingCaps: {
    enabled: true,
    defaultCaps: [
      { amount: 100, currency: "USDC", period: "daily", type: "hard" },
      { amount: 2000, currency: "USDC", period: "monthly", type: "soft" },
    ],
    warningThreshold: 0.8,  // Warn at 80% of cap
  },
});
```

A `"hard"` cap rejects requests once reached. A `"soft"` cap emits a warning webhook but allows requests to continue.

## Environment Variables

AgentDoor reads the following environment variables as fallbacks:

| Variable | Used For | Default |
|---|---|---|
| `AGENTDOOR_JWT_SECRET` | JWT signing secret | Auto-generated at startup |
| `DATABASE_URL` | PostgreSQL connection string (when `storage.driver` is `"postgres"`) | None |
| `REDIS_URL` | Redis connection string (when `storage.driver` is `"redis"`) | None |
| `X402_WALLET_ADDRESS` | x402 payment address | None |
| `WEBHOOK_SECRET` | Webhook signing secret | None |
| `AGENTDOOR_LOG_LEVEL` | Logging verbosity: `debug`, `info`, `warn`, `error` | `info` |

Explicit config values always take precedence over environment variables.
