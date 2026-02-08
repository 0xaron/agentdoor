# Agent TypeScript SDK Example

Demonstrates how to use the `@agentgate/sdk` to connect an AI agent to any AgentGate-enabled service. The SDK handles discovery, registration, challenge-response verification, credential caching, and authenticated requests.

## What This Example Shows

- Initializing the AgentGate SDK with persistent keypair storage
- Connecting to a service (discovery + register + verify in one call)
- Making authenticated API requests via the session object
- Credential caching across process restarts
- Connecting to multiple services with separate credentials

## Prerequisites

- Node.js >= 18
- pnpm >= 9
- A running AgentGate-enabled service (e.g., the `express-weather-api` example)

## Setup

```bash
# From the repository root
pnpm install

# Start a service first (in another terminal)
cd examples/express-weather-api
pnpm dev

# Then run this agent example
cd examples/agent-typescript
pnpm start
```

## How It Works

1. The agent generates an Ed25519 keypair (saved to `agent-keys.json`)
2. `agent.connect(url)` performs discovery, registration, and challenge-response
3. The returned session object makes authenticated requests automatically
4. Credentials are cached locally so subsequent runs skip registration

## Packages Used

- [`@agentgate/sdk`](../../packages/sdk) - Agent-side TypeScript SDK
