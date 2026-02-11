# Agent-Ready Worker (Cloudflare)

Deploy an agent-ready API to Cloudflare Workers in minutes. Built with Hono, AgentDoor, and x402 micropayments.

## What You Get

- **AgentDoor middleware** for Hono that handles agent authentication, capability discovery, and x402 payments
- **`.well-known/agentdoor`** endpoint auto-served for agent discovery
- **x402 micropayments** via USDC on Base network
- **Sample API routes** with scope-based access control
- **Edge-first**: Runs on Cloudflare's global network with near-zero cold starts

## Quick Start

### Deploy with Wrangler

```bash
# Clone the template
cp -r template my-agent-worker
cd my-agent-worker

# Install dependencies
npm install

# Configure your wallet address
# Edit wrangler.toml and set X402_WALLET

# Deploy to Cloudflare
npm run deploy
```

### Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
```

The worker will be available at [http://localhost:8787](http://localhost:8787).

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `X402_WALLET` | Your wallet address for receiving x402 payments | Yes |

Set variables in `wrangler.toml` under `[vars]` or use Cloudflare dashboard secrets for production.

## Project Structure

```
├── src/
│   └── index.ts         # Hono app with AgentDoor middleware and routes
├── wrangler.toml        # Cloudflare Workers configuration
├── tsconfig.json        # TypeScript configuration
└── package.json
```

## How It Works

1. **Agent Discovery**: Agents find your API via `/.well-known/agentdoor`
2. **Authentication**: AgentDoor middleware validates agent credentials and scopes
3. **Payment**: x402 handles micropayments for API access (USDC on Base)
4. **Access**: Authenticated agents can call your API endpoints

## Scopes

| Scope | Description | Price |
|-------|-------------|-------|
| `data.read` | Read worker data | $0.001/req |
| `data.write` | Write worker data | $0.01/req |
| `compute` | Run computations | $0.005/req |

## Learn More

- [AgentDoor Documentation](https://github.com/0xaron/agentdoor)
- [x402 Protocol](https://www.x402.org/)
- [Hono Documentation](https://hono.dev/)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
