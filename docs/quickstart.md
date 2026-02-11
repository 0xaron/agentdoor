# Quick Start

Make your API agent-ready in under 5 minutes. This guide walks you through installing AgentDoor, initializing your configuration, adding the middleware, and testing with a real agent request.

## Prerequisites

- Node.js >= 18
- An existing Express, Next.js, Hono, or Fastify API (Python FastAPI is also supported)
- pnpm, npm, or yarn

## 1. Install

```bash
# npm
npm install @agentdoor/express @agentdoor/core

# pnpm
pnpm add @agentdoor/express @agentdoor/core

# yarn
yarn add @agentdoor/express @agentdoor/core
```

For Next.js, use `@agentdoor/next` instead of `@agentdoor/express`. For Hono, use `@agentdoor/hono`. For Fastify, use `@agentdoor/fastify`. For Python FastAPI, see the [FastAPI example](../examples/python-fastapi/).

## 2. Initialize Configuration

Run the interactive setup CLI:

```bash
npx agentdoor init
```

This walks you through framework detection, scope definition, and optional x402 payment setup. If you have an OpenAPI spec, the CLI auto-generates scopes from your endpoints:

```bash
npx agentdoor init --from-openapi ./openapi.yaml
```

Both commands produce an `agentdoor.config.ts` file in your project root.

You can also skip the CLI and configure inline (see step 3).

## 3. Add the Middleware

### Express.js

```typescript
import express from "express";
import { agentdoor } from "@agentdoor/express";

const app = express();

app.use(agentdoor({
  scopes: [
    { id: "data.read", description: "Read data" },
    { id: "data.write", description: "Write data" },
  ],
  pricing: { "data.read": "$0.001/req", "data.write": "$0.01/req" },
  rateLimit: { default: "1000/hour" },
}));

// Your existing routes work as before.
// Agent requests will have req.isAgent === true and req.agent populated.
app.get("/api/data", (req, res) => {
  if (req.isAgent) {
    console.log(`Agent ${req.agent.id} with scopes: ${req.agent.scopes}`);
  }
  res.json({ temperature: 72, unit: "F" });
});

app.listen(3000, () => console.log("Server running on :3000"));
```

That is it. Three things happen automatically:

1. **Discovery endpoint** -- `GET /.well-known/agentdoor.json` is served, describing your API's scopes, pricing, auth methods, and registration endpoint.
2. **Registration endpoints** -- `POST /agentdoor/register` and `POST /agentdoor/register/verify` are mounted for agent self-service signup.
3. **Auth middleware** -- every request is checked for agent credentials (`Authorization: Bearer agk_live_...` or a JWT). If valid, `req.agent` is populated.

### Next.js (App Router)

```typescript
// middleware.ts
import { agentdoor } from "@agentdoor/next";

export default agentdoor({
  scopes: [
    { id: "data.read", description: "Read data" },
  ],
  pricing: { "data.read": "$0.001/req" },
});

export const config = { matcher: ["/api/:path*"] };
```

### Hono

```typescript
import { Hono } from "hono";
import { agentdoor } from "@agentdoor/hono";

const app = new Hono();

app.use("*", agentdoor({
  scopes: [
    { id: "data.read", description: "Read data" },
  ],
}));

app.get("/api/data", (c) => c.json({ temperature: 72 }));

export default app;
```

### Fastify

```typescript
import Fastify from "fastify";
import { agentdoor } from "@agentdoor/fastify";

const app = Fastify();

app.register(agentdoor, {
  scopes: [
    { id: "data.read", description: "Read data" },
  ],
});

app.get("/api/data", async (request, reply) => {
  return { temperature: 72 };
});

app.listen({ port: 3000 });
```

## 4. Test with curl

### 4a. Discover the API

```bash
curl http://localhost:3000/.well-known/agentdoor.json | jq
```

Response:

```json
{
  "agentdoor_version": "1.0",
  "service_name": "My API",
  "registration_endpoint": "/agentdoor/register",
  "auth_endpoint": "/agentdoor/auth",
  "scopes_available": [
    {
      "id": "data.read",
      "description": "Read data",
      "price": "$0.001/req",
      "rate_limit": "1000/hour"
    }
  ],
  "auth_methods": ["ed25519-challenge", "jwt"],
  "rate_limits": {
    "registration": "10/hour",
    "default": "1000/hour"
  }
}
```

This is the discovery protocol. Any agent can fetch `/.well-known/agentdoor.json` from your domain to learn how to register and what scopes are available -- similar to `/.well-known/openid-configuration` for OAuth.

### 4b. Register an Agent

Generate an Ed25519 keypair (or use `npx agentdoor keygen`), then register:

```bash
curl -X POST http://localhost:3000/agentdoor/register \
  -H "Content-Type: application/json" \
  -d '{
    "public_key": "BASE64_ED25519_PUBLIC_KEY",
    "scopes_requested": ["data.read"],
    "metadata": {
      "framework": "custom",
      "name": "my-test-agent"
    }
  }'
```

Response:

```json
{
  "agent_id": "ag_V1StGXR8_Z5jdHi6B",
  "challenge": {
    "nonce": "BASE64_RANDOM_NONCE",
    "message": "agentdoor:register:ag_V1StGXR8_Z5jdHi6B:1707400000:NONCE",
    "expires_at": "2026-02-08T12:05:00Z"
  }
}
```

### 4c. Complete the Challenge-Response

Sign the `challenge.message` with your Ed25519 private key and verify:

```bash
curl -X POST http://localhost:3000/agentdoor/register/verify \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "ag_V1StGXR8_Z5jdHi6B",
    "signature": "BASE64_SIGNATURE_OF_CHALLENGE_MESSAGE"
  }'
```

Response:

```json
{
  "agent_id": "ag_V1StGXR8_Z5jdHi6B",
  "api_key": "agk_live_aBcDeFgHiJkLmNoPqRsT",
  "scopes_granted": ["data.read"],
  "token": "eyJhbGciOiJFZERTQSJ9...",
  "token_expires_at": "2026-02-08T13:00:00Z",
  "rate_limit": { "requests": 1000, "window": "1h" }
}
```

### 4d. Make an Authenticated Request

```bash
curl http://localhost:3000/api/data \
  -H "Authorization: Bearer agk_live_aBcDeFgHiJkLmNoPqRsT"
```

The agent is now registered and authenticated. The entire flow -- discovery, registration, challenge-response, first request -- completes in under 500ms programmatically.

## 5. Use the Agent SDK (Recommended)

Instead of manual curl calls, use `@agentdoor/sdk` to handle the entire flow in one call:

```typescript
import { AgentDoor } from "@agentdoor/sdk";

const agent = new AgentDoor({
  keyPath: "~/.agentdoor/keys.json",
});

// Discover + register + auth in a single call
const session = await agent.connect("http://localhost:3000");

// Make authenticated requests
const data = await session.get("/api/data");
console.log(data); // { temperature: 72, unit: "F" }
```

The SDK handles keypair generation, discovery document fetching, registration, challenge signing, credential caching, and token refresh automatically.

See the [Agent SDK documentation](./agent-sdk.md) for full details.

## Next Steps

- [Configuration Reference](./configuration.md) -- all `AgentDoorConfig` options
- [API Reference](./api-reference.md) -- full endpoint documentation with schemas
- [Agent SDK](./agent-sdk.md) -- TypeScript and Python agent-side usage
- [FAQ](./faq.md) -- common questions about AgentDoor
