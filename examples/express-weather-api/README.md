# Express Weather API Example

A sample weather API built with Express.js and the `@agentgate/express` middleware. Demonstrates the 3-line integration pattern for making any Express API agent-ready.

## What This Example Shows

- Mounting AgentGate middleware on an Express app
- Automatic discovery endpoint at `/.well-known/agentgate.json`
- Agent registration and authentication endpoints
- Using `req.isAgent` and `req.agent` in route handlers
- x402 payment configuration

## Prerequisites

- Node.js >= 18
- pnpm >= 9

## Setup

```bash
# From the repository root
pnpm install

# Start the example
cd examples/express-weather-api
pnpm dev
```

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /.well-known/agentgate.json` | AgentGate discovery document |
| `POST /agentgate/register` | Agent registration |
| `POST /agentgate/register/verify` | Challenge verification |
| `POST /agentgate/auth` | Agent authentication |
| `GET /api/weather?city=san-francisco` | Current weather data |
| `GET /api/forecast?city=austin&days=5` | Multi-day forecast |

## Testing with an Agent

Start this server, then run the `agent-typescript` example pointing at `http://localhost:3000` to see the full agent flow in action.

## Packages Used

- [`@agentgate/express`](../../packages/express) - Express middleware adapter
