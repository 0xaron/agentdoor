# Agent-Ready Express API (Railway)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/agentgate)

Deploy an agent-ready Express API to Railway in one click. Built with Express, AgentGate, and x402 micropayments.

## What You Get

- **AgentGate middleware** for Express that handles agent authentication, capability discovery, and x402 payments
- **`.well-known/agentgate`** endpoint auto-served for agent discovery
- **x402 micropayments** via USDC on Base network
- **Sample API routes** with scope-based access control
- **Docker-ready**: Includes Dockerfile for containerized deployment

## Quick Start

### Deploy to Railway

1. Click the "Deploy on Railway" button above
2. Set the `X402_WALLET` environment variable to your wallet address
3. Your API is now agent-ready!

### Local Development

```bash
# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your wallet address

# Start dev server with hot reload
npm run dev
```

The server will be available at [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `X402_WALLET` | Your wallet address for receiving x402 payments | Required |

## Project Structure

```
├── src/
│   └── index.ts         # Express app with AgentGate middleware and routes
├── railway.json         # Railway deployment configuration
├── Dockerfile           # Container configuration
├── tsconfig.json        # TypeScript configuration
└── package.json
```

## How It Works

1. **Agent Discovery**: Agents find your API via `/.well-known/agentgate`
2. **Authentication**: AgentGate middleware validates agent credentials and scopes
3. **Payment**: x402 handles micropayments for API access (USDC on Base)
4. **Access**: Authenticated agents can call your API endpoints

## Scopes

| Scope | Description | Price |
|-------|-------------|-------|
| `data.read` | Read application data | $0.001/req |
| `data.write` | Write application data | $0.01/req |
| `admin` | Administrative operations | $0.05/req |

## Learn More

- [AgentGate Documentation](https://github.com/agentgate/agentgate)
- [x402 Protocol](https://www.x402.org/)
- [Express Documentation](https://expressjs.com/)
- [Railway Documentation](https://docs.railway.app/)
