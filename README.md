# AgentGate

[![CI](https://github.com/0xaron/preauth/actions/workflows/ci.yml/badge.svg)](https://github.com/0xaron/preauth/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@agentgate/core.svg)](https://www.npmjs.com/package/@agentgate/core)
[![PyPI version](https://img.shields.io/pypi/v/agentgate.svg)](https://pypi.org/project/agentgate/)
[![Coverage](https://img.shields.io/badge/coverage-%E2%89%A580%25-brightgreen.svg)](https://github.com/0xaron/preauth/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)

### Make Your Website Agent-Ready in 3 Lines of Code

> The pre-auth layer for the agentic internet.
> Sits alongside Clerk. Lets agents register, authenticate, and pay — programmatically.

---

## The Problem

AI agents can pay for APIs (x402), discover tools (MCP), and talk to each other (A2A). But they still **can't sign up for your product** without opening a browser, filling out forms, and solving CAPTCHAs.

The pre-auth funnel — registration → credential issuance → billing setup — was designed entirely for humans. Agents resort to slow (30–60s), fragile browser automation that breaks on every UI change.

**What agents do today:** Browser automation to navigate signup flows.
**What they should do:** One HTTP POST → registered, credentialed, billing-ready. Under 500ms. No browser.

---

## How It Works

```
Agent                              SaaS (with AgentGate middleware)
  │                                         │
  │── GET /.well-known/agentgate.json ────▶│  (1) Discovery
  │◀── {scopes, pricing, endpoints} ───────│      ~50ms
  │                                         │
  │── POST /agentgate/register ───────────▶│  (2) Register
  │   {public_key, scopes, x402_wallet}    │
  │◀── {agent_id, nonce} ─────────────────│      ~100ms
  │                                         │
  │── POST /agentgate/register/verify ────▶│  (3) Challenge-Response
  │   {agent_id, signature(nonce)}         │
  │◀── {api_key, token, rate_limits} ─────│      ~200ms
  │                                         │
  │── GET /api/data ──────────────────────▶│  (4) Ready
  │   Authorization: Bearer agk_xxx        │      Ongoing
  │◀── {data} ────────────────────────────│
```

**Total: < 500ms.** Compare: browser automation = 30–60s.

---

## Quick Start

### For SaaS Owners (3-Line Integration)

```bash
npm install @agentgate/express
```

```javascript
const express = require("express");
const agentgate = require("@agentgate/express");

const app = express();

app.use(agentgate({
  scopes: [
    { id: "data.read", description: "Read data", price: "$0.001/req" },
    { id: "data.write", description: "Write data", price: "$0.01/req" }
  ],
  rateLimit: { default: { requests: 1000, window: "1h" } },
  x402: {
    network: "base",
    currency: "USDC",
    paymentAddress: "0xYourWallet..."
  }
}));

// Your existing API routes — now agent-ready
app.get("/api/data", (req, res) => {
  if (req.isAgent) {
    console.log(`Agent ${req.agent.id} requesting data`);
  }
  res.json({ data: "hello" });
});

app.listen(3000);
```

That's it. Your API is now agent-ready:
- `/.well-known/agentgate.json` — auto-generated discovery endpoint
- `/agentgate/register` + `/agentgate/register/verify` — headless agent registration
- `/agentgate/auth` — returning agent authentication
- Auth middleware applied to all your routes

### Using the CLI

```bash
# Auto-generate config from your OpenAPI spec
npx agentgate init --from-openapi ./openapi.yaml

# Or interactive setup
npx agentgate init
```

### For Agent Developers (< 500ms Onboarding)

```bash
npm install @agentgate/sdk
```

```typescript
import { AgentGate } from "@agentgate/sdk";

const agent = new AgentGate({
  keyPath: "~/.agentgate/keys.json",   // auto-generates keypair if needed
  x402Wallet: "0x1234...abcd"          // optional: x402 wallet as identity
});

// Discover + register + auth in ONE call
const session = await agent.connect("https://api.weatherco.com");

// Make authenticated + paid requests
const data = await session.get("/weather/forecast", {
  params: { city: "sf" },
  x402: true  // auto-attach x402 payment header
});
```

---

## Framework Adapters

### Express.js

```javascript
const agentgate = require("@agentgate/express");
app.use(agentgate({ scopes: [{ id: "data.read", description: "Read" }] }));
```

### Next.js (App Router)

```typescript
import { agentgate } from "@agentgate/next";

export default agentgate({
  scopes: [{ id: "data.read", description: "Read" }],
  pricing: { "data.read": "$0.001/req" }
});

export const config = { matcher: ["/api/:path*"] };
```

### Hono (Cloudflare Workers / Deno / Bun)

```typescript
import { Hono } from "hono";
import { agentgate } from "@agentgate/hono";

const app = new Hono();
app.use("*", agentgate({
  scopes: [{ id: "data.read", description: "Read" }]
}));
```

### Fastify

```typescript
import Fastify from "fastify";
import { agentgate } from "@agentgate/fastify";

const app = Fastify();
app.register(agentgate, {
  scopes: [{ id: "data.read", description: "Read" }]
});
```

### FastAPI (Python)

```python
from fastapi import Depends, FastAPI
from agentgate_fastapi import AgentGate, AgentGateConfig, AgentContext

app = FastAPI()
gate = AgentGate(app, config=AgentGateConfig(
    service_name="My API",
    scopes=[{"name": "read", "description": "Read access"}],
))

@app.get("/protected")
async def protected(agent: AgentContext = Depends(gate.agent_required())):
    return {"agent": agent.agent_id}
```

---

## Agent Traffic Detection

Don't know if you need AgentGate? Start with detect-only mode (free):

```javascript
const { detect } = require("@agentgate/detect");

app.use(detect({
  webhook: "https://hooks.yoursite.com/agent-traffic"
}));
```

This classifies incoming requests as human or agent based on:
- **User-Agent strings** — Known agent frameworks (LangChain, CrewAI, AutoGen)
- **Header patterns** — Missing browser headers (Accept-Language, Cookie, Referer)
- **Behavioral patterns** — No session cookies, API-only traffic, machine-speed requests
- **Self-identification** — `X-Agent-Framework` header

Upgrade path: Detect → Register → Bill → Dashboard.

---

## Discovery Protocol

AgentGate uses `/.well-known/agentgate.json` for agent discovery (similar to `/.well-known/openid-configuration`):

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
    }
  ],
  "auth_methods": ["ed25519-challenge", "x402-wallet", "jwt"],
  "payment": {
    "protocol": "x402",
    "version": "2.0",
    "networks": ["base"],
    "currency": ["USDC"]
  }
}
```

### Cross-Protocol Auto-Generation

One AgentGate integration auto-generates companion protocol files:

| File | Protocol | Status |
|---|---|---|
| `/.well-known/agentgate.json` | AgentGate | Primary |
| `/.well-known/agent-card.json` | A2A (Google) | Auto-generated |
| `/.well-known/oauth-authorization-server` | OAuth 2.1 | Optional |

---

## Auth Mechanism

### Three Auth Modes

| Mode | Best For | How It Works |
|---|---|---|
| **Ed25519 Challenge-Response** (default) | Best security | Agent signs server nonce. Private key never leaves agent. ~1ms verify. |
| **x402 Wallet Identity** | Agents with x402 wallets | Wallet address = identity. One identity for auth + payments. |
| **JWT Token** | After initial auth, for caching | Server issues short-lived JWT. Standard Bearer token. |

### Why Not Just OAuth?

| | OAuth 2.1 | AgentGate |
|---|---|---|
| Human involvement | Consent screen + browser redirect | Zero. Fully headless. |
| Round-trips | 5+ | 2 |
| Speed | Seconds (browser redirect) | < 500ms total |
| Secret exposure | Tokens sent every request | Private key never transmitted |

---

## Packages

### Core

| Package | Description | Status |
|---|---|---|
| `@agentgate/core` | Shared crypto, types, storage, rate limiting | Stable |
| `@agentgate/sdk` | Agent-side TypeScript SDK | Stable |
| `@agentgate/cli` | CLI tool (`npx agentgate init`) | Stable |
| `@agentgate/detect` | Agent traffic detection middleware | Stable |
| `agentgate` (Python) | Python Agent SDK | Stable |

### Framework Adapters

| Package | Description | Status |
|---|---|---|
| `@agentgate/express` | Express.js middleware | Stable |
| `@agentgate/next` | Next.js App Router adapter | Stable |
| `@agentgate/hono` | Hono middleware (Workers/Deno/Bun) | Stable |
| `@agentgate/fastify` | Fastify plugin with schema validation | Stable |
| `agentgate-fastapi` (Python) | FastAPI middleware adapter | Stable |
| `@agentgate/cloudflare` | Cloudflare Workers adapter with Durable Objects | Stable |
| `@agentgate/vercel` | Vercel Edge middleware | Stable |

### Auth Provider Companions

| Package | Description | Status |
|---|---|---|
| `@agentgate/auth0` | Auth0 companion -- register agents as M2M clients | Stable |
| `@agentgate/clerk` | Clerk companion -- agent accounts visible in Clerk dashboard | Stable |
| `@agentgate/firebase` | Firebase companion -- agent accounts as Firebase Auth users | Stable |
| `@agentgate/stytch` | Stytch companion -- bridge agents with Stytch Connected Apps | Stable |
| `@agentgate/supabase` | Supabase plugin -- store agent records with RLS support | Stable |
| `@agentgate/next-auth` | NextAuth.js companion -- agent provider for NextAuth | Stable |

### Integrations

| Package | Description | Status |
|---|---|---|
| `@agentgate/stripe` | Stripe billing bridge -- reconcile x402 payments as Stripe invoices | Stable |
| `@agentgate/bazaar` | x402 Bazaar -- auto-list services on the x402 marketplace | Stable |
| `@agentgate/registry` | Agent Registry -- crawled directory of AgentGate-enabled services | Stable |
| `@agentgate/dashboard` | Agent analytics dashboard (Next.js) | Beta |

### Deployment Templates

| Template | Description |
|---|---|
| `template-railway` | Railway deployment template -- Express + AgentGate |
| `template-cloudflare` | Cloudflare Workers template -- Hono + AgentGate |
| `template-vercel` | Vercel template -- Next.js + AgentGate |

---

## Project Structure

```
agentgate/
├── packages/
│   ├── core/                 # Shared logic (crypto, types, storage)
│   ├── express/              # Express.js middleware
│   ├── next/                 # Next.js adapter
│   ├── hono/                 # Hono middleware
│   ├── fastify/              # Fastify plugin
│   ├── sdk/                  # Agent-side TypeScript SDK
│   ├── detect/               # Agent traffic detection
│   ├── cli/                  # CLI tool
│   ├── python-sdk/           # Python Agent SDK (agentgate)
│   ├── fastapi-adapter/      # FastAPI middleware (agentgate-fastapi)
│   ├── cloudflare/           # Cloudflare Workers adapter
│   ├── vercel/               # Vercel Edge middleware
│   ├── auth0/                # Auth0 companion plugin
│   ├── clerk/                # Clerk companion plugin
│   ├── firebase/             # Firebase companion plugin
│   ├── stytch/               # Stytch companion plugin
│   ├── supabase/             # Supabase plugin
│   ├── next-auth/            # NextAuth.js companion plugin
│   ├── stripe/               # Stripe billing bridge
│   ├── bazaar/               # x402 Bazaar integration
│   ├── registry/             # Agent registry service
│   ├── template-railway/     # Railway deployment template
│   ├── template-cloudflare/  # Cloudflare Workers template
│   └── template-vercel/      # Vercel deployment template
├── apps/
│   └── dashboard/            # Agent dashboard (Next.js)
├── examples/
│   ├── express-weather-api/  # Express example
│   ├── nextjs-saas/          # Next.js example
│   ├── hono-cloudflare/      # Cloudflare Workers example
│   ├── python-fastapi/       # Python FastAPI example
│   ├── agent-typescript/     # Agent SDK example
│   └── agent-langchain/      # LangChain integration
├── docs/                     # Documentation
├── tests/                    # Integration tests
├── turbo.json                # Turborepo config
├── pnpm-workspace.yaml       # Workspace config
└── package.json
```

---

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck

# Development mode (watch)
pnpm dev
```

### Requirements

- Node.js >= 18
- pnpm >= 9

---

## Sitting Alongside Clerk

AgentGate doesn't replace your existing auth. It sits alongside it:

| Concern | Clerk (Humans) | AgentGate (Agents) |
|---|---|---|
| Registration | Email, social OAuth, magic links | Keypair + signed challenge, headless API |
| Authentication | Session cookies, JWTs | Signed request headers or short-lived token |
| Payment setup | Stripe checkout, credit card | x402 auto-configured at registration |
| Identity | Name, email, avatar | Public key / x402 wallet, scopes |
| Lifecycle | Signup → verify → login → use | Register → use (one step) |

---

## Configuration Reference

```typescript
import { agentgate } from "@agentgate/express";

app.use(agentgate({
  // Required: Define available scopes
  scopes: [
    { id: "data.read", description: "Read data", price: "$0.001/req", rateLimit: "1000/hour" },
    { id: "data.write", description: "Write data", price: "$0.01/req", rateLimit: "100/hour" }
  ],

  // Rate limiting (optional)
  rateLimit: {
    default: { requests: 1000, window: "1h" },
    registration: { requests: 10, window: "1h" }
  },

  // x402 payment integration (optional)
  x402: {
    network: "base",
    currency: "USDC",
    paymentAddress: "0xYourWallet...",
    facilitator: "https://x402.org/facilitator"
  },

  // Storage backend (optional, defaults to in-memory)
  storage: {
    driver: "memory"  // "memory" | "sqlite" | "postgres" | "redis"
  },

  // Crypto config (optional)
  signing: {
    algorithm: "ed25519"  // "ed25519" | "secp256k1"
  },

  // JWT config (optional)
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: "1h"
  },

  // Companion protocol generation (optional)
  companion: {
    a2aAgentCard: true,   // Auto-gen /.well-known/agent-card.json
    mcpServer: false,     // Auto-gen /mcp endpoint
    oauthCompat: false    // OAuth endpoints for MCP clients
  },

  // Service metadata (optional)
  service: {
    name: "My API",
    description: "My agent-ready API",
    docsUrl: "https://docs.example.com",
    supportEmail: "agents@example.com"
  },

  // API key mode (optional, defaults to "live")
  mode: "live",  // "live" → agk_live_... keys, "test" → agk_test_... keys

  // Lifecycle hooks (optional)
  onAgentRegistered: (agent) => console.log(`New agent: ${agent.id}`),
  onAgentAuthenticated: (agent) => console.log(`Agent auth: ${agent.id}`)
}));
```

---

## API Reference

### Discovery

```
GET /.well-known/agentgate.json
```

Returns the service discovery document. CDN-cacheable (`Cache-Control: public, max-age=3600`).

### Registration

```
POST /agentgate/register

{
  "public_key": "base64-ed25519-public-key",
  "scopes_requested": ["data.read"],
  "x402_wallet": "0x1234...abcd",
  "metadata": { "framework": "langchain", "version": "0.2.0" }
}

→ 201 { "agent_id": "ag_xxx", "challenge": { "nonce": "...", "message": "...", "expires_at": "..." } }
```

### Challenge Verification

```
POST /agentgate/register/verify

{
  "agent_id": "ag_xxx",
  "signature": "base64-ed25519-signature"
}

→ 200 { "agent_id": "ag_xxx", "api_key": "agk_live_xxx", "scopes_granted": [...], "token": "eyJ...", "rate_limit": {...} }
```

### Returning Agent Auth

```
POST /agentgate/auth

{
  "agent_id": "ag_xxx",
  "timestamp": "2026-02-08T12:30:00Z",
  "signature": "base64-signature"
}

→ 200 { "token": "eyJ...", "expires_at": "..." }
```

### Protected Routes

```
GET /api/your-endpoint
Authorization: Bearer agk_live_xxx
X-PAYMENT: <x402-payment-payload>   (optional)
```

---

## Technical Details

- **Zero native dependencies** — Pure JS crypto (tweetnacl). No `node-gyp`. Works everywhere.
- **< 5ms auth verification** — Ed25519 signature verification is fast.
- **< 2ms middleware overhead** — Minimal impact on request latency.
- **< 50KB SDK** — Lightweight for constrained agent environments.
- **Pluggable storage** — In-memory (dev) → SQLite → Postgres.
- **Node.js >= 18** — Native crypto, ES modules.

### Core Dependencies

| Package | Purpose | Size |
|---|---|---|
| `tweetnacl` | Ed25519 crypto | 8KB, audited, pure JS |
| `jose` | JWT issuance/verification | Standards-compliant |
| `zod` | Schema validation | Config + API input |
| `nanoid` | ID generation | Agent IDs + nonces |
| `@noble/secp256k1` | x402 wallet compat | Pure JS |

---

## Documentation

- [Quick Start Guide](./docs/quickstart.md)
- [Configuration Reference](./docs/configuration.md)
- [API Reference](./docs/api-reference.md)
- [Agent SDK Guide](./docs/agent-sdk.md)
- [FAQ](./docs/faq.md)

---

## License

MIT
