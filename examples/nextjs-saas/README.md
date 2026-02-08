# Next.js SaaS Example

A sample Next.js App Router application with AgentGate middleware. Demonstrates how to add agent authentication to a Next.js SaaS product so that both humans and AI agents can access the same API endpoints.

## What This Example Shows

- Using `@agentgate/next` middleware in a Next.js App Router project
- Agent detection via request headers in API route handlers
- Serving both human and agent traffic from the same endpoints
- Customizing responses based on caller type

## Prerequisites

- Node.js >= 18
- pnpm >= 9

## Setup

```bash
# From the repository root
pnpm install

# Start the example
cd examples/nextjs-saas
pnpm dev
```

The app will be available at `http://localhost:3000`.

## Project Structure

```
nextjs-saas/
├── middleware.ts          # AgentGate middleware (intercepts all /api/* routes)
├── app/
│   └── api/
│       └── data/
│           └── route.ts  # Sample data endpoint (GET and POST)
├── package.json
└── tsconfig.json
```

## How It Works

The `middleware.ts` file configures AgentGate to intercept all API routes. It:

1. Serves the discovery document at `/.well-known/agentgate.json`
2. Handles agent registration and authentication at `/agentgate/*`
3. Validates agent credentials on `/api/*` routes
4. Sets `x-agentgate-is-agent` and `x-agentgate-agent-id` headers for downstream route handlers

## Packages Used

- [`@agentgate/next`](../../packages/next) - Next.js App Router adapter
