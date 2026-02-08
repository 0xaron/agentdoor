# AgentGate — P0 & P1 Completion Plan

> Generated 2026-02-08 from a full codebase audit against `prd.md`.
> Current state: 26 packages build, 909 tests pass, 0 failures.

---

## Current State Summary

| Area | Status |
|------|--------|
| **P0 Source Code** | 100% — all 14 P0 features have real implementations |
| **P0 Tests** | ~75% — significant gaps in SDK, CLI, and core |
| **P1 Source Code** | ~90% — dashboard needs real backend, some adapter gaps |
| **P1 Tests** | ~60% — Python packages untested in CI, several missing test files |
| **Build** | All 26 packages build successfully |
| **CI** | GitHub Actions workflows exist and are properly configured |

---

## PHASE 1: P0 Test Gaps (Critical)

These are the missing tests for features that are already fully implemented.

### 1.1 — Core: Add dedicated tests for `detect.ts`
**File:** `packages/core/src/detect.ts` (597 lines, no dedicated test)
**Create:** `packages/core/src/__tests__/detect.test.ts`
**Cover:**
- [ ] Agent detection signal weighting
- [ ] User-agent string classification (LangChain, CrewAI, AutoGen, python-requests, etc.)
- [ ] Header pattern analysis (missing Accept-Language, Cookie, Referer)
- [ ] IP range classification (cloud providers)
- [ ] Behavioral pattern detection (machine-speed timing, no session cookies)
- [ ] Self-identification via `X-Agent-Framework` header
- [ ] Combined signal scoring and threshold classification
- [ ] Edge cases: mixed signals, borderline scores

### 1.2 — Core: Add dedicated tests for `a2a.ts`
**File:** `packages/core/src/a2a.ts` (143 lines, no dedicated test)
**Create:** `packages/core/src/__tests__/a2a.test.ts`
**Cover:**
- [ ] A2A agent card generation from AgentGate config
- [ ] Correct `/.well-known/agent-card.json` format
- [ ] Scope-to-capability mapping
- [ ] Service name, description, URL fields
- [ ] Auth method advertisement
- [ ] Edge cases: minimal config, full config with x402

### 1.3 — Core: Add dedicated tests for `errors.ts`
**File:** `packages/core/src/errors.ts` (178 lines, no dedicated test)
**Create:** `packages/core/src/__tests__/errors.test.ts`
**Cover:**
- [ ] All error classes instantiate correctly
- [ ] HTTP status code mapping for each error type
- [ ] Error message formatting
- [ ] `instanceof` checks for error hierarchy
- [ ] Serialization to JSON response format

### 1.4 — SDK: Add tests for `agent.ts`
**File:** `packages/sdk/src/agent.ts` (514 lines — the main entry class, **0 tests**)
**Create:** `packages/sdk/src/__tests__/agent.test.ts`
**Cover:**
- [ ] `agent.connect(url)` — full discovery → register → verify → session flow
- [ ] Credential caching — second `connect()` skips registration
- [ ] Token refresh on expiration
- [ ] Error handling: 409 (already registered), 410 (challenge expired), 429 (rate limited)
- [ ] Ephemeral mode (no key persistence)
- [ ] x402 wallet identity registration
- [ ] `onRegistered` / `onAuthenticated` callbacks
- [ ] Multiple concurrent `connect()` calls to different services
- [ ] Invalid URL / unreachable service handling

### 1.5 — SDK: Add tests for `x402.ts`
**File:** `packages/sdk/src/x402.ts` (204 lines, **0 tests**)
**Create:** `packages/sdk/src/__tests__/x402.test.ts`
**Cover:**
- [ ] Payment header construction
- [ ] Wallet signature generation
- [ ] Payload encoding/decoding
- [ ] Network/currency configuration
- [ ] Invalid wallet address handling
- [ ] Header format compliance with x402 V2 spec

### 1.6 — CLI: Add tests for `commands/init.ts`
**File:** `packages/cli/src/commands/init.ts` (446 lines, **0 tests**)
**Create:** `packages/cli/src/__tests__/init.test.ts`
**Cover:**
- [ ] `--from-openapi` mode: reads spec, generates config, discovery JSON, A2A card
- [ ] Interactive mode: mock inquirer prompts, validate generated files
- [ ] Framework auto-detection (Next.js, Express, Hono)
- [ ] Scope inference from OpenAPI tags/paths
- [ ] Pricing suggestions based on HTTP method
- [ ] File output: `agentgate.config.ts`, `.well-known/agentgate.json`, `.well-known/agent-card.json`
- [ ] `--yes` flag for non-interactive defaults
- [ ] Error: invalid OpenAPI spec path
- [ ] Error: malformed OpenAPI spec

### 1.7 — CLI: Add tests for `commands/keygen.ts`
**File:** `packages/cli/src/commands/keygen.ts` (187 lines, **0 tests**)
**Create:** `packages/cli/src/__tests__/keygen.test.ts`
**Cover:**
- [ ] Ed25519 keypair generation
- [ ] Output to specified path
- [ ] Default path `~/.agentgate/keys.json`
- [ ] Directory creation if not exists
- [ ] File permission handling
- [ ] `--format` option (JSON, PEM)
- [ ] Overwrite protection (existing key file)

### 1.8 — CLI: Add tests for `commands/status.ts`
**File:** `packages/cli/src/commands/status.ts` (299 lines, **0 tests**)
**Create:** `packages/cli/src/__tests__/status.test.ts`
**Cover:**
- [ ] Finds and validates `agentgate.config.ts`
- [ ] Checks `.well-known/agentgate.json` exists and is valid
- [ ] Reports registered agent count (when connected to running server)
- [ ] Reports request volume / revenue
- [ ] Error: no config file found
- [ ] Error: config file invalid

---

## PHASE 2: P0 Implementation Gaps

### 2.1 — Next.js: Implement proper JWT token issuance
**File:** `packages/next/src/middleware.ts` (line ~454)
**Issue:** Uses opaque tokens (`agt_xxx`) instead of signed JWTs. PRD specifies JWT with scope claims.
**Fix:**
- [ ] Use `jose` library for JWT signing in route handlers
- [ ] Sign tokens with configurable secret (from config or env)
- [ ] Include claims: `agent_id`, `scopes`, `iat`, `exp`
- [ ] Verify JWT in auth guard middleware
- [ ] Update tests to validate JWT structure and claims

### 2.2 — Hono: Implement proper JWT token issuance
**File:** `packages/hono/src/middleware.ts` (line ~608)
**Issue:** Same as Next.js — opaque tokens instead of JWTs.
**Fix:**
- [ ] Use `jose` library for JWT signing
- [ ] Match Express implementation behavior
- [ ] Update tests

### 2.3 — Hono: Add `onAgentAuthenticated` callback
**File:** `packages/hono/src/middleware.ts`
**Issue:** Has `onAgentRegistered` but missing `onAgentAuthenticated` (Express has both).
**Fix:**
- [ ] Add callback invocation in auth endpoint
- [ ] Add tests for callback execution

### 2.4 — Persist pending registrations to AgentStore
**Files:** `packages/express/src/routes/register.ts`, `packages/next/src/middleware.ts`, `packages/hono/src/middleware.ts`
**Issue:** All three adapters store pending challenges in module-level `Map`s. If the server restarts between register step 1 and step 2, the challenge is lost. Doesn't work in multi-instance deployments.
**Fix:**
- [ ] Use the `AgentStore` challenge methods (`saveChallenge`, `getChallenge`, `deleteChallenge`) which already exist in the storage interface
- [ ] Remove in-memory Maps
- [ ] Add TTL-based cleanup (challenges expire after 5 min)
- [ ] Update tests to verify persistence

---

## PHASE 3: P1 Feature Gaps

### 3.1 — Dashboard: Wire to real AgentStore backend
**Dir:** `apps/dashboard/`
**Issue:** All 3 API routes (`/api/agents`, `/api/stats`, `/api/events`) return mock data.
**Fix:**
- [ ] Accept `AGENTGATE_STORE_URL` or `DATABASE_URL` env var
- [ ] Connect API routes to real `AgentStore` (Postgres or SQLite)
- [ ] `/api/agents` — query `agents` table with filtering, sorting, pagination
- [ ] `/api/stats` — aggregate from `agent_requests` table (traffic, revenue, frameworks, scopes)
- [ ] `/api/events` — query `agent_requests` + agent status changes
- [ ] Keep mock data as fallback for demo/dev mode
- [ ] Add loading states and error handling in the UI
- [ ] Add tests for API routes with in-memory store

### 3.2 — Dashboard: Add real-time charts
**Dir:** `apps/dashboard/src/app/page.tsx`
**Issue:** Charts are rendered as static CSS bars. No real charting library.
**Fix:**
- [ ] Add lightweight chart library (e.g., recharts or chart.js)
- [ ] Traffic chart: stacked bar (human vs agent) over time
- [ ] Revenue chart: line/bar over time
- [ ] Framework breakdown: horizontal bar chart
- [ ] Auto-refresh data on interval (or SSE/websocket for real-time)

### 3.3 — Dashboard: Add agent detail page
**Issue:** No individual agent detail view. Only the list table exists.
**Fix:**
- [ ] Create `/agents/[id]/page.tsx` route
- [ ] Show agent profile: ID, public key, scopes, status, reputation, metadata
- [ ] Show agent usage history (requests over time)
- [ ] Show agent revenue contribution
- [ ] Actions: suspend, ban, adjust rate limits, adjust spending caps

### 3.4 — Dashboard: Add configuration page
**Issue:** PRD specifies "Live-edit scopes, pricing, rate limits, spending caps" in dashboard.
**Fix:**
- [ ] Create `/settings/page.tsx` route
- [ ] Edit scopes and pricing
- [ ] Edit default rate limits
- [ ] Edit spending caps
- [ ] Persist changes to config store
- [ ] Add confirmation dialogs for destructive changes

### 3.5 — Python SDK: Add test suite and CI integration
**Dir:** `packages/python-sdk/`
**Issue:** Real Python code exists but tests aren't run in CI. Package marked as private.
**Fix:**
- [ ] Write pytest tests for `agent.py`, `crypto.py`, `credentials.py`, `discovery.py`
- [ ] Add `pytest` and `httpx` to test dependencies in `pyproject.toml`
- [ ] Add Python test step to `.github/workflows/ci.yml`
- [ ] Remove `"private": true` from package.json (or confirm intent)
- [ ] Verify `pyproject.toml` has correct metadata for PyPI publishing

### 3.6 — FastAPI Adapter: Add test suite and CI integration
**Dir:** `packages/fastapi-adapter/`
**Issue:** Same as Python SDK — real code, no CI testing.
**Fix:**
- [ ] Write pytest tests for `middleware.py`, `models.py`, `store.py`, `crypto.py`
- [ ] Test full registration flow via FastAPI TestClient
- [ ] Add to CI workflow
- [ ] Remove `"private": true` or confirm intent
- [ ] Verify `pyproject.toml` metadata

### 3.7 — Webhook events: Wire into Next.js and Hono adapters
**Issue:** `WebhookEmitter` exists in core and is used in Express adapter, but not in Next.js or Hono.
**Fix:**
- [ ] Accept `webhooks` config in Next.js adapter
- [ ] Emit `agent.registered`, `agent.authenticated` events from Next.js route handlers
- [ ] Accept `webhooks` config in Hono adapter
- [ ] Emit events from Hono middleware
- [ ] Add tests for webhook emission in both adapters

### 3.8 — Reputation system: Wire into adapters
**Issue:** `ReputationManager` exists in core and is used in Express, but verify it's wired into Next.js and Hono.
**Fix:**
- [ ] Verify reputation checks in Next.js auth guard
- [ ] Verify reputation checks in Hono auth guard
- [ ] Add reputation-based gating tests for both adapters
- [ ] Verify reputation update on successful/failed requests

### 3.9 — Spending caps: Wire into adapters
**Issue:** `SpendingTracker` exists in core and is used in Express, but verify Next.js and Hono.
**Fix:**
- [ ] Verify spending cap enforcement in Next.js
- [ ] Verify spending cap enforcement in Hono
- [ ] Add spending cap exceeded tests for both adapters

---

## PHASE 4: Build & CI Polish

### 4.1 — Fix Turbo output warnings
**Issue:** 7 packages produce Turbo warnings about missing `outputs` for the build task.
**Fix:**
- [ ] `apps/dashboard` — add `".next/**"` to turbo outputs
- [ ] `packages/python-sdk` — either add a no-op build or exclude from turbo build
- [ ] `packages/fastapi-adapter` — same
- [ ] `packages/template-*` (3 packages) — exclude from turbo build or add no-op
- [ ] `examples/nextjs-saas` — add `".next/**"` to turbo outputs
- [ ] Verify `turbo.json` task config for non-TS packages

### 4.2 — Add Python CI step
**File:** `.github/workflows/ci.yml`
**Fix:**
- [ ] Add Python 3.11+ setup step
- [ ] Run `pip install -e ".[test]"` for python-sdk and fastapi-adapter
- [ ] Run `pytest` for both Python packages
- [ ] Add to CI matrix or as a separate job

### 4.3 — Add test coverage reporting
**Fix:**
- [ ] Add `vitest --coverage` to CI
- [ ] Set minimum coverage thresholds (recommend: 80% lines, 75% branches)
- [ ] Add coverage badge to README
- [ ] Add `pytest --cov` for Python packages

### 4.4 — Verify npm publish pipeline
**File:** `.github/workflows/publish.yml`
**Fix:**
- [ ] Dry-run publish locally: `pnpm -r publish --access public --dry-run`
- [ ] Verify `package.json` `files` field for each package includes `dist/` and not `src/__tests__/`
- [ ] Verify package names are available on npm (or scoped under @agentgate)
- [ ] Add PyPI publish step for Python packages

---

## PHASE 5: Documentation & Examples Polish

### 5.1 — Flesh out examples
**Issue:** Examples are functional single-file demos. PRD envisions "full working examples."
**Fix per example:**
- [ ] `express-weather-api/` — add README, .env.example, docker-compose for Postgres store, seed data
- [ ] `nextjs-saas/` — add README, .env.example, show human+agent side-by-side
- [ ] `hono-cloudflare/` — add README, deployment instructions, wrangler.toml walkthrough
- [ ] `agent-typescript/` — add README, show credential caching, multi-service demo
- [ ] `agent-langchain/` — add README, show tool composition, error handling patterns

### 5.2 — Add integration test suite
**Create:** `tests/integration/` at repo root
**Cover:**
- [ ] Full E2E: Express server + SDK client — discover → register → verify → authenticated request
- [ ] Full E2E: Next.js server + SDK client
- [ ] Full E2E: Hono server + SDK client
- [ ] Cross-adapter compatibility: register on Express, auth on same config with different adapter
- [ ] Rate limiting E2E: exceed rate limit, verify 429 response
- [ ] Reputation E2E: low-reputation agent gets gated
- [ ] x402 payment flow E2E (mocked facilitator)
- [ ] Detection middleware E2E: agent vs browser requests

### 5.3 — README improvements
**File:** `README.md`
**Fix:**
- [ ] Add badges: build status, npm version, test coverage, license
- [ ] Add "Quick Start" code snippet directly in README (not just link to docs)
- [ ] Add architecture diagram (text-based or image)
- [ ] Add comparison table vs Clerk/Auth0/Stytch
- [ ] Add link to each package in packages/ with one-line description

---

## Task Priority Order

For implementation, work in this order:

| Priority | Phase | Tasks | Effort | Impact |
|----------|-------|-------|--------|--------|
| **P0-Critical** | 1 | 1.4, 1.5, 1.6, 1.7, 1.8 | ~3 days | SDK & CLI have 0 test coverage on core files |
| **P0-High** | 1 | 1.1, 1.2, 1.3 | ~1 day | Core package test coverage gaps |
| **P0-High** | 2 | 2.1, 2.2, 2.3 | ~1 day | JWT tokens + callback parity across adapters |
| **P0-Medium** | 2 | 2.4 | ~1 day | Challenge persistence for multi-instance |
| **P1-High** | 3 | 3.1, 3.2, 3.3, 3.4 | ~3 days | Dashboard is the main P1 deliverable |
| **P1-High** | 3 | 3.5, 3.6 | ~2 days | Python ecosystem needs tests + CI |
| **P1-Medium** | 3 | 3.7, 3.8, 3.9 | ~1 day | Wire core features into all adapters |
| **P1-Low** | 4 | 4.1, 4.2, 4.3, 4.4 | ~1 day | CI/CD polish |
| **P1-Low** | 5 | 5.1, 5.2, 5.3 | ~2 days | Docs, examples, integration tests |

**Total estimated effort: ~15 days of focused work**
