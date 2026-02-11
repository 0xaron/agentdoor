# Next.js SaaS Example

A sample Next.js App Router application with AgentDoor middleware. Demonstrates how to add agent authentication to a Next.js SaaS product so that both humans and AI agents can access the same API endpoints.

## What This Example Shows

- Using `@agentdoor/next` middleware in a Next.js App Router project
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
├── middleware.ts          # AgentDoor middleware (intercepts all /api/* routes)
├── app/
│   └── api/
│       └── data/
│           └── route.ts  # Sample data endpoint (GET and POST)
├── package.json
└── tsconfig.json
```

## How It Works

The `middleware.ts` file configures AgentDoor to intercept all API routes. It:

1. Serves the discovery document at `/.well-known/agentdoor.json`
2. Handles agent registration and authentication at `/agentdoor/*`
3. Validates agent credentials on `/api/*` routes
4. Sets `x-agentdoor-is-agent` and `x-agentdoor-agent-id` headers for downstream route handlers

## Packages Used

- [`@agentdoor/next`](../../packages/next) - Next.js App Router adapter
