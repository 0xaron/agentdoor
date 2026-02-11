# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-08

### Added

- **Core library** (`@agentgate/core`): Ed25519 challenge-response auth, typed error hierarchy, agent storage interface, rate limiting, JWT issuance, x402 payment support.
- **Framework adapters**: Express.js, Next.js (App Router), Hono, Fastify, FastAPI (Python), Cloudflare Workers, Vercel Edge.
- **Agent SDKs**: TypeScript (`@agentgate/sdk`) and Python (`agentgate`) with automatic discovery, registration, credential caching, and token refresh.
- **CLI tool** (`@agentgate/cli`): `npx agentgate init` with OpenAPI import support.
- **Agent traffic detection** (`@agentgate/detect`): Classify requests as human or agent based on headers, user-agent, and behavioral patterns.
- **Auth provider companions**: Auth0, Clerk, Firebase, Stytch, Supabase, NextAuth.js integrations.
- **Integrations**: Stripe billing bridge, x402 Bazaar marketplace listing, Agent Registry service.
- **Companion protocol auto-generation**: A2A agent card (`/.well-known/agent-card.json`), MCP server endpoint, OAuth 2.1 compatibility layer.
- **Dashboard** (`apps/dashboard`): Next.js agent analytics dashboard.
- **Deployment templates**: Railway, Cloudflare Workers, Vercel starter templates.
- **Documentation**: Quickstart guide, configuration reference, API reference, Agent SDK guide, FAQ.
- **Testing**: 77 test files with 75%+ coverage thresholds, CI matrix for Node 18/22 and Python 3.12.
