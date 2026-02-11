# AgentDoor

[![CI](https://github.com/0xaron/agentdoor/actions/workflows/ci.yml/badge.svg)](https://github.com/0xaron/agentdoor/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@agentdoor/core.svg)](https://www.npmjs.com/package/@agentdoor/core)
[![PyPI version](https://img.shields.io/pypi/v/agentdoor.svg)](https://pypi.org/project/agentdoor/)
[![Coverage](https://img.shields.io/badge/coverage-%E2%89%A580%25-brightgreen.svg)](https://github.com/0xaron/agentdoor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)

**The pre-auth layer for the agentic internet.**

> Make your website agent-ready in 3 lines of code. Let AI agents register, authenticate, and pay for your API — programmatically, in under 500ms, with zero browser automation.

---

## The Problem

AI agents can pay for APIs (x402), discover tools (MCP), and talk to each other (A2A). But they still **can't sign up for your product** without opening a browser, filling out forms, and solving CAPTCHAs.

The pre-auth funnel — registration → credential issuance → billing setup — was designed entirely for humans. Agents resort to slow (30–60s), fragile browser automation that breaks on every UI change.

**What agents do today:** Browser automation to navigate signup flows.
**What they should do:** One HTTP POST → registered, credentialed, billing-ready. Under 500ms. No browser.

---

## How It Works

```
Agent                              SaaS (with AgentDoor middleware)
  │                                         │
  │── GET /.well-known/agentdoor.json ────▶│  (1) Discovery
  │◀── {scopes, pricing, endpoints} ───────│      ~50ms
  │                                         │
  │── POST /agentdoor/register ───────────▶│  (2) Register
  │   {public_key, scopes, x402_wallet}    │
  │◀── {agent_id, nonce} ─────────────────│      ~100ms
  │                                         │
  │── POST /agentdoor/register/verify ────▶│  (3) Challenge-Response
  │   {agent_id, signature(nonce)}         │
  │◀── {api_key, token, rate_limits} ─────│      ~200ms
  │                                         │
  │── GET /api/data ──────────────────────▶│  (4) Ready
  │   Authorization: Bearer agk_xxx        │      Ongoing
  │◀── {data} ────────────────────────────│
  │                                         │
  │  ... JWT expires (default: 1 hour) ...  │
  │                                         │
  │── POST /agentdoor/auth ───────────────▶│  (5) Token Refresh
  │   {agent_id, timestamp, signature}     │      (automatic in SDK)
  │◀── {token, expires_at} ───────────────│      ~50ms
```

**Total: < 500ms.** Compare: browser automation = 30–60s.

---

## Quick Start

### For SaaS Owners (3-Line Integration)

```bash
npm install @agentdoor/express
```

```javascript
const express = require("express");
const agentdoor = require("@agentdoor/express");

const app = express();

app.use(agentdoor({
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
- `/.well-known/agentdoor.json` — auto-generated discovery endpoint
- `/agentdoor/register` + `/agentdoor/register/verify` — headless agent registration
- `/agentdoor/auth` — token refresh via signed challenge (no browser, no password)
- Auth middleware applied to all your routes

### Using the CLI

```bash
# Auto-generate config from your OpenAPI spec
npx agentdoor init --from-openapi ./openapi.yaml

# Or interactive setup
npx agentdoor init
```

### For Agent Developers (< 500ms Onboarding)

```bash
npm install @agentdoor/sdk
```

```typescript
import { AgentDoor } from "@agentdoor/sdk";

const agent = new AgentDoor({
  keyPath: "~/.agentdoor/keys.json",   // auto-generates keypair if needed
  x402Wallet: "0x1234...abcd"          // optional: x402 wallet as identity
});

// Discover + register + auth in ONE call
const session = await agent.connect("https://api.example.com");

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
const agentdoor = require("@agentdoor/express");
app.use(agentdoor({ scopes: [{ id: "data.read", description: "Read" }] }));
```

### Next.js (App Router)

```typescript
import { agentdoor } from "@agentdoor/next";

export default agentdoor({
  scopes: [{ id: "data.read", description: "Read" }],
  pricing: { "data.read": "$0.001/req" }
});

export const config = { matcher: ["/api/:path*"] };
```

### Hono (Cloudflare Workers / Deno / Bun)

```typescript
import { Hono } from "hono";
import { agentdoor } from "@agentdoor/hono";

const app = new Hono();
app.use("*", agentdoor({
  scopes: [{ id: "data.read", description: "Read" }]
}));
```

### Fastify

```typescript
import Fastify from "fastify";
import { agentdoor } from "@agentdoor/fastify";

const app = Fastify();
app.register(agentdoor, {
  scopes: [{ id: "data.read", description: "Read" }]
});
```

### FastAPI (Python)

```python
from fastapi import Depends, FastAPI
from agentdoor_fastapi import AgentDoor, AgentDoorConfig, AgentContext

app = FastAPI()
gate = AgentDoor(app, config=AgentDoorConfig(
    service_name="My API",
    scopes=[{"name": "read", "description": "Read access"}],
))

@app.get("/protected")
async def protected(agent: AgentContext = Depends(gate.agent_required())):
    return {"agent": agent.agent_id}
```

---

## Agent Traffic Detection

Don't know if you need AgentDoor? Start with detect-only mode (free):

```javascript
const { detect } = require("@agentdoor/detect");

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

AgentDoor uses `/.well-known/agentdoor.json` for agent discovery (similar to `/.well-known/openid-configuration`):

```json
{
  "agentdoor_version": "1.0",
  "service_name": "Example API",
  "service_description": "Real-time weather data and forecasts",
  "registration_endpoint": "/agentdoor/register",
  "auth_endpoint": "/agentdoor/auth",
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

One AgentDoor integration auto-generates companion protocol files:

| File | Protocol | Status |
|---|---|---|
| `/.well-known/agentdoor.json` | AgentDoor | Primary |
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

<details>
<summary><strong>Token Refresh (signature-based)</strong></summary>

JWTs are short-lived (default: 1 hour). When a token expires, agents refresh via `POST /agentdoor/auth` by signing a fresh timestamp with their Ed25519 private key — more secure than typical refresh tokens because it requires proof of key ownership on every renewal. **The SDK handles this automatically.**

```typescript
// Token refresh is transparent. Just make requests.
const data = await session.get("/api/data");  // auto-refreshes if needed
```

| | Typical Refresh Token | AgentDoor `/agentdoor/auth` |
|---|---|---|
| Stolen token risk | Refresh token = unlimited access | Stolen JWT alone can't refresh |
| Proof of identity | None (just present the token) | Ed25519 signature every time |
| Security model | Trust-the-token | Zero-trust (prove key ownership) |

</details>

### Why Not Just OAuth?

| | OAuth 2.1 | AgentDoor |
|---|---|---|
| Human involvement | Consent screen + browser redirect | Zero. Fully headless. |
| Round-trips | 5+ | 2 |
| Speed | Seconds (browser redirect) | < 500ms total |
| Secret exposure | Tokens sent every request | Private key never transmitted |

---

## Works With Your Existing Auth

AgentDoor doesn't replace your existing auth provider — it sits alongside it. Human users keep signing in through Clerk, Auth0, Firebase, or whatever you already use. Agents get their own headless path:

| Concern | Your Auth Provider (Humans) | AgentDoor (Agents) |
|---|---|---|
| Registration | Email, social OAuth, magic links | Keypair + signed challenge, headless API |
| Authentication | Session cookies, JWTs | Signed request headers or short-lived token |
| Payment setup | Stripe checkout, credit card | x402 auto-configured at registration |
| Identity | Name, email, avatar | Public key / x402 wallet, scopes |
| Lifecycle | Signup → verify → login → use | Register → use (one step) |

---

## Packages

### Core

| Package | Description | Status |
|---|---|---|
| `@agentdoor/core` | Shared crypto, types, storage, rate limiting | Stable |
| `@agentdoor/sdk` | Agent-side TypeScript SDK | Stable |
| `@agentdoor/cli` | CLI tool (`npx agentdoor init`) | Stable |
| `@agentdoor/detect` | Agent traffic detection middleware | Stable |
| `agentdoor` (Python) | Python Agent SDK | Stable |

### Framework Adapters

| Package | Description | Status |
|---|---|---|
| `@agentdoor/express` | Express.js middleware | Stable |
| `@agentdoor/next` | Next.js App Router adapter | Stable |
| `@agentdoor/hono` | Hono middleware (Workers/Deno/Bun) | Stable |
| `@agentdoor/fastify` | Fastify plugin with schema validation | Stable |
| `agentdoor-fastapi` (Python) | FastAPI middleware adapter | Stable |
| `@agentdoor/cloudflare` | Cloudflare Workers adapter with Durable Objects | Stable |
| `@agentdoor/vercel` | Vercel Edge middleware | Stable |

<details>
<summary><strong>Auth Provider Companions</strong> (6 packages)</summary>

| Package | Description | Status |
|---|---|---|
| `@agentdoor/auth0` | Auth0 companion -- register agents as M2M clients | Stable |
| `@agentdoor/clerk` | Clerk companion -- agent accounts visible in Clerk dashboard | Stable |
| `@agentdoor/firebase` | Firebase companion -- agent accounts as Firebase Auth users | Stable |
| `@agentdoor/stytch` | Stytch companion -- bridge agents with Stytch Connected Apps | Stable |
| `@agentdoor/supabase` | Supabase plugin -- store agent records with RLS support | Stable |
| `@agentdoor/next-auth` | NextAuth.js companion -- agent provider for NextAuth | Stable |

</details>

<details>
<summary><strong>Integrations</strong> (4 packages)</summary>

| Package | Description | Status |
|---|---|---|
| `@agentdoor/stripe` | Stripe billing bridge -- reconcile x402 payments as Stripe invoices | Stable |
| `@agentdoor/bazaar` | x402 Bazaar -- auto-list services on the x402 marketplace | Stable |
| `@agentdoor/registry` | Agent Registry -- crawled directory of AgentDoor-enabled services | Stable |
| `@agentdoor/dashboard` | Agent analytics dashboard (Next.js) | Beta |

</details>

<details>
<summary><strong>Deployment Templates</strong> (3 templates)</summary>

| Template | Description |
|---|---|
| `template-railway` | Railway deployment template -- Express + AgentDoor |
| `template-cloudflare` | Cloudflare Workers template -- Hono + AgentDoor |
| `template-vercel` | Vercel template -- Next.js + AgentDoor |

</details>

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

<details>
<summary><strong>Project Structure</strong></summary>

```
agentdoor/
├── packages/
│   ├── core/                 # Shared logic (crypto, types, storage)
│   ├── express/              # Express.js middleware
│   ├── next/                 # Next.js adapter
│   ├── hono/                 # Hono middleware
│   ├── fastify/              # Fastify plugin
│   ├── sdk/                  # Agent-side TypeScript SDK
│   ├── detect/               # Agent traffic detection
│   ├── cli/                  # CLI tool
│   ├── python-sdk/           # Python Agent SDK (agentdoor)
│   ├── fastapi-adapter/      # FastAPI middleware (agentdoor-fastapi)
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

</details>

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

## Documentation

- [Quick Start Guide](./docs/quickstart.md) — Get running in 5 minutes
- [Configuration Reference](./docs/configuration.md) — All options with examples
- [API Reference](./docs/api-reference.md) — Discovery, registration, auth, and protected route endpoints
- [Agent SDK Guide](./docs/agent-sdk.md) — TypeScript and Python agent-side usage
- [FAQ](./docs/faq.md) — Common questions answered

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, coding standards, and PR guidelines.

- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Security Policy](./SECURITY.md) — Report vulnerabilities responsibly

---

## License

[MIT](./LICENSE)
