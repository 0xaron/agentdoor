# Agent-Ready API Starter (Vercel)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/agentdoor/agentdoor/tree/main/packages/template-vercel/template)

Deploy an agent-ready API to Vercel in one click. Built with Next.js, AgentDoor, and x402 micropayments.

## What You Get

- **AgentDoor middleware** that handles agent authentication, capability discovery, and x402 payments
- **`.well-known/agentdoor`** endpoint auto-served for agent discovery
- **x402 micropayments** via USDC on Base network
- **Sample API routes** with scope-based access control

## Quick Start

1. Click "Deploy with Vercel" above
2. Set the `X402_WALLET` environment variable to your wallet address
3. Your API is now agent-ready!

## Local Development

```bash
# Install dependencies
npm install

# Set environment variables
cp .env.example .env.local
# Edit .env.local with your wallet address

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the landing page.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `X402_WALLET` | Your wallet address for receiving x402 payments | Yes |

## Project Structure

```
├── app/
│   ├── api/
│   │   └── data/
│   │       └── route.ts      # Sample API endpoint
│   ├── layout.tsx             # Root layout
│   └── page.tsx               # Landing page
├── middleware.ts               # AgentDoor middleware configuration
├── next.config.js             # Next.js configuration
├── vercel.json                # Vercel configuration
└── tsconfig.json              # TypeScript configuration
```

## How It Works

1. **Agent Discovery**: Agents find your API via `/.well-known/agentdoor`
2. **Authentication**: AgentDoor middleware validates agent credentials and scopes
3. **Payment**: x402 handles micropayments for API access (USDC on Base)
4. **Access**: Authenticated agents can call your API endpoints

## Scopes

| Scope | Description | Price |
|-------|-------------|-------|
| `data.read` | Read application data | $0.001/req |
| `data.write` | Write application data | $0.01/req |

## Learn More

- [AgentDoor Documentation](https://github.com/agentdoor/agentdoor)
- [x402 Protocol](https://www.x402.org/)
- [Next.js Documentation](https://nextjs.org/docs)
- [Vercel Documentation](https://vercel.com/docs)
