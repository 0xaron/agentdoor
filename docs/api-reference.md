# API Reference

Complete reference for all HTTP endpoints exposed by the AgentGate middleware. These endpoints are mounted automatically when you add the AgentGate middleware to your server.

## Endpoints Overview

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/.well-known/agentgate.json` | Discovery document |
| `POST` | `/agentgate/register` | Start agent registration |
| `POST` | `/agentgate/register/verify` | Complete registration via challenge-response |
| `POST` | `/agentgate/auth` | Authenticate a returning agent |
| `GET` | `/agentgate/health` | Health check |

---

## `GET /.well-known/agentgate.json`

Returns the discovery document describing the service's capabilities, available scopes, pricing, auth methods, and registration endpoints. This is a static JSON response that should be CDN-cached.

Agents fetch this document first to learn how to interact with your service -- analogous to `/.well-known/openid-configuration` in OAuth or `/.well-known/agent-card.json` in Google A2A.

### Request

No request body or parameters required.

```
GET /.well-known/agentgate.json HTTP/1.1
Host: api.example.com
```

### Response

**Status:** `200 OK`

**Headers:**
```
Content-Type: application/json
Cache-Control: public, max-age=3600
```

**Body:**

```json
{
  "agentgate_version": "1.0",
  "service_name": "WeatherCo API",
  "service_description": "Real-time weather data and forecasts",
  "registration_endpoint": "/agentgate/register",
  "auth_endpoint": "/agentgate/auth",
  "scopes_available": [
    {
      "id": "weather.read",
      "description": "Read current weather data",
      "price": "$0.001/req",
      "rate_limit": "1000/hour"
    },
    {
      "id": "weather.forecast",
      "description": "7-day forecasts",
      "price": "$0.01/req",
      "rate_limit": "100/hour"
    }
  ],
  "auth_methods": ["ed25519-challenge", "x402-wallet", "jwt"],
  "payment": {
    "protocol": "x402",
    "version": "2.0",
    "networks": ["base", "solana"],
    "currency": ["USDC"],
    "facilitator": "https://x402.org/facilitator",
    "deferred": false
  },
  "rate_limits": {
    "registration": "10/hour",
    "default": "1000/hour"
  },
  "companion_protocols": {
    "a2a_agent_card": "/.well-known/agent-card.json",
    "mcp_server": "/mcp",
    "x402_bazaar": true
  },
  "docs_url": "https://docs.weatherco.com/agents",
  "support_email": "agents@weatherco.com"
}
```

### Response Schema

| Field | Type | Description |
|---|---|---|
| `agentgate_version` | `string` | Protocol version. Currently `"1.0"`. |
| `service_name` | `string` | Human/agent-readable service name. |
| `service_description` | `string` | Brief description of the service. |
| `registration_endpoint` | `string` | Path for agent registration. |
| `auth_endpoint` | `string` | Path for returning agent authentication. |
| `scopes_available` | `ScopeDefinition[]` | Available scopes agents can request. |
| `scopes_available[].id` | `string` | Unique scope identifier. |
| `scopes_available[].description` | `string` | What this scope grants access to. |
| `scopes_available[].price` | `string?` | Per-request cost (e.g. `"$0.001/req"`). |
| `scopes_available[].rate_limit` | `string?` | Rate limit for this scope (e.g. `"1000/hour"`). |
| `auth_methods` | `string[]` | Supported authentication methods. |
| `payment` | `object?` | x402 payment configuration (present only when x402 is configured). |
| `payment.protocol` | `string` | Always `"x402"`. |
| `payment.version` | `string` | x402 protocol version. |
| `payment.networks` | `string[]` | Supported blockchain networks. |
| `payment.currency` | `string[]` | Accepted currencies. |
| `payment.facilitator` | `string?` | x402 facilitator URL. |
| `payment.deferred` | `boolean` | Whether deferred payments are accepted. |
| `rate_limits` | `object` | Global rate limit information. |
| `rate_limits.registration` | `string` | Rate limit for the registration endpoint. |
| `rate_limits.default` | `string` | Default per-agent rate limit. |
| `companion_protocols` | `object?` | Links to companion protocol endpoints. |
| `companion_protocols.a2a_agent_card` | `string?` | Path to A2A agent card. |
| `companion_protocols.mcp_server` | `string?` | Path to MCP server endpoint. |
| `companion_protocols.x402_bazaar` | `boolean?` | Whether listed on x402 Bazaar. |
| `docs_url` | `string?` | Link to human-readable documentation. |
| `support_email` | `string?` | Support contact for agent developers. |

---

## `POST /agentgate/register`

Initiates agent registration. The agent provides its public key (Ed25519 or secp256k1), requested scopes, and optional metadata. The server responds with a challenge nonce that the agent must sign to prove key ownership.

### Request

```
POST /agentgate/register HTTP/1.1
Host: api.example.com
Content-Type: application/json
```

**Body:**

```json
{
  "public_key": "MCowBQYDK2VwAyEAZn3LRXO1Kx4vBqUCKdFt2MYSjCqWR7lE9G8gNxN5aSk=",
  "scopes_requested": ["weather.read", "weather.forecast"],
  "x402_wallet": "0x1234567890abcdef1234567890abcdef12345678",
  "metadata": {
    "framework": "langchain",
    "version": "0.2.0",
    "name": "weather-agent"
  }
}
```

### Request Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `public_key` | `string` | Yes | Base64-encoded public key (Ed25519: 32 bytes, secp256k1: 33 bytes compressed). |
| `scopes_requested` | `string[]` | Yes | List of scope IDs the agent wants access to. Must be a subset of `scopes_available`. |
| `x402_wallet` | `string` | No | x402 wallet address for payment identity. When provided, links auth identity to payment identity. |
| `metadata` | `object` | No | Agent metadata. Common fields: `framework`, `version`, `name`, `description`. All values are strings. |

### Response -- Success

**Status:** `201 Created`

```json
{
  "agent_id": "ag_V1StGXR8_Z5jdHi6B",
  "challenge": {
    "nonce": "dGhpcyBpcyBhIHJhbmRvbSBub25jZQ==",
    "message": "agentgate:register:ag_V1StGXR8_Z5jdHi6B:1707400000:dGhpcyBpcyBhIHJhbmRvbSBub25jZQ==",
    "expires_at": "2026-02-08T12:05:00Z"
  }
}
```

### Response Schema

| Field | Type | Description |
|---|---|---|
| `agent_id` | `string` | Unique agent identifier (prefixed with `ag_`). |
| `challenge.nonce` | `string` | Base64-encoded random nonce (32 bytes). |
| `challenge.message` | `string` | The exact string the agent must sign. Format: `agentgate:register:<agent_id>:<timestamp>:<nonce>`. |
| `challenge.expires_at` | `string` | ISO 8601 timestamp. Challenge expires after 5 minutes. |

### Errors

| Status | Code | Description |
|---|---|---|
| `400` | `invalid_request` | Missing or malformed fields. Invalid public key encoding. Unknown scope IDs. |
| `409` | `already_registered` | An agent with this public key is already registered. |
| `429` | `rate_limited` | Registration rate limit exceeded. Check `Retry-After` header. |

**Error response format:**

```json
{
  "error": {
    "code": "invalid_request",
    "message": "public_key must be a valid base64-encoded Ed25519 public key (32 bytes)",
    "details": {
      "field": "public_key"
    }
  }
}
```

---

## `POST /agentgate/register/verify`

Completes agent registration by verifying the signed challenge. The agent signs the `challenge.message` from the registration response with its private key and submits the signature. On success, the server issues credentials (API key and JWT).

### Request

```
POST /agentgate/register/verify HTTP/1.1
Host: api.example.com
Content-Type: application/json
```

**Body:**

```json
{
  "agent_id": "ag_V1StGXR8_Z5jdHi6B",
  "signature": "TUVXR0F0ZXN0c2lnbmF0dXJlb2Y2NGJ5dGVzZm9yZWQyNTUxOWNoYWxsZW5nZXJlc3BvbnNl"
}
```

### Request Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `agent_id` | `string` | Yes | The `agent_id` returned from the registration step. |
| `signature` | `string` | Yes | Base64-encoded signature of the `challenge.message` string, signed with the agent's private key. |

### Response -- Success

**Status:** `200 OK`

```json
{
  "agent_id": "ag_V1StGXR8_Z5jdHi6B",
  "api_key": "agk_live_aBcDeFgHiJkLmNoPqRsT",
  "scopes_granted": ["weather.read", "weather.forecast"],
  "token": "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZ19WMVNjR1hSOF9aNWpkSGk2QiIsInNjb3BlcyI6WyJ3ZWF0aGVyLnJlYWQiLCJ3ZWF0aGVyLmZvcmVjYXN0Il0sInR5cGUiOiJhZ2VudCIsImlhdCI6MTcwNzQwMDAwMCwiZXhwIjoxNzA3NDAzNjAwfQ.SIGNATURE",
  "token_expires_at": "2026-02-08T13:00:00Z",
  "rate_limit": {
    "requests": 1000,
    "window": "1h"
  },
  "x402": {
    "payment_address": "0xSaaSOwnerWallet1234567890abcdef12345678",
    "network": "base",
    "currency": "USDC"
  }
}
```

### Response Schema

| Field | Type | Description |
|---|---|---|
| `agent_id` | `string` | The agent's unique identifier. |
| `api_key` | `string` | Long-lived API key (prefixed with `agk_live_`). Store securely. This is the only time the plaintext key is returned. |
| `scopes_granted` | `string[]` | Scopes actually granted (may be a subset of requested). |
| `token` | `string` | Short-lived JWT for immediate use. |
| `token_expires_at` | `string` | ISO 8601 expiration time for the JWT. |
| `rate_limit` | `object` | The agent's rate limit configuration. |
| `rate_limit.requests` | `number` | Number of requests allowed per window. |
| `rate_limit.window` | `string` | Time window (e.g. `"1h"`). |
| `x402` | `object?` | x402 payment details (present only when x402 is configured). |
| `x402.payment_address` | `string` | Wallet address to send payments to. |
| `x402.network` | `string` | Blockchain network. |
| `x402.currency` | `string` | Payment currency. |

### Errors

| Status | Code | Description |
|---|---|---|
| `400` | `invalid_signature` | Signature verification failed. The signature does not match the challenge message and public key. |
| `404` | `agent_not_found` | No pending registration found for this `agent_id`. |
| `410` | `challenge_expired` | The challenge nonce has expired. Start registration again. |

---

## `POST /agentgate/auth`

Authenticates a returning agent by signing a timestamped message. Use this to obtain a fresh JWT without re-registering. This is for agents that have already registered and want a new short-lived token.

### Request

```
POST /agentgate/auth HTTP/1.1
Host: api.example.com
Content-Type: application/json
```

**Body:**

```json
{
  "agent_id": "ag_V1StGXR8_Z5jdHi6B",
  "timestamp": "2026-02-08T12:30:00Z",
  "signature": "TUVXR0F0ZXN0c2lnbmF0dXJlb2Y2NGJ5dGVzZm9yYXV0aGVuZGljYXRpb25mbG93"
}
```

### Request Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `agent_id` | `string` | Yes | The agent's unique identifier from registration. |
| `timestamp` | `string` | Yes | Current ISO 8601 timestamp. Must be within 5 minutes of server time. |
| `signature` | `string` | Yes | Base64-encoded signature of the string `agentgate:auth:<agent_id>:<timestamp>`, signed with the agent's private key. |

### Response -- Success

**Status:** `200 OK`

```json
{
  "token": "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJhZ19WMVNjR1hSOF9aNWpkSGk2QiIsInNjb3BlcyI6WyJ3ZWF0aGVyLnJlYWQiXSwidHlwZSI6ImFnZW50IiwiaWF0IjoxNzA3NDAwMDAwLCJleHAiOjE3MDc0MDM2MDB9.SIGNATURE",
  "expires_at": "2026-02-08T13:30:00Z"
}
```

### Response Schema

| Field | Type | Description |
|---|---|---|
| `token` | `string` | Fresh short-lived JWT. |
| `expires_at` | `string` | ISO 8601 expiration time for the JWT. |

### Errors

| Status | Code | Description |
|---|---|---|
| `400` | `invalid_signature` | Signature verification failed. |
| `400` | `invalid_timestamp` | Timestamp is too far in the past or future (>5 minute skew). |
| `404` | `agent_not_found` | No registered agent with this ID. |
| `403` | `agent_suspended` | Agent account has been suspended. |

---

## `GET /agentgate/health`

Health check endpoint. Returns the current status of the AgentGate middleware, including storage connectivity and basic statistics.

### Request

```
GET /agentgate/health HTTP/1.1
Host: api.example.com
```

### Response

**Status:** `200 OK`

```json
{
  "status": "healthy",
  "version": "0.1.0",
  "uptime_seconds": 86400,
  "storage": {
    "driver": "postgres",
    "connected": true
  },
  "stats": {
    "total_agents": 47,
    "active_agents_24h": 12,
    "total_requests_24h": 3241
  }
}
```

### Response Schema

| Field | Type | Description |
|---|---|---|
| `status` | `string` | `"healthy"` or `"degraded"`. |
| `version` | `string` | AgentGate package version. |
| `uptime_seconds` | `number` | Seconds since the middleware was initialized. |
| `storage.driver` | `string` | Active storage driver name. |
| `storage.connected` | `boolean` | Whether the storage backend is reachable. |
| `stats.total_agents` | `number` | Total registered agents. |
| `stats.active_agents_24h` | `number` | Agents that authenticated in the last 24 hours. |
| `stats.total_requests_24h` | `number` | Total agent requests in the last 24 hours. |

---

## Authentication on Protected Routes

After registration, agents authenticate on your regular API routes using one of two methods:

### API Key Authentication

Include the API key in the `Authorization` header:

```
GET /api/weather/forecast HTTP/1.1
Host: api.example.com
Authorization: Bearer agk_live_aBcDeFgHiJkLmNoPqRsT
```

### JWT Authentication

Include the JWT token in the `Authorization` header:

```
GET /api/weather/forecast HTTP/1.1
Host: api.example.com
Authorization: Bearer eyJhbGciOiJFZERTQSJ9...
```

### x402 Payment Header

When paying per-request via x402, include the payment payload alongside the auth header:

```
GET /api/weather/forecast HTTP/1.1
Host: api.example.com
Authorization: Bearer agk_live_aBcDeFgHiJkLmNoPqRsT
X-PAYMENT: <x402-payment-payload>
```

### Middleware Behavior

The AgentGate auth middleware runs on every request and:

1. Checks for an `Authorization: Bearer` header.
2. If the token starts with `agk_live_`, looks up the agent by API key hash.
3. If the token is a JWT, verifies the signature and extracts claims.
4. If valid, populates `req.agent` (Express) or equivalent context with:

```typescript
interface AgentContext {
  id: string;                        // "ag_V1StGXR8_Z5jdHi6B"
  publicKey: string;                 // Base64 public key
  scopes: string[];                  // Granted scopes
  rateLimit: RateLimitConfig;
  reputation?: number;               // 0-100
  metadata: Record<string, string>;  // Agent metadata
}
```

5. Sets `req.isAgent = true` (or `false` for human/unauthenticated requests).
6. If the agent has exceeded its rate limit, returns `429 Too Many Requests`.

### Response Codes on Protected Routes

| Status | Reason |
|---|---|
| `200` | Success. Agent authenticated and authorized. |
| `401` | Missing or invalid `Authorization` header. |
| `403` | Agent does not have the required scope for this endpoint. Agent is suspended or banned. |
| `429` | Rate limit exceeded. Check `Retry-After` header. |

**401 response example:**

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Missing or invalid Authorization header. Provide a valid API key or JWT."
  }
}
```

**429 response example:**

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Rate limit exceeded. Try again in 42 seconds.",
    "retry_after": 42
  }
}
```

---

## Error Response Format

All AgentGate error responses follow a consistent format:

```json
{
  "error": {
    "code": "error_code_string",
    "message": "Human-readable description of the error",
    "details": {}
  }
}
```

| Field | Type | Description |
|---|---|---|
| `error.code` | `string` | Machine-readable error code. |
| `error.message` | `string` | Human-readable error description. |
| `error.details` | `object?` | Optional additional context (field names, limits, etc). |

### Error Codes

| Code | HTTP Status | Description |
|---|---|---|
| `invalid_request` | `400` | Malformed request body or invalid field values. |
| `invalid_signature` | `400` | Cryptographic signature verification failed. |
| `invalid_timestamp` | `400` | Timestamp out of acceptable range. |
| `unauthorized` | `401` | Missing or invalid authentication credentials. |
| `forbidden` | `403` | Agent lacks required scope or is suspended. |
| `agent_not_found` | `404` | No agent found with the given ID. |
| `already_registered` | `409` | Public key is already registered. |
| `challenge_expired` | `410` | Challenge nonce has expired. |
| `rate_limited` | `429` | Rate limit exceeded. |
| `internal_error` | `500` | Unexpected server error. |
