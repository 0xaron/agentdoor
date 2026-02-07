# AgentGate

### Make Your Website Agent-Ready in 3 Lines of Code

> The pre-auth layer for the agentic internet.
> Sits alongside Clerk. Lets agents register, authenticate, and pay—programmatically.
> **v3.0 · February 2026 · Confidential**

---

## Table of Contents

1. [The Problem](#1-the-problem)
2. [The Insight & Wedge](#2-the-insight--wedge)
3. [Competitive Landscape — Why Nobody Has Built This](#3-competitive-landscape--why-nobody-has-built-this)
4. [Product Vision](#4-product-vision)
5. [How It Works](#5-how-it-works)
6. [The Discovery Protocol](#6-the-discovery-protocol)
7. [Auth Mechanism](#7-auth-mechanism)
8. [Piggybacking Strategy — Framework & Ecosystem Integrations](#8-piggybacking-strategy--framework--ecosystem-integrations)
9. [Agent Traffic Intelligence (Supply-Side Hook)](#9-agent-traffic-intelligence--the-supply-side-hook)
10. [Target Users](#10-target-users)
11. [Feature Breakdown (P0 / P1 / P2)](#11-feature-breakdown)
12. [Agent-Side SDK](#12-agent-side-sdk)
13. [Dashboard & Analytics](#13-dashboard--analytics)
14. [Business Model](#14-business-model)
15. [Go-to-Market](#15-go-to-market)
16. [Success Metrics](#16-success-metrics)
17. [Technical Requirements](#17-technical-requirements)
18. [Technical Architecture — Implementation Spec](#18-technical-architecture--implementation-spec)
19. [Database Schema](#19-database-schema)
20. [CLI Specification](#20-cli-specification)
21. [Implementation Phases for Claude Code](#21-implementation-phases-for-claude-code)
22. [Testing Strategy](#22-testing-strategy)
23. [Risks & Mitigations](#23-risks--mitigations)
24. [Team](#24-founding-team)
25. [One-Page Summary](#25-one-page-summary)

---

## 1. The Problem

AI agents can now pay for APIs instantly via x402 (100M+ payments processed, multi-chain, V2 shipped Jan 2026), discover tools via MCP, and talk to each other via A2A. But they still **can't sign up for your product** without opening a browser, filling out forms, and entering a credit card.

The pre-auth funnel—registration → credential issuance → billing setup—was designed entirely for humans. An agent can't click "Sign in with Google," can't type a password, can't solve a CAPTCHA, can't enter a credit card.

**What agents do today:** OpenClaw agents (60K+ GitHub stars) literally open browsers to navigate Google Cloud Console and provision their own OAuth tokens. Virtuals Protocol agents use browser-use to register for services. This is browser automation—slow (30–60s), fragile (breaks on UI changes), expensive (compute-heavy), and blocked by bot detection.

**What they should do:** One HTTP POST → registered, credentialed, billing-ready. Under 500ms. No browser.

**And here's the thing most SaaS companies don't even realize:** they already have significant agent traffic. Bots are scraping, headless browsers are signing up, API traffic patterns show machine behavior. But SaaS companies have **zero visibility** into this. They can't distinguish agent requests from human requests. They can't monetize agent traffic differently. They can't set agent-specific rate limits. They're leaving money on the table and getting abused at the same time.

---

## 2. The Insight & Wedge

APIs already work for programmatic consumption. The actual product—data, service, compute—is already agent-accessible behind an API. The bottleneck is **exclusively the onboarding funnel**.

> **The wedge:** If you solve pre-auth for agents, you become the gateway through which every agent enters every SaaS product. Analogous to how Stripe became the way every website accepts payments, and how x402 became pay-per-request for agents. AgentGate becomes sign-up-per-agent.

| What Exists | What It Solves | The Gap |
|---|---|---|
| **Clerk / Auth0 / Firebase** | Human registration, login, sessions | No headless registration. No programmatic credential provisioning. Requires browser. |
| **x402 V2 (Coinbase)** | Agent payments via HTTP 402. 100M+ payments. Multi-chain. Wallet identity. | Assumes agent already has access. Doesn't handle signup or credential issuance. |
| **MCP (Anthropic)** | Tool discovery & agent-to-tool communication | Tells agents what tools exist, not how to get access. MCP OAuth requires consent screens. |
| **A2A + AP2 (Google)** | Agent-to-agent communication & payments | `/.well-known/agent-card.json` for agent discovery, not SaaS onboarding. AP2 adds payments but not registration. |
| **Browser automation** | Brute-force form filling | 30s+ per signup. Breaks on CAPTCHAs, UI changes, 2FA. Expensive compute. |
| **API keys (manual)** | Developer-to-developer access | Human must register and copy-paste. Not agent self-service. |

**AgentGate's position:** Clerk handles humans. AgentGate handles agents. They sit side by side. Same product, two doors.

---

## 3. Competitive Landscape — Why Nobody Has Built This

### 3.1 The Demand-Side vs Supply-Side Distinction

This is the crucial insight. **Every existing player is demand-side** (helping agents connect TO tools). **Nobody is supply-side** (helping SaaS owners receive agents).

| Player | Side | What They Do | Why Not AgentGate |
|---|---|---|---|
| **Composio AgentAuth** | Demand | Manages OAuth/API keys for agents connecting to 250+ tools. MCP tool router. | Helps agents auth TO tools. Does NOT help SaaS owners make their product agent-ready. Different buyer. |
| **Nango** | Demand | Open-source integration infra. OAuth handler for 600+ APIs. | Product integration platform. Helps YOUR product connect to OTHER APIs. Not a supply-side SDK. |
| **Arcade** | Demand | Secure MCP runtime for agent tool-calling with just-in-time permissions. | Enterprise governance for agent actions. Doesn't help SaaS owners onboard agents. |
| **Stytch Connected Apps** | Demand | OAuth auth for MCP servers. Best-in-class for MCP + OAuth 2.1. | Still human-in-the-loop: consent screens, browser redirects. Not headless agent self-registration. Focused on MCP, not general SaaS onboarding. |
| **Auth0 / Okta** | Both (sort of) | Extending IAM for agent use cases. | Bolting agent support onto human-centric OAuth. Enterprise pricing/complexity. No x402. No headless self-registration. |
| **1Password Agentic AI** | Demand | Credential management and secret injection for agents. | Agent-side credential vault. Doesn't help SaaS owners. |

### 3.2 Protocol-Level (Not Products)

| Protocol | Relevance | Gap |
|---|---|---|
| **A2A Agent Cards** | `/.well-known/agent-card.json` for discovery | Agent capabilities discovery, not SaaS onboarding. No registration flow. |
| **MCP OAuth 2.1** | Spec for MCP tool auth. DCR + PKCE. | Browser-redirect-based. Complex to implement. Not "3 lines of code." |
| **ANP Discovery** | Agent Network Protocol `.well-known` discovery | Protocol spec only. Agent-to-agent, not agent-to-SaaS. |
| **x402 V2** | Wallet-based identity + payments | Identity is a side feature of payments. No registration, scoping, or rate limiting. |
| **IETF CIMD** | Client ID Metadata Documents (draft) | Emerging standard for client identity in OAuth. Not a product. |

### 3.3 Our Five Edges

1. **Supply-side focus:** Everyone else solves demand-side. We're the only product that helps SaaS owners *receive* agents. Completely different buyer, different sales motion.

2. **Headless-first:** Stytch/Auth0 extend OAuth (consent screens, browser redirects). We're headless-native. Zero browser involvement.

3. **x402 V2 composability:** We compose with x402's wallet-based identity. Agent's x402 wallet IS their identity. Register with wallet → pay with wallet → one identity for both.

4. **DX obsession:** Stytch's MCP OAuth requires understanding DCR, PKCE, token endpoints, consent UI, protected resource metadata. AgentGate is `npx agentgate init --from-openapi ./spec.yaml` → done.

5. **Agent Traffic Intelligence:** Nobody else tells SaaS companies "you already have 15% agent traffic and don't know it." This analytics hook drives adoption before auth features even matter.

---

## 4. Product Vision

**AgentGate makes any website agent-ready in 3 lines of code.** Drop-in SDK that SaaS owners add alongside existing auth. Agents register headlessly, get instant credentials, pay via x402. One integration makes you discoverable across AgentGate, MCP, A2A, and x402 Bazaar.

### For the SaaS Owner (5-Minute Integration)

- **`npx agentgate init`** — reads your OpenAPI spec, infers scopes, generates config. Or answer 5 interactive questions.
- **3 lines of code** — add middleware to Express/Next.js/Hono/FastAPI. Done.
- **Instant agent traffic visibility** — see how much of your traffic is already agents, before you even turn on registration.
- **Agent registration + auth** — agents self-service register via headless API. No forms.
- **x402 billing auto-setup** — agent's wallet captured at registration. Pay-per-use from request #1.
- **Dashboard** — see agent users alongside human users. Usage, revenue, rate limits.
- **MCP + A2A auto-generated** — your service becomes discoverable via all major agent protocols automatically.

### For the Agent (< 500ms Onboarding)

- **One POST to register** → credentials returned. Live immediately.
- **x402 wallet = identity** — one wallet for auth + payments. No separate identity system.
- **Auto-discovery** — `/.well-known/agentgate.json` tells agents everything: scopes, pricing, how to register.
- **Cached credentials** — register once, reuse forever. SDK handles credential storage.

---

## 5. How It Works

### 5.1 The Onboarding Flow

```
Agent                              SaaS (with AgentGate middleware)
  │                                         │
  │─── GET /.well-known/agentgate.json ────▶│  (1) Discovery
  │◀── {scopes, pricing, endpoints} ────────│      ~50ms, CDN-cached
  │                                         │
  │─── POST /agentgate/register ───────────▶│  (2) Register
  │    {public_key, scopes, x402_wallet}    │
  │◀── {agent_id, nonce} ──────────────────│      ~100ms
  │                                         │
  │─── POST /agentgate/register/verify ────▶│  (3) Challenge-Response
  │    {agent_id, signature(nonce)}         │
  │◀── {api_key, token, rate_limits, ──────│      ~200ms
  │     x402_payment_address}               │
  │                                         │  (4) Ready
  │─── GET /api/data ─────────────────────▶│      Ongoing
  │    Authorization: Bearer agk_xxx        │
  │    X-PAYMENT: <x402 payload>            │
  │◀── {data} ─────────────────────────────│
```

**Total: < 500ms.** Compare: browser automation = 30–60s, fragile, blocked by CAPTCHAs.

### 5.2 The SaaS Owner Integration

```javascript
// Express.js — 3 lines added to existing app
const agentgate = require("@agentgate/express");

app.use(agentgate({
  scopes: ["data.read", "data.write"],
  pricing: { "data.read": "$0.001/req", "data.write": "$0.01/req" },
  rateLimit: { default: "1000/hour" },
  x402: { network: "base", currency: "USDC" }
}));

// That's it. Your API is now agent-ready.
// ✅ /.well-known/agentgate.json auto-generated
// ✅ /agentgate/register + /agentgate/auth endpoints mounted
// ✅ Agent auth middleware applied to all routes
// ✅ x402 payment integration wired
```

```typescript
// Next.js App Router — middleware.ts
import { agentgate } from "@agentgate/next";

export default agentgate({
  scopes: ["data.read", "data.write"],
  pricing: { "data.read": "$0.001/req" }
});

export const config = { matcher: ["/api/:path*"] };
```

```python
# FastAPI — 3 lines
from agentgate_fastapi import AgentGate

app = FastAPI()
AgentGate(app, scopes=["data.read", "data.write"], pricing={"data.read": "$0.001/req"})
```

### 5.3 Sitting Alongside Clerk

| Concern | Clerk (Humans) | AgentGate (Agents) |
|---|---|---|
| Registration | Email/password, social OAuth, magic links | Keypair/wallet + signed challenge, headless API |
| Authentication | Session cookies, JWTs, refresh tokens | Signed request headers or short-lived token |
| Payment setup | Stripe checkout, credit card form | x402 auto-configured at registration |
| Dashboard | User profiles, sessions, activity | Agent profiles, usage, spend, reputation |
| Identity | Name, email, avatar | Public key / x402 wallet, scopes, spend cap |
| Lifecycle | Signup → verify → login → use | Register → use (one step) |
| DB record | `users` table, `type: "human"` | `users` table, `type: "agent"` (same DB) |

---

## 6. The Discovery Protocol

### 6.1 `/.well-known/agentgate.json`

Follows convention of `/.well-known/openid-configuration` (OAuth) and `/.well-known/agent-card.json` (A2A):

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

### 6.2 Cross-Protocol Auto-Generation

One AgentGate integration auto-generates companion files:

| File | Protocol | Auto-Generated |
|---|---|---|
| `/.well-known/agentgate.json` | AgentGate | ✅ Primary |
| `/.well-known/agent-card.json` | A2A (Google) | ✅ From AgentGate config |
| `/mcp` | MCP (Anthropic) | ✅ Optional, from config + OpenAPI spec |
| `/.well-known/oauth-authorization-server` | OAuth 2.1 | ✅ For MCP clients requiring OAuth compat |

SaaS owner adds AgentGate once → discoverable across **all four** major agent protocols. This is the piggybacking superpower.

### 6.3 Agent Registry & x402 Bazaar

- **AgentGate Registry:** Crawled index of all `/.well-known/agentgate.json` endpoints on the web. Agents search: "weather API, <$0.01/req, x402, base chain."
- **x402 Bazaar Integration:** Services registered with AgentGate auto-list on x402 Bazaar for agent discovery.

---

## 7. Auth Mechanism

### 7.1 Three Auth Modes (Pragmatic, Not Dogmatic)

| Mode | When To Use | How It Works |
|---|---|---|
| **Ed25519 Challenge-Response** (default) | Best security. Agent generates keypair. | Agent signs server nonce. Private key never leaves agent. ~1ms verify. |
| **x402 Wallet Identity** (new in v3) | Agent already has x402 wallet. | Agent's x402 wallet address = identity. Signs challenge with wallet key. One identity for auth + payments. |
| **JWT Token** (compat) | After initial challenge-response. For caching. | Server issues short-lived JWT. Agent sends as Bearer token. Standard pattern. |

### 7.2 Why Not Just OAuth?

| Property | OAuth 2.1 (MCP approach) | AgentGate Challenge-Response |
|---|---|---|
| Human involvement | Requires consent screen + browser redirect | Zero. Fully headless. |
| Setup complexity | DCR, PKCE, token endpoints, consent UI, protected resource metadata | One POST with public key or wallet |
| Round-trips | 5+ (discovery → redirect → consent → code → token) | 2 (register → challenge-response) |
| Secret exposure | Tokens sent with every request | Private key never transmitted |
| Speed | Seconds (involves browser redirect) | < 500ms total |

### 7.3 OAuth Compatibility Mode (P2)

For MCP clients (Claude, ChatGPT) that require OAuth, AgentGate optionally exposes standard OAuth endpoints. But the primary path is headless challenge-response — faster, simpler, agent-native.

---

## 8. Piggybacking Strategy — Framework & Ecosystem Integrations

> **Core principle:** Don't make SaaS owners switch anything. Plug into what they already use. Make the integration so low-friction that saying "no" takes more effort than saying "yes."

### 8.1 Auth Provider Companion Plugins

| Existing Auth | AgentGate Plugin | What It Does |
|---|---|---|
| **Clerk** | `@agentgate/clerk` | Reads Clerk config. Auto-maps human plans to agent scopes. Agent accounts sync to Clerk dashboard via webhooks. SaaS owner sees humans AND agents in one place. |
| **Supabase Auth** | `@agentgate/supabase` | Agents registered as Supabase auth users with `is_agent: true`. Works with existing Row-Level Security policies. Agent data in same Postgres DB. |
| **Auth0** | `@agentgate/auth0` | Registers agents as M2M clients in Auth0 tenant. Bridges AgentGate auth tokens into Auth0 JWT format. |
| **NextAuth.js** | `@agentgate/next-auth` | Adds "agent" provider alongside Google, GitHub, etc. |
| **Firebase Auth** | `@agentgate/firebase` | Agent accounts as Firebase users with custom claims. |
| **Stytch** | `@agentgate/stytch` | Bridges with Connected Apps. Adds headless registration path alongside Stytch's OAuth. |

### 8.2 Framework Adapters

| Framework | Package | Notes |
|---|---|---|
| **Express.js** | `@agentgate/express` | Standard middleware. MVP. |
| **Next.js** (App Router) | `@agentgate/next` | Edge middleware + route handlers. `.well-known` via edge. |
| **Hono** | `@agentgate/hono` | Works on Cloudflare Workers, Deno, Bun. Edge-native. |
| **Fastify** | `@agentgate/fastify` | Plugin with JSON schema validation. |
| **FastAPI** | `agentgate-fastapi` | Python. Pydantic models + dependency injection. |
| **Django** | `django-agentgate` | Middleware + URL conf + Django admin integration. |
| **Rails** | `agentgate-rails` | Rack middleware + Rails engine. |
| **Laravel** | `agentgate-laravel` | Laravel middleware + Artisan commands. |
| **Vercel Edge** | `@agentgate/vercel` | Edge middleware. One-click deploy template. |
| **Cloudflare Workers** | `@agentgate/cloudflare` | Durable Objects for state. Composes with x402 Workers SDK. |

### 8.3 The Killer DX Feature: OpenAPI Auto-Import

```bash
$ npx agentgate init --from-openapi ./openapi.yaml

🔍 Reading OpenAPI spec...
✅ Found 23 endpoints across 4 tags
✅ Auto-generated scopes:
   - weather.read     (GET /weather/*)       → $0.001/req
   - weather.forecast (GET /forecast/*)      → $0.01/req
   - weather.alerts   (GET /alerts/*)        → $0.005/req
   - weather.write    (POST/PUT /weather/*)  → $0.02/req
✅ Generated agentgate.config.ts
✅ Generated /.well-known/agentgate.json
✅ Generated /.well-known/agent-card.json (A2A compat)
✅ Generated middleware snippet for Express.js

📋 Next: Add 3 lines to your server:
   const agentgate = require("@agentgate/express");
   const config = require("./agentgate.config");
   app.use(agentgate(config));

⏱️  Total setup time: ~2 minutes
```

Most SaaS already has an OpenAPI spec (or can generate one). AgentGate reads it, infers scopes from endpoint paths/methods, suggests pricing based on operation complexity, and generates everything. Developer reviews and deploys. **True 5-minute integration.**

### 8.4 Stripe Billing Bridge

SaaS companies already use Stripe. Don't make them switch:

```javascript
agentgate({
  // ...config
  billing: {
    bridge: "stripe",
    stripeSecretKey: process.env.STRIPE_SECRET_KEY
    // x402 payments auto-reconcile as Stripe invoice items
    // All revenue (human + agent) visible in one Stripe dashboard
  }
})
```

Agent pays USDC via x402 → AgentGate receives → creates Stripe invoice item → SaaS owner sees everything in Stripe. No new billing infra.

### 8.5 Deployment Templates (One-Click)

| Platform | Template | What It Deploys |
|---|---|---|
| **Vercel** | "Agent-Ready API Starter" | Next.js + AgentGate + x402 + Neon Postgres |
| **Cloudflare** | "Agent-Ready Worker" | Hono + AgentGate + x402 + D1 |
| **Railway** | "Agent-Ready Express API" | Express + AgentGate + x402 + Postgres |

---

## 9. Agent Traffic Intelligence — The Supply-Side Hook

> **This is the Trojan horse.** Most SaaS companies don't know they need agent auth. But they DO know they want to understand their traffic. Lead with analytics, upsell auth.

### 9.1 The Problem Nobody Talks About

SaaS companies have growing agent traffic and don't know it:

- Headless browsers signing up with generated emails
- API requests with LangChain/CrewAI user-agent strings
- Burst traffic patterns that look like machines, not humans
- Requests from cloud IPs (agent hosting providers)
- Suspiciously fast, sequential API consumption patterns

### 9.2 Agent Traffic Detection (Lightweight Middleware)

Even before enabling registration, AgentGate can run in **detect-only mode**:

```javascript
// Detection mode — no registration, just visibility
app.use(agentgate.detect({
  webhook: "https://hooks.yoursite.com/agent-traffic"
}));
```

This middleware fingerprints requests and classifies them:

| Signal | Weight | How |
|---|---|---|
| User-Agent strings | High | Known agent frameworks (LangChain, CrewAI, OpenClaw, AutoGen, "python-requests") |
| Request timing | Medium | Machine-speed sequential requests, consistent intervals |
| IP ranges | Medium | Known cloud/agent hosting providers |
| Header patterns | Medium | Missing typical browser headers (Accept-Language, Cookie, Referer) |
| Behavioral patterns | High | No session cookies, no JS execution, API-only traffic |
| Self-identification | Definitive | `X-Agent-Framework: langchain/0.2` header (emerging convention) |

### 9.3 The Upgrade Path

```
Detect-only (free) → "You have 18% agent traffic!"
         ↓
Enable registration → "Now agents register properly"
         ↓
Enable x402 billing → "Now agents pay per request"
         ↓
Dashboard + analytics → "See revenue by agent"
```

This is the PLG funnel. Start free with detection. Upgrade when the data is compelling.

---

## 10. Target Users

### 10.1 Primary: SaaS Developers (Supply Side)

**Persona:** Full-stack dev at 5–50 person SaaS company. Uses Next.js + Clerk + Stripe + Vercel. Has an API. Sees mysterious traffic patterns. Budget: can spend $49–199/mo on infra tools without approval.

> *"I see weird traffic that looks like bots. Some sign up with obviously fake emails. I want to understand it and monetize it."*

### 10.2 Secondary: API-First Companies

**Persona:** Dev at a data/API company (weather, financial data, maps, LLM gateway). Already sells API access. Wants to capture the agent economy without building custom onboarding.

> *"Agents are 30% of my API calls but they all registered via browser automation. I want to give them a proper door and charge appropriately."*

### 10.3 Tertiary: Agent Developers (Demand Side)

**Persona:** Dev building agents with LangChain/CrewAI/OpenClaw. Tired of writing Playwright scripts to sign up for services.

> *"My agent needs 15 APIs. `agentgate.connect(url)` for each one is so much better than 15 browser automations."*

---

## 11. Feature Breakdown

### 11.1 P0 — MVP (Month 1–3)

| # | Feature | Description | Package |
|---|---|---|---|
| 1 | **Core: Discovery Endpoint** | Auto-generated `/.well-known/agentgate.json` from config | `@agentgate/core` |
| 2 | **Core: Agent Registration** | `POST /agentgate/register` — public key + scopes → challenge → credentials | `@agentgate/core` |
| 3 | **Core: Challenge-Response Auth** | Ed25519 nonce-based. Agent signs, server verifies. < 5ms. | `@agentgate/core` |
| 4 | **Core: x402 Wallet Identity** | Agent registers with x402 wallet address. One identity for auth + payments. | `@agentgate/core` |
| 5 | **Core: Scoped API Key Issuance** | JWT with scope claims. Configurable scopes per agent. | `@agentgate/core` |
| 6 | **Core: Rate Limiting** | Per-agent rate limits. Token bucket. In-memory + optional Redis. | `@agentgate/core` |
| 7 | **Core: Agent Storage Interface** | Pluggable: in-memory (dev) → SQLite → Postgres → Redis | `@agentgate/core` |
| 8 | **Express Middleware** | 3-line drop-in. Mounts all endpoints. Auth middleware. | `@agentgate/express` |
| 9 | **Next.js Adapter** | Edge middleware + App Router route handlers. | `@agentgate/next` |
| 10 | **Hono Middleware** | Cloudflare Workers / Deno / Bun compatible. | `@agentgate/hono` |
| 11 | **TypeScript Agent SDK** | `agentgate.connect(url)` — full discovery → register → auth flow. | `@agentgate/sdk` |
| 12 | **CLI: `agentgate init`** | Interactive setup OR `--from-openapi ./spec.yaml` auto-import. | `@agentgate/cli` |
| 13 | **A2A Agent Card Auto-Gen** | Generate `/.well-known/agent-card.json` from config. | `@agentgate/core` |
| 14 | **Agent Traffic Detection** | Detect-only mode. Classify requests as human/agent. Webhook. | `@agentgate/detect` |

### 11.2 P1 — Growth (Month 3–6)

| Feature | Description |
|---|---|
| **Agent Dashboard** | Web UI: registered agents, usage graphs, revenue, rate limits. Deploy as standalone or embed. |
| **Python Agent SDK** | `agentgate.connect(url)` for Python agents. LangChain/CrewAI integration. |
| **FastAPI Adapter** | Python server-side middleware. Pydantic models. |
| **Clerk Companion Plugin** | `@agentgate/clerk` — agent accounts visible in Clerk. Webhook sync. |
| **Supabase Plugin** | Agent rows in Supabase auth. RLS compatible. |
| **Reputation System** | Per-agent score: payment success rate, rate limit compliance, error rate. Gating. |
| **Webhook Events** | `agent.registered`, `agent.authenticated`, `agent.payment_failed`, `agent.rate_limited`, `agent.flagged` |
| **Spending Caps** | Max daily/monthly spend per agent. Hard + soft limits. |
| **Agent Registry** | Searchable directory. Crawled from `.well-known`. API + web UI. |
| **Stripe Billing Bridge** | x402 → Stripe invoice items. Unified revenue dashboard. |
| **Vercel / Cloudflare Templates** | One-click deploy starters. |
| **x402 Bazaar Integration** | Auto-list on x402 Bazaar for agent discovery. |

### 11.3 P2 — Platform (Month 6–12)

| Feature | Description |
|---|---|
| **MCP Server Auto-Gen** | Generate MCP server from AgentGate config + OpenAPI spec. Full MCP compat. |
| **OAuth 2.1 Compat Mode** | Standard OAuth endpoints for MCP clients requiring OAuth (Claude, ChatGPT). |
| **Delegation Chains** | Human → Agent → Sub-agent. Verifiable authorization chain. |
| **Selective Disclosure (ZKP)** | Prove "reputation > 90%" without revealing exact score. |
| **Agent-to-Agent Auth** | Mutual auth for A2A protocol interactions. |
| **Enterprise Admin** | Org-wide agent policies, audit logs, SSO-linked provisioning, compliance. |
| **Django / Rails / Laravel Adapters** | Full server-side middleware for Python/Ruby/PHP. |
| **Composio / Nango Bridges** | Bridge AgentGate credentials into demand-side platforms. |
| **AP2 Payment Protocol Compat** | Full Google AP2 support for agent payments. |
| **Deferred Payment Scheme** | x402 V2 deferred payments for enterprise/subscription use cases. |

---

## 12. Agent-Side SDK

### 12.1 TypeScript

```typescript
import { AgentGate } from "@agentgate/sdk";

// Initialize with keypair (auto-generates if none exists)
const agent = new AgentGate({
  keyPath: "~/.agentgate/keys.json",  // or auto-generate ephemeral
  x402Wallet: "0x1234...abcd"         // optional: use x402 wallet as identity
});

// Discover + register + auth in ONE call
const session = await agent.connect("https://api.weatherco.com");
// Internally:
// 1. GET /.well-known/agentgate.json (cached after first fetch)
// 2. POST /agentgate/register {public_key, scopes, wallet}
// 3. Sign challenge nonce
// 4. POST /agentgate/register/verify {signature}
// 5. Store credentials locally

// Make authenticated + paid requests
const data = await session.get("/weather/forecast", {
  params: { city: "sf" },
  x402: true  // auto-attach x402 payment header
});

// Cached: next connect() skips registration
const session2 = await agent.connect("https://api.stockdata.com");
```

### 12.2 Python

```python
from agentgate import AgentGate

agent = AgentGate(key_path="~/.agentgate/keys.json")
session = agent.connect("https://api.weatherco.com")
data = session.get("/weather/forecast", params={"city": "sf"}, x402=True)
```

### 12.3 LangChain Tool

```python
from agentgate.integrations.langchain import AgentGateToolkit

toolkit = AgentGateToolkit(key_path="~/.agentgate/keys.json")
tools = toolkit.get_tools(["https://api.weatherco.com", "https://api.stockdata.com"])
# Auto-discovers, registers, and wraps each API as a LangChain tool
agent = initialize_agent(tools, llm, agent="zero-shot-react-description")
```

### 12.4 OpenClaw Skill

```yaml
name: agentgate
description: Auto-register and authenticate with AgentGate-enabled services
triggers: ["register for *", "sign up for *", "get access to *"]
```

---

## 13. Dashboard & Analytics

### 13.1 Agent Traffic Dashboard (Free Tier Hook)

Even on free tier, SaaS owners get:

- **Agent vs. Human traffic split** — percentage of API calls from agents
- **Agent framework breakdown** — which frameworks are using your API (LangChain 42%, CrewAI 28%, custom 30%)
- **Top agents by volume** — your heaviest agent users
- **Unregistered agent traffic** — agents hitting your API without AgentGate registration (opportunity!)

### 13.2 Full Dashboard (Paid Tier)

- **Agent Overview:** Total registered, active, new registrations over time
- **Usage Analytics:** Requests per agent, popular scopes, peak hours, latency
- **Revenue:** x402 revenue from agents. Compare to human revenue (Stripe bridge).
- **Revenue per agent:** Which agents are your most valuable "customers"?
- **Rate Limiting:** Agents hitting limits, throttle events, suggested limit changes
- **Reputation:** Agent reputation distribution, flagged agents, auto-ban suggestions
- **Configuration:** Live-edit scopes, pricing, rate limits, spending caps
- **Alerts:** Webhook events, anomaly detection, abuse patterns

---

## 14. Business Model

### 14.1 Pricing

| Tier | Price | Includes |
|---|---|---|
| **Free** | $0 | Agent traffic detection (unlimited). 100 registrations/mo. 10K verifications/mo. Basic dashboard. |
| **Pro** | $49/mo + $0.001/verification over 50K | Unlimited registrations. Full dashboard. Webhooks. Reputation. Stripe bridge. |
| **Scale** | $199/mo + $0.0005/verification over 500K | Everything in Pro. Agent Registry listing. MCP server auto-gen. Priority support. |
| **Enterprise** | Custom | On-prem. SSO. Audit logs. Compliance. Dedicated support. SLA. Custom auth methods. |

### 14.2 PLG Funnel

```
Free (detect traffic) → "18% of your traffic is agents!"
         ↓
Free (enable registration) → "47 agents registered this week"
         ↓
Pro (dashboard + webhooks) → "You're earning $230/mo from agents via x402"
         ↓
Scale (registry + MCP) → "Agents are discovering you automatically"
         ↓
Enterprise → "$50K+ in agent revenue, need compliance"
```

### 14.3 Why This Works

- **Massive TAM:** Every SaaS with an API. 100M+ x402 payments already flowing.
- **Strong wedge:** Pre-auth is the narrowest chokepoint. Solve it → you're in every request.
- **Network effects:** More SaaS → more agents → more SaaS. Registry amplifies this.
- **Land and expand:** Detect (free) → register (free) → dashboard ($49) → enterprise ($50K+).
- **Low churn:** Once agent traffic flows through AgentGate, switching costs increase with volume.

---

## 15. Go-to-Market

### Phase 1: Developer Love (Month 1–3)

- Open-source `@agentgate/core`, `@agentgate/express`, `@agentgate/next`, `@agentgate/sdk`, `@agentgate/cli`
- Ship `npx agentgate init --from-openapi` as the hero feature
- Build 5 demos: weather API, stock data, image gen, doc parser, LLM gateway
- Write "Make Your API Agent-Ready in 5 Minutes" → Hacker News, dev Twitter
- Ship detection middleware first — let SaaS companies SEE their agent traffic before committing to registration
- Vercel template: "Agent-Ready API Starter"
- **Target:** 200 devs, 30 APIs, 2K GitHub stars

### Phase 2: Ecosystem (Month 4–8)

- Clerk + Supabase companion plugins
- Agent Registry launch (crawled directory)
- x402 Bazaar integration
- Python SDK + FastAPI adapter
- LangChain / CrewAI integrations
- Dashboard + Stripe bridge (paid tier launch)
- **Target:** 2K devs, 300 APIs, $10K MRR

### Phase 3: Platform (Month 9–12)

- MCP server auto-gen
- OAuth compat mode
- Enterprise pilot
- Propose `/.well-known/agentgate.json` as IETF draft
- AP2 integration
- **Target:** 10K devs, 2K APIs, $50K MRR

---

## 16. Success Metrics

### North Star: Monthly Agent Registrations (MAR)

| Metric | 3-Month | 6-Month | 12-Month |
|---|---|---|---|
| APIs with AgentGate | 30 | 300 | 2,000 |
| Monthly agent registrations | 1,000 | 25,000 | 500,000 |
| Monthly auth verifications | 10,000 | 500,000 | 25,000,000 |
| GitHub stars | 2,000 | 8,000 | 20,000 |
| Avg integration time (SaaS) | < 15 min | < 10 min | < 5 min |
| Avg agent onboarding time | < 1s | < 500ms | < 500ms |
| MRR | $0 | $10K | $50K |

---

## 17. Technical Requirements

| Requirement | Target | Notes |
|---|---|---|
| Agent registration latency | < 500ms e2e | Faster than human signup by 100x |
| Auth verification latency | < 5ms middleware | Must not bottleneck hot API paths |
| Middleware overhead | < 2ms/request | SaaS owners won't add anything slow |
| Discovery endpoint | Static JSON, CDN-cacheable | `Cache-Control: public, max-age=3600` |
| SDK bundle size (TS) | < 50KB gzipped | Agents in constrained envs |
| SDK bundle size (Python) | < 50KB | Minimal deps |
| Key algorithms | Ed25519 (default), secp256k1 (x402/wallet compat) | Ed25519 for speed, secp256k1 for interop |
| Availability | 99.95% hosted | Registration is critical path |
| Middleware compat (MVP) | Express 4/5, Next.js 14/15, Hono 4 | ~80% of JS API ecosystem |
| Data stored | Public keys + metadata only | We are middleware, not a vault |
| Node.js version | >= 18 | Native crypto, ES modules |
| Zero native deps | Required | Pure JS crypto (tweetnacl). No compilation issues. |

---

## 18. Technical Architecture — Implementation Spec

### 18.1 Monorepo Structure

```
agentgate/
├── packages/
│   ├── core/                      # Shared logic
│   │   ├── src/
│   │   │   ├── crypto.ts          # Ed25519 + secp256k1 via tweetnacl
│   │   │   ├── types.ts           # All TypeScript interfaces
│   │   │   ├── config.ts          # AgentGateConfig schema (zod)
│   │   │   ├── discovery.ts       # Generate .well-known JSON files
│   │   │   ├── challenge.ts       # Nonce gen, challenge-response logic
│   │   │   ├── tokens.ts          # JWT issuance + verification (jose)
│   │   │   ├── rate-limiter.ts    # Token bucket rate limiter
│   │   │   ├── storage/
│   │   │   │   ├── interface.ts   # AgentStore interface
│   │   │   │   ├── memory.ts      # In-memory Map (dev/test)
│   │   │   │   ├── sqlite.ts      # better-sqlite3
│   │   │   │   └── postgres.ts    # pg / @neondatabase/serverless
│   │   │   ├── detect.ts          # Agent traffic fingerprinting
│   │   │   ├── a2a.ts             # A2A agent card generation
│   │   │   ├── errors.ts          # Typed error classes
│   │   │   ├── constants.ts       # Defaults, version strings
│   │   │   └── index.ts           # Public API
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── express/                   # Express middleware
│   │   ├── src/
│   │   │   ├── middleware.ts      # agentgate() factory function
│   │   │   ├── routes/
│   │   │   │   ├── discovery.ts   # GET /.well-known/agentgate.json
│   │   │   │   ├── register.ts    # POST /agentgate/register + /verify
│   │   │   │   ├── auth.ts        # POST /agentgate/auth
│   │   │   │   └── health.ts      # GET /agentgate/health
│   │   │   ├── auth-guard.ts      # req.agent population middleware
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── next/                      # Next.js adapter
│   │   ├── src/
│   │   │   ├── middleware.ts      # Next.js edge middleware
│   │   │   ├── route-handlers.ts  # App Router handlers
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── hono/                      # Hono middleware
│   │   ├── src/
│   │   │   ├── middleware.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── sdk/                       # Agent-side SDK
│   │   ├── src/
│   │   │   ├── agent.ts           # AgentGate class
│   │   │   ├── session.ts         # Session with fetch/get/post wrappers
│   │   │   ├── keystore.ts        # Local keypair management
│   │   │   ├── discovery.ts       # Fetch + parse .well-known
│   │   │   ├── credentials.ts     # Credential caching (file-based)
│   │   │   ├── x402.ts            # x402 payment header construction
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── detect/                    # Agent traffic detection
│   │   ├── src/
│   │   │   ├── fingerprint.ts     # Request classification
│   │   │   ├── signals.ts         # Individual signal detectors
│   │   │   ├── middleware.ts      # Express/Hono/Next compat
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── cli/                       # CLI tool
│       ├── src/
│       │   ├── index.ts           # Entry point
│       │   ├── commands/
│       │   │   ├── init.ts        # Interactive + OpenAPI import
│       │   │   ├── status.ts      # Check current config
│       │   │   └── keygen.ts      # Generate agent keypair
│       │   ├── openapi-parser.ts  # OpenAPI → scopes + config
│       │   └── templates/         # Config file templates
│       └── package.json
│
├── apps/
│   └── dashboard/                 # Agent dashboard (Next.js)
│       ├── src/
│       └── package.json
│
├── examples/
│   ├── express-weather-api/       # Full Express example
│   ├── nextjs-saas/               # Full Next.js example
│   ├── hono-cloudflare/           # Cloudflare Workers example
│   ├── agent-typescript/          # Agent SDK example
│   └── agent-langchain/           # LangChain integration
│
├── docs/                          # Documentation site
│   ├── quickstart.md
│   ├── configuration.md
│   ├── api-reference.md
│   ├── agent-sdk.md
│   └── faq.md
│
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── publish.yml
└── README.md
```

### 18.2 Core Dependencies

```json
{
  "tweetnacl": "^1.0.3",           // Ed25519 crypto. 8KB. Audited. Pure JS.
  "tweetnacl-util": "^0.15.1",     // Base64/UTF8 encoding
  "nanoid": "^5.0.0",              // Nonce + agent ID generation
  "zod": "^3.23.0",                // Schema validation (config + API input)
  "jose": "^5.9.0",                // JWT issuance/verification. Small. Standards-compliant.
  "@noble/secp256k1": "^2.0.0"     // secp256k1 for x402 wallet compat. Pure JS.
}
```

No native compilation. No `node-gyp`. Works everywhere: Node, Deno, Bun, Cloudflare Workers, Vercel Edge.

### 18.3 Core TypeScript Types

```typescript
// packages/core/src/types.ts

export interface AgentGateConfig {
  scopes: ScopeDefinition[];
  pricing?: Record<string, string>;           // scope_id → "$0.001/req"
  rateLimit?: RateLimitConfig;
  x402?: X402Config;
  storage?: StorageConfig;
  signing?: { algorithm: "ed25519" | "secp256k1" };
  jwt?: { secret?: string; expiresIn?: string };
  companion?: {
    a2aAgentCard?: boolean;                   // auto-gen /.well-known/agent-card.json
    mcpServer?: boolean;                      // auto-gen /mcp endpoint
    oauthCompat?: boolean;                    // OAuth endpoints for MCP clients
  };
  onAgentRegistered?: (agent: Agent) => void | Promise<void>;
  onAgentAuthenticated?: (agent: Agent) => void | Promise<void>;
}

export interface ScopeDefinition {
  id: string;                                 // "weather.read"
  description: string;                        // "Read weather data"
  price?: string;                             // "$0.001/req"
  rateLimit?: string;                         // "1000/hour"
}

export interface X402Config {
  network: "base" | "solana" | string;
  currency: "USDC" | string;
  facilitator?: string;                       // x402 facilitator URL
  paymentAddress: string;                     // SaaS owner's wallet
}

export interface Agent {
  id: string;                                 // "ag_nanoid"
  publicKey: string;                          // base64 Ed25519 public key
  x402Wallet?: string;                        // Optional wallet address
  scopesGranted: string[];                    // ["weather.read", "weather.forecast"]
  apiKey: string;                             // "agk_live_xxx" (hashed in DB)
  rateLimit: RateLimitConfig;
  reputation?: number;                        // 0-100
  metadata: Record<string, string>;           // framework, version, name
  createdAt: Date;
  lastAuthAt: Date;
}

export interface AgentContext {
  id: string;
  publicKey: string;
  scopes: string[];
  rateLimit: RateLimitConfig;
  reputation?: number;
  metadata: Record<string, string>;
}

// Augment Express Request
declare global {
  namespace Express {
    interface Request {
      agent?: AgentContext;
      isAgent: boolean;
    }
  }
}
```

### 18.4 API Specification

#### `GET /.well-known/agentgate.json`

Static JSON. CDN-cacheable. Returns discovery document (see section 6.1).

**Headers:** `Cache-Control: public, max-age=3600`

#### `POST /agentgate/register`

**Request:**
```json
{
  "public_key": "base64-ed25519-public-key-32-bytes",
  "scopes_requested": ["weather.read", "weather.forecast"],
  "x402_wallet": "0x1234...abcd",
  "metadata": {
    "framework": "langchain",
    "version": "0.2.0",
    "name": "weather-agent"
  }
}
```

**Response (201 Created):**
```json
{
  "agent_id": "ag_V1StGXR8_Z5jdHi6B",
  "challenge": {
    "nonce": "base64-random-32-bytes",
    "message": "agentgate:register:ag_V1StGXR8_Z5jdHi6B:1707400000:nonce_value",
    "expires_at": "2026-02-08T12:05:00Z"
  }
}
```

**Errors:** `400` invalid input, `429` rate limited, `409` public key already registered

#### `POST /agentgate/register/verify`

**Request:**
```json
{
  "agent_id": "ag_V1StGXR8_Z5jdHi6B",
  "signature": "base64-ed25519-signature-of-challenge-message"
}
```

**Response (200 OK):**
```json
{
  "agent_id": "ag_V1StGXR8_Z5jdHi6B",
  "api_key": "agk_live_aBcDeFgHiJkLmNoPqRsT",
  "scopes_granted": ["weather.read", "weather.forecast"],
  "token": "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9...",
  "token_expires_at": "2026-02-08T13:00:00Z",
  "rate_limit": {
    "requests": 1000,
    "window": "1h"
  },
  "x402": {
    "payment_address": "0xSaaSOwnerWallet...",
    "network": "base",
    "currency": "USDC"
  }
}
```

**Errors:** `400` invalid signature, `404` unknown agent_id, `410` challenge expired

#### `POST /agentgate/auth` (returning agents)

**Request:**
```json
{
  "agent_id": "ag_V1StGXR8_Z5jdHi6B",
  "timestamp": "2026-02-08T12:30:00Z",
  "signature": "base64-signature-of-agentgate:auth:agent_id:timestamp"
}
```

**Response (200 OK):**
```json
{
  "token": "eyJhbGciOiJFZERTQSJ9...",
  "expires_at": "2026-02-08T13:30:00Z"
}
```

#### Auth on Protected Routes

```
Authorization: Bearer agk_live_xxx
  OR
Authorization: Bearer eyJhbGciOiJFZERTQSJ9... (JWT)
  AND (optional)
X-PAYMENT: <x402-payment-payload>
```

Middleware sets `req.agent` and `req.isAgent`:

```typescript
app.get("/api/weather", (req, res) => {
  if (req.isAgent) {
    // Agent request — has req.agent with scopes, rate limit, etc.
    console.log(`Agent ${req.agent.id} requesting weather`);
  }
  // Same handler works for both humans and agents
  res.json({ temp: 72 });
});
```

---

## 19. Database Schema

### 19.1 Agents Table

```sql
CREATE TABLE agents (
  id              TEXT PRIMARY KEY,         -- "ag_xxxxx" (nanoid)
  public_key      TEXT NOT NULL UNIQUE,     -- base64 Ed25519 public key
  x402_wallet     TEXT,                     -- optional x402 wallet address
  api_key_hash    TEXT NOT NULL UNIQUE,     -- SHA-256 hash of API key
  scopes_granted  TEXT[] NOT NULL,          -- ["weather.read", "weather.forecast"]
  rate_limit      JSONB NOT NULL,           -- {"requests": 1000, "window": "1h"}
  reputation      INTEGER DEFAULT 50,       -- 0-100
  metadata        JSONB DEFAULT '{}',       -- {"framework": "langchain", ...}
  status          TEXT DEFAULT 'active',    -- active, suspended, banned
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_auth_at    TIMESTAMPTZ,
  total_requests  BIGINT DEFAULT 0,
  total_x402_paid NUMERIC(20,8) DEFAULT 0
);

CREATE INDEX idx_agents_api_key_hash ON agents(api_key_hash);
CREATE INDEX idx_agents_x402_wallet ON agents(x402_wallet);
CREATE INDEX idx_agents_status ON agents(status);
```

### 19.2 Challenges Table (ephemeral)

```sql
CREATE TABLE challenges (
  agent_id    TEXT NOT NULL,
  nonce       TEXT NOT NULL,
  message     TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_challenges_agent_id ON challenges(agent_id);
-- Auto-cleanup: DELETE WHERE expires_at < NOW() (cron or TTL)
```

### 19.3 Request Log (for analytics)

```sql
CREATE TABLE agent_requests (
  id          BIGSERIAL PRIMARY KEY,
  agent_id    TEXT,                         -- NULL for unregistered agent traffic
  scope       TEXT,
  path        TEXT,
  method      TEXT,
  status_code INTEGER,
  latency_ms  INTEGER,
  x402_amount NUMERIC(20,8),
  is_agent    BOOLEAN DEFAULT false,        -- from detection middleware
  framework   TEXT,                         -- detected or self-reported
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_requests_agent_id ON agent_requests(agent_id);
CREATE INDEX idx_requests_created_at ON agent_requests(created_at);
-- Partition by month for scale
```

---

## 20. CLI Specification

### 20.1 `npx agentgate init`

```bash
$ npx agentgate init

🚀 AgentGate Setup

? What framework are you using? (auto-detected: next.js)
  > Next.js (App Router)
    Express.js
    Hono
    FastAPI (Python)
    Other

? Do you have an OpenAPI spec? (Y/n) Y
? Path to OpenAPI spec: ./openapi.yaml

🔍 Parsing OpenAPI spec...
✅ Found 23 endpoints

? Select scopes to expose to agents:
  ✅ weather.read     GET /api/weather/*        (suggested: $0.001/req)
  ✅ weather.forecast GET /api/forecast/*       (suggested: $0.01/req)
  ☐  weather.admin   DELETE /api/weather/*     (skip: destructive)
  ✅ weather.alerts   GET /api/alerts/*         (suggested: $0.005/req)

? Enable x402 payments? (Y/n) Y
? Your x402 wallet address: 0x1234...abcd
? Preferred network: (base) base

📁 Generated files:
   ✅ agentgate.config.ts
   ✅ public/.well-known/agentgate.json
   ✅ public/.well-known/agent-card.json
   ✅ middleware.ts (3-line snippet)

📋 Add to your middleware.ts:
   import { agentgate } from "@agentgate/next";
   import config from "./agentgate.config";
   export default agentgate(config);

⏱️  Setup complete in 2m 14s
```

### 20.2 `npx agentgate keygen`

```bash
$ npx agentgate keygen

🔐 Generating Ed25519 keypair...
✅ Private key saved to: ~/.agentgate/keys.json
✅ Public key: MCowBQYDK2VwAyEA...
⚠️  Never share your private key!
```

### 20.3 `npx agentgate status`

```bash
$ npx agentgate status

📊 AgentGate Status
   Config:    ✅ agentgate.config.ts found
   Discovery: ✅ /.well-known/agentgate.json serving
   Endpoints: ✅ /agentgate/register (POST)
              ✅ /agentgate/auth (POST)
   Agents:    47 registered, 12 active (24h)
   Requests:  3,241 agent requests (24h)
   Revenue:   $14.23 via x402 (24h)
```

---

## 21. Implementation Phases for Claude Code

### Phase 1: Core + Express (Week 1–2)

**Goal:** Working Express middleware with registration + auth + detection.

```
Build order:
1. packages/core/src/types.ts          — All interfaces
2. packages/core/src/constants.ts      — Defaults, version
3. packages/core/src/errors.ts         — Typed errors
4. packages/core/src/config.ts         — Zod schema for AgentGateConfig
5. packages/core/src/crypto.ts         — Ed25519 keygen/sign/verify (tweetnacl)
6. packages/core/src/challenge.ts      — Nonce gen, message format, verify
7. packages/core/src/tokens.ts         — JWT issue/verify (jose)
8. packages/core/src/rate-limiter.ts   — Token bucket, in-memory
9. packages/core/src/storage/interface.ts — AgentStore interface
10. packages/core/src/storage/memory.ts   — In-memory implementation
11. packages/core/src/discovery.ts     — Generate .well-known JSON
12. packages/core/src/a2a.ts           — A2A agent card generation
13. packages/core/src/detect.ts        — Agent fingerprinting
14. packages/core/src/index.ts         — Public exports

15. packages/express/src/routes/discovery.ts — GET /.well-known/agentgate.json
16. packages/express/src/routes/register.ts  — POST /agentgate/register + /verify
17. packages/express/src/routes/auth.ts      — POST /agentgate/auth
18. packages/express/src/auth-guard.ts       — Auth middleware (req.agent)
19. packages/express/src/middleware.ts        — agentgate() factory
20. packages/express/src/index.ts

21. examples/express-weather-api/      — Full working example
22. Tests for all of the above
```

### Phase 2: Agent SDK + CLI (Week 3)

```
Build order:
1. packages/sdk/src/keystore.ts        — Local keypair management
2. packages/sdk/src/discovery.ts       — Fetch + parse .well-known
3. packages/sdk/src/credentials.ts     — File-based credential cache
4. packages/sdk/src/agent.ts           — AgentGate class
5. packages/sdk/src/session.ts         — Session with fetch wrappers
6. packages/sdk/src/x402.ts            — x402 payment header
7. packages/sdk/src/index.ts

8. packages/cli/src/openapi-parser.ts  — OpenAPI → scopes
9. packages/cli/src/commands/init.ts   — Interactive setup
10. packages/cli/src/commands/keygen.ts — Keypair gen
11. packages/cli/src/index.ts

12. examples/agent-typescript/         — Full agent example
```

### Phase 3: Next.js + Hono Adapters (Week 4)

```
Build order:
1. packages/next/src/middleware.ts      — Next.js edge middleware
2. packages/next/src/route-handlers.ts  — App Router handlers
3. packages/hono/src/middleware.ts      — Hono middleware

4. examples/nextjs-saas/               — Full Next.js example
5. examples/hono-cloudflare/           — Workers example
```

### Phase 4: Storage + Polish (Week 5)

```
1. packages/core/src/storage/sqlite.ts  — SQLite adapter
2. packages/core/src/storage/postgres.ts — Postgres adapter
3. packages/detect/                     — Standalone detection middleware
4. README.md                            — Comprehensive docs
5. docs/                                — Full documentation site
6. Integration tests
7. npm publish pipeline
```

---

## 22. Testing Strategy

### 22.1 Unit Tests

```typescript
// Example: packages/core/src/__tests__/crypto.test.ts
import { generateKeypair, signChallenge, verifySignature } from "../crypto";

describe("Ed25519 Crypto", () => {
  it("should generate valid keypair", () => {
    const kp = generateKeypair();
    expect(kp.publicKey).toHaveLength(44);  // base64 of 32 bytes
    expect(kp.secretKey).toHaveLength(88);  // base64 of 64 bytes
  });

  it("should sign and verify challenge", () => {
    const kp = generateKeypair();
    const message = "agentgate:register:ag_123:1707400000:nonce_abc";
    const sig = signChallenge(message, kp.secretKey);
    expect(verifySignature(message, sig, kp.publicKey)).toBe(true);
  });

  it("should reject invalid signature", () => {
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    const message = "test";
    const sig = signChallenge(message, kp1.secretKey);
    expect(verifySignature(message, sig, kp2.publicKey)).toBe(false);
  });
});
```

### 22.2 Integration Tests

```typescript
// Example: packages/express/src/__tests__/registration.test.ts
import request from "supertest";
import express from "express";
import { agentgate } from "../index";
import { generateKeypair, signChallenge } from "@agentgate/core";

describe("Agent Registration Flow", () => {
  const app = express();
  app.use(agentgate({ scopes: [{ id: "data.read", description: "Read" }] }));
  app.get("/api/data", (req, res) => res.json({ agent: req.isAgent }));

  it("full registration flow", async () => {
    const kp = generateKeypair();

    // 1. Discovery
    const disc = await request(app).get("/.well-known/agentgate.json");
    expect(disc.status).toBe(200);
    expect(disc.body.registration_endpoint).toBe("/agentgate/register");

    // 2. Register
    const reg = await request(app)
      .post("/agentgate/register")
      .send({ public_key: kp.publicKey, scopes_requested: ["data.read"] });
    expect(reg.status).toBe(201);
    expect(reg.body.challenge.nonce).toBeDefined();

    // 3. Verify
    const sig = signChallenge(reg.body.challenge.message, kp.secretKey);
    const verify = await request(app)
      .post("/agentgate/register/verify")
      .send({ agent_id: reg.body.agent_id, signature: sig });
    expect(verify.status).toBe(200);
    expect(verify.body.api_key).toMatch(/^agk_live_/);

    // 4. Authenticated request
    const data = await request(app)
      .get("/api/data")
      .set("Authorization", `Bearer ${verify.body.api_key}`);
    expect(data.status).toBe(200);
    expect(data.body.agent).toBe(true);
  });

  it("rejects unregistered agents", async () => {
    const data = await request(app)
      .get("/api/data")
      .set("Authorization", "Bearer agk_live_invalid");
    expect(data.status).toBe(401);
  });
});
```

### 22.3 E2E Test

```typescript
// Full flow: CLI init → server start → agent SDK connect → make request
describe("E2E", () => {
  it("agent discovers, registers, and makes authenticated request", async () => {
    // Start test server with AgentGate
    const server = startTestServer();
    const agent = new AgentGate();

    // Connect (auto discovery + register + auth)
    const session = await agent.connect(`http://localhost:${server.port}`);
    expect(session.scopes).toContain("data.read");

    // Make authenticated request
    const data = await session.get("/api/data");
    expect(data.status).toBe(200);

    server.close();
  });
});
```

---

## 23. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| "Agents will just use API keys" | High | AgentGate is easier: auto-discover, auto-register, auto-pay vs manual signup + copy-paste. Lead with detection ("you already have agent traffic"). |
| SaaS owners don't see agent traffic yet | High | Lead with detect-only mode. Show them data first. "18% of your traffic is agents" is a compelling hook. |
| x402 adoption stalls | Medium | Support Stripe fallback. Traditional billing at registration. x402 is ideal, not required. |
| Clerk/Auth0/Stytch build this | High | First-mover with OSS + community. Own the standard (`/.well-known/agentgate.json`). Piggybacking plugins make us complementary, not competitive. |
| Registration spam | Medium | Rate limiting per-IP. Optional x402 deposit (stake to register). Reputation gating. Progressive CAPTCHA escalation. |
| OAuth ecosystem pressure | Medium | Support OAuth compat mode (P2). Position keypair as better for headless. Be pragmatic. |
| Standard fragmentation | Medium | Auto-generate A2A + MCP + OAuth files. Be the adapter layer across all protocols. |
| Agents don't adopt new pattern | Medium | Ship demand-side SDK that makes it 1-line. LangChain/CrewAI integrations. Path of least resistance. |

---

## 24. Founding Team

| Role | Focus | Why Critical |
|---|---|---|
| **CEO / Product** | Agent ecosystem, developer GTM, positioning | Must understand both SaaS and agent worlds |
| **CTO** | Crypto auth, distributed systems, middleware perf | Ed25519, challenge-response, < 5ms verify |
| **SDK Engineer** | TypeScript/Python SDKs, DX obsession, CLI | The product IS the SDK. DX is everything. |
| **Full-Stack** | Dashboard, registry, analytics, billing | Revenue-driving features |
| **DevRel** | OSS community, content, framework partnerships | Growth engine. Every integration = distribution. |

---

## 25. One-Page Summary

> ### AgentGate: Make Your Website Agent-Ready in 3 Lines of Code
>
> **PROBLEM:** AI agents consume APIs but can't get through human-only signup flows. They resort to slow, fragile browser automation. SaaS companies have growing agent traffic with zero visibility.
>
> **INSIGHT:** Every existing player (Composio, Nango, Arcade, Stytch) is demand-side — helping agents auth TO tools. Nobody is supply-side — helping SaaS owners receive agents. This is a completely unoccupied position.
>
> **PRODUCT:** Drop-in SDK for SaaS owners. `npx agentgate init --from-openapi` → 5 minutes to agent-ready. Agents register headlessly, get instant credentials, pay via x402. One integration → discoverable via AgentGate, MCP, A2A, and x402 Bazaar.
>
> **DX:** OpenAPI auto-import. Companion plugins for Clerk, Supabase, Auth0. Adapters for Express, Next.js, Hono, FastAPI. Stripe billing bridge. One-click Vercel/Cloudflare templates.
>
> **HOOK:** Start with agent traffic detection (free). "You have 18% agent traffic." Upgrade to registration, dashboard, x402 billing.
>
> **EDGE:** Only supply-side product. Headless-first. x402 V2 wallet identity composability. Cross-protocol auto-generation (A2A + MCP + OAuth). DX so good it's a no-brainer.
>
> **BUSINESS:** Free → $49/mo → $199/mo → Enterprise. PLG funnel from detection to registration to revenue.
>
> **WIN CONDITION:** `/.well-known/agentgate.json` becomes the standard way agents enter SaaS products.

---

*Claude Code implementation ready: See Section 18 (architecture), Section 19 (DB schema), Section 20 (CLI spec), Section 21 (build phases), Section 22 (test strategy).*
