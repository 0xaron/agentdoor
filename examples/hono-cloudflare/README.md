# Hono Cloudflare Workers Example

A sample stock market API built with Hono, deployed on Cloudflare Workers, with AgentGate middleware for agent authentication.

## What This Example Shows

- Using `@agentgate/hono` middleware in a Hono application
- Deploying an agent-ready API to Cloudflare Workers
- Accessing agent context via Hono's `c.get()` API
- x402 payment configuration for paid API access

## Prerequisites

- Node.js >= 18
- pnpm >= 9
- Wrangler CLI (`npm install -g wrangler`) for Cloudflare deployment

## Setup

```bash
# From the repository root
pnpm install

# Start the example in local development mode
cd examples/hono-cloudflare
pnpm dev
```

## Deploy to Cloudflare Workers

```bash
# Authenticate with Cloudflare (first time only)
wrangler login

# Deploy
pnpm deploy
```

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /.well-known/agentgate.json` | AgentGate discovery document |
| `POST /agentgate/register` | Agent registration |
| `POST /agentgate/register/verify` | Challenge verification |
| `POST /agentgate/auth` | Agent authentication |
| `GET /api/stocks?symbol=AAPL` | Current stock price |
| `GET /api/stocks/historical?symbol=AAPL&days=30` | Historical stock data |
| `GET /health` | Health check (no auth) |

## Configuration

Environment variables are configured in `wrangler.toml`:

- `X402_WALLET` - Your x402 wallet address for receiving payments

## Packages Used

- [`@agentgate/hono`](../../packages/hono) - Hono middleware adapter
