# Frequently Asked Questions

## How does AgentGate differ from Clerk/Auth0?

Clerk and Auth0 are human authentication systems. They require browsers, consent screens, email verification, and password forms -- none of which AI agents can interact with natively.

AgentGate is purpose-built for agents. It is headless-first: agents register with a public key, prove ownership via a signed challenge, and receive credentials -- all through HTTP APIs, with no browser involved. The entire flow completes in under 500ms.

AgentGate is designed to sit **alongside** Clerk or Auth0, not replace them. Your human users continue signing in through Clerk. Your agent users register through AgentGate. Both user types can share the same database, the same API routes, and the same billing infrastructure. One product, two doors.

| | Clerk / Auth0 | AgentGate |
|---|---|---|
| Designed for | Humans | AI agents |
| Registration | Email/password, social OAuth, magic links | Ed25519 keypair + signed challenge |
| Browser required | Yes | No |
| Latency | Seconds (redirects, consent screens) | < 500ms total |
| Payment setup | Stripe checkout form | x402 wallet at registration |
| Protocol | OAuth 2.1, OIDC | Challenge-response + JWT |

## What is the relationship with x402?

[x402](https://x402.org) is a payment protocol that lets agents pay for API requests using HTTP 402 responses. AgentGate composes with x402 in two ways:

1. **Wallet as identity.** An agent's x402 wallet address can serve as its identity during AgentGate registration. One wallet for both auth and payments -- no separate identity system needed.

2. **Payment wiring.** When a SaaS owner configures x402 in their AgentGate config, the discovery document includes payment details (network, currency, facilitator). Agents that register through AgentGate automatically know how to pay for requests. The agent SDK attaches x402 payment headers to requests when `x402: true` is set.

AgentGate handles who the agent is (registration + auth). x402 handles how the agent pays. They are complementary protocols.

x402 is optional. AgentGate works without it for services that do not require payments.

## Does it work with MCP?

Yes. AgentGate integrates with the Model Context Protocol (MCP) in two ways:

**Server side:** When you set `companion.mcpServer: true` in your AgentGate config, the middleware auto-generates an MCP-compatible endpoint at `/mcp`. Your scopes are mapped to MCP tool descriptions. MCP-aware agents (Claude, ChatGPT with tool-use) can discover and call your API through MCP.

**OAuth compatibility:** MCP clients typically require OAuth 2.1 for authentication. When you set `companion.oauthCompat: true`, AgentGate exposes standard OAuth endpoints (`/.well-known/oauth-authorization-server`, `/oauth/token`, etc.) that bridge AgentGate's headless auth into the OAuth flow MCP clients expect.

**Agent side:** The AgentGate SDK can be used alongside MCP. An agent might discover a service through MCP, but register and authenticate through AgentGate for a faster headless flow.

## What about OAuth?

AgentGate's primary auth mechanism is Ed25519 challenge-response, which is simpler and faster than OAuth for headless agent use cases:

| | OAuth 2.1 | AgentGate Challenge-Response |
|---|---|---|
| Round-trips | 5+ (discovery, redirect, consent, code, token) | 2 (register, verify) |
| Browser needed | Yes (consent screen) | No |
| Implementation complexity | High (DCR, PKCE, token endpoint, consent UI) | Low (sign a nonce) |
| Speed | Seconds | < 500ms |

That said, AgentGate provides OAuth compatibility mode (via `companion.oauthCompat`) for clients that require it, such as MCP clients. This is a bridge, not the primary path.

If you already have OAuth set up for human users, AgentGate does not interfere. It runs on separate endpoints (`/agentgate/*`) alongside your existing OAuth routes.

## How does agent traffic detection work?

AgentGate can run in detect-only mode before you even enable registration. The detection middleware classifies incoming requests as human or agent traffic using multiple signals:

| Signal | Weight | Method |
|---|---|---|
| User-Agent strings | High | Known agent frameworks: LangChain, CrewAI, AutoGen, `python-requests`, etc. |
| Request timing | Medium | Machine-speed sequential requests, consistent intervals |
| IP ranges | Medium | Known cloud/agent hosting provider ranges |
| Header patterns | Medium | Missing browser headers (Accept-Language, Cookie, Referer) |
| Behavioral patterns | High | No session cookies, no JS execution, API-only traffic |
| Self-identification | Definitive | `X-Agent-Framework` header (emerging convention) |

To enable detect-only mode:

```typescript
import { detect } from "@agentgate/detect";

app.use(detect({
  webhook: "https://hooks.yoursite.com/agent-traffic",
}));
```

This does not block or require registration -- it only classifies requests and reports findings via webhook. It is a way to understand your agent traffic before committing to the full AgentGate integration.

## Is it open source?

Yes. The core packages are open source under the MIT license:

- `@agentgate/core` -- shared logic (crypto, storage, discovery, rate limiting)
- `@agentgate/express` -- Express.js middleware
- `@agentgate/next` -- Next.js adapter
- `@agentgate/hono` -- Hono middleware
- `@agentgate/fastify` -- Fastify plugin
- `@agentgate/sdk` -- agent-side TypeScript SDK
- `@agentgate/cli` -- CLI tool
- `@agentgate/detect` -- agent traffic detection
- `@agentgate/cloudflare` -- Cloudflare Workers adapter
- `@agentgate/vercel` -- Vercel Edge middleware
- `agentgate` (Python) -- Python agent SDK
- `agentgate-fastapi` (Python) -- FastAPI middleware

The source code is available at [github.com/0xaron/preauth](https://github.com/0xaron/preauth).

Additional packages include auth provider companions (Auth0, Clerk, Firebase, Stytch, Supabase, NextAuth.js), payment integrations (Stripe), platform adapters (Cloudflare, Vercel), and deployment templates (Railway, Cloudflare Workers, Vercel).

The dashboard and hosted services (agent registry, managed storage, analytics) are separate paid products built on top of the open-source core.

## What databases are supported?

AgentGate supports multiple storage backends through a pluggable `AgentStore` interface:

| Driver | Use Case | Package |
|---|---|---|
| **Memory** | Development and testing. Data is lost on restart. | Built-in (default) |
| **SQLite** | Single-server production deployments. | `@agentgate/core` |
| **PostgreSQL** | Multi-server production deployments. Works with Neon, Supabase, RDS, or any Postgres-compatible database. | `@agentgate/core` |
| **Redis** | Distributed setups. Works with Redis, Upstash, or any Redis-compatible service. | `@agentgate/core` |
| **Custom** | Any database. Implement the `AgentStore` interface. | `@agentgate/core` |

Configure via the `storage` option:

```typescript
// PostgreSQL
agentgate({
  scopes: [...],
  storage: { driver: "postgres", url: process.env.DATABASE_URL },
});

// SQLite
agentgate({
  scopes: [...],
  storage: { driver: "sqlite", url: "./data/agentgate.db" },
});

// Redis
agentgate({
  scopes: [...],
  storage: { driver: "redis", url: process.env.REDIS_URL },
});
```

The `AgentStore` interface is straightforward to implement for other databases (DynamoDB, MongoDB, etc.):

```typescript
import type { AgentStore } from "@agentgate/core/storage";

const myStore: AgentStore = {
  createAgent(agent) { /* ... */ },
  getAgent(id) { /* ... */ },
  getAgentByApiKeyHash(hash) { /* ... */ },
  getAgentByPublicKey(publicKey) { /* ... */ },
  updateAgent(id, updates) { /* ... */ },
  createChallenge(challenge) { /* ... */ },
  getChallenge(agentId) { /* ... */ },
  deleteChallenge(agentId) { /* ... */ },
};
```

## What frameworks are supported?

AgentGate provides first-party adapters for the most popular JavaScript/TypeScript web frameworks:

| Framework | Package | Status |
|---|---|---|
| Express.js (v4/v5) | `@agentgate/express` | Stable |
| Next.js (App Router, v14/v15) | `@agentgate/next` | Stable |
| Hono (v4) | `@agentgate/hono` | Stable |
| Fastify | `@agentgate/fastify` | Stable |
| FastAPI (Python) | `agentgate-fastapi` | Stable |
| Cloudflare Workers | `@agentgate/cloudflare` | Stable |
| Vercel Edge | `@agentgate/vercel` | Stable |
| Django | `django-agentgate` | Planned |

All adapters share `@agentgate/core` for the underlying logic. Adding a new framework adapter requires implementing a thin layer that maps the framework's request/response model to AgentGate's internal types.

## How secure is the Ed25519 challenge-response?

The challenge-response protocol is designed with security as a priority:

- **Private key never transmitted.** The agent's secret key never leaves the agent. Only the public key is shared during registration. The challenge proves key ownership without exposing the private key.
- **Nonce prevents replay.** Each challenge includes a unique random nonce and a timestamp. Challenges expire after 5 minutes. Replaying a signed challenge after expiration fails.
- **API keys are hashed.** API keys are stored as SHA-256 hashes in the database. A database compromise does not reveal usable credentials.
- **JWTs are short-lived.** JWT tokens expire (default: 1 hour). Agents refresh tokens via the `/agentgate/auth` endpoint.
- **Pure JS crypto.** Ed25519 operations use `tweetnacl`, a well-audited, pure-JavaScript implementation with no native dependencies. No `node-gyp` compilation, no C bindings, works everywhere.

## What is the performance overhead?

AgentGate is designed to be fast enough that SaaS owners do not notice it:

| Operation | Target Latency |
|---|---|
| Auth middleware (per request) | < 2ms |
| Signature verification | < 1ms |
| JWT verification | < 1ms |
| Full registration flow | < 500ms end-to-end |
| Discovery endpoint | Static JSON, CDN-cacheable |

The auth middleware runs an API key hash lookup or JWT verification on each request. Both operations are sub-millisecond. Rate limiting uses an in-memory token bucket (or Redis for distributed setups) with negligible overhead.

## Can I use AgentGate without x402 payments?

Yes. x402 is entirely optional. If you omit the `x402` configuration, AgentGate works as a pure registration and authentication layer. Agents register, get credentials, and make authenticated requests -- with no payment component.

You can add x402 later by updating your configuration. Existing agents will see the payment information in the discovery document on their next fetch.

## Can human users and agent users share the same API?

Yes. This is how AgentGate is designed to work. The middleware sets `req.isAgent` on every request:

```typescript
app.get("/api/data", (req, res) => {
  if (req.isAgent) {
    // Agent request, req.agent contains agent context
    console.log(`Agent ${req.agent.id}, scopes: ${req.agent.scopes}`);
  } else {
    // Human request, handled by your existing auth (Clerk, Auth0, etc.)
  }
  // Same response for both
  res.json({ data: "..." });
});
```

Requests without AgentGate credentials pass through unchanged. Your existing human auth continues to work. AgentGate only activates when it detects agent credentials in the `Authorization` header.
