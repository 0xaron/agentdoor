# AgentGate — P0 & P1 Completion Plan

> Generated 2026-02-08 from a full codebase audit against `prd.md`.
> Current state: 26 packages build, 909 tests pass, 0 failures.

---

## Current State Summary

| Area | Status |
|------|--------|
| **P0 Source Code** | 100% — all 14 P0 features have real implementations |
| **P0 Tests** | 100% — all test gaps filled (detect, a2a, errors, agent, x402, init, keygen, status) |
| **P1 Source Code** | 100% — dashboard wired to store, webhooks/reputation/spending in all adapters |
| **P1 Tests** | 100% — Python CI added, test coverage reporting configured |
| **Build** | All 26 packages build successfully |
| **CI** | GitHub Actions workflows exist and are properly configured |

---

## PHASE 1: P0 Test Gaps (Critical)

These are the missing tests for features that are already fully implemented.

### 1.1 — Core: Add dedicated tests for `detect.ts`
**File:** `packages/core/src/detect.ts` (597 lines, no dedicated test)
**Create:** `packages/core/src/__tests__/detect.test.ts`
**Cover:**
- [x] Agent detection signal weighting
- [x] User-agent string classification (LangChain, CrewAI, AutoGen, python-requests, etc.)
- [x] Header pattern analysis (missing Accept-Language, Cookie, Referer)
- [x] IP range classification (cloud providers)
- [x] Behavioral pattern detection (machine-speed timing, no session cookies)
- [x] Self-identification via `X-Agent-Framework` header
- [x] Combined signal scoring and threshold classification
- [x] Edge cases: mixed signals, borderline scores

### 1.2 — Core: Add dedicated tests for `a2a.ts`
**File:** `packages/core/src/a2a.ts` (143 lines, no dedicated test)
**Create:** `packages/core/src/__tests__/a2a.test.ts`
**Cover:**
- [x] A2A agent card generation from AgentGate config
- [x] Correct `/.well-known/agent-card.json` format
- [x] Scope-to-capability mapping
- [x] Service name, description, URL fields
- [x] Auth method advertisement
- [x] Edge cases: minimal config, full config with x402

### 1.3 — Core: Add dedicated tests for `errors.ts`
**File:** `packages/core/src/errors.ts` (178 lines, no dedicated test)
**Create:** `packages/core/src/__tests__/errors.test.ts`
**Cover:**
- [x] All error classes instantiate correctly
- [x] HTTP status code mapping for each error type
- [x] Error message formatting
- [x] `instanceof` checks for error hierarchy
- [x] Serialization to JSON response format

### 1.4 — SDK: Add tests for `agent.ts`
**File:** `packages/sdk/src/agent.ts` (514 lines — the main entry class, **0 tests**)
**Create:** `packages/sdk/src/__tests__/agent.test.ts`
**Cover:**
- [x] `agent.connect(url)` — full discovery → register → verify → session flow
- [x] Credential caching — second `connect()` skips registration
- [x] Token refresh on expiration
- [x] Error handling: 409 (already registered), 410 (challenge expired), 429 (rate limited)
- [x] Ephemeral mode (no key persistence)
- [x] x402 wallet identity registration
- [x] `onRegistered` / `onAuthenticated` callbacks
- [x] Multiple concurrent `connect()` calls to different services
- [x] Invalid URL / unreachable service handling

### 1.5 — SDK: Add tests for `x402.ts`
**File:** `packages/sdk/src/x402.ts` (204 lines, **0 tests**)
**Create:** `packages/sdk/src/__tests__/x402.test.ts`
**Cover:**
- [x] Payment header construction
- [x] Wallet signature generation
- [x] Payload encoding/decoding
- [x] Network/currency configuration
- [x] Invalid wallet address handling
- [x] Header format compliance with x402 V2 spec

### 1.6 — CLI: Add tests for `commands/init.ts`
**File:** `packages/cli/src/commands/init.ts` (446 lines, **0 tests**)
**Create:** `packages/cli/src/__tests__/init.test.ts`
**Cover:**
- [x] `--from-openapi` mode: reads spec, generates config, discovery JSON, A2A card
- [x] Interactive mode: mock inquirer prompts, validate generated files
- [x] Framework auto-detection (Next.js, Express, Hono)
- [x] Scope inference from OpenAPI tags/paths
- [x] Pricing suggestions based on HTTP method
- [x] File output: `agentgate.config.ts`, `.well-known/agentgate.json`, `.well-known/agent-card.json`
- [x] `--yes` flag for non-interactive defaults
- [x] Error: invalid OpenAPI spec path
- [x] Error: malformed OpenAPI spec

### 1.7 — CLI: Add tests for `commands/keygen.ts`
**File:** `packages/cli/src/commands/keygen.ts` (187 lines, **0 tests**)
**Create:** `packages/cli/src/__tests__/keygen.test.ts`
**Cover:**
- [x] Ed25519 keypair generation
- [x] Output to specified path
- [x] Default path `~/.agentgate/keys.json`
- [x] Directory creation if not exists
- [x] File permission handling
- [x] `--format` option (JSON, PEM)
- [x] Overwrite protection (existing key file)

### 1.8 — CLI: Add tests for `commands/status.ts`
**File:** `packages/cli/src/commands/status.ts` (299 lines, **0 tests**)
**Create:** `packages/cli/src/__tests__/status.test.ts`
**Cover:**
- [x] Finds and validates `agentgate.config.ts`
- [x] Checks `.well-known/agentgate.json` exists and is valid
- [x] Reports registered agent count (when connected to running server)
- [x] Reports request volume / revenue
- [x] Error: no config file found
- [x] Error: config file invalid

---

## PHASE 2: P0 Implementation Gaps

### 2.1 — Next.js: Implement proper JWT token issuance
**File:** `packages/next/src/middleware.ts` (line ~454)
**Issue:** Uses opaque tokens (`agt_xxx`) instead of signed JWTs. PRD specifies JWT with scope claims.
**Fix:**
- [x] Use `jose` library for JWT signing in route handlers
- [x] Sign tokens with configurable secret (from config or env)
- [x] Include claims: `agent_id`, `scopes`, `iat`, `exp`
- [x] Verify JWT in auth guard middleware
- [x] Update tests to validate JWT structure and claims

### 2.2 — Hono: Implement proper JWT token issuance
**File:** `packages/hono/src/middleware.ts` (line ~608)
**Issue:** Same as Next.js — opaque tokens instead of JWTs.
**Fix:**
- [x] Use `jose` library for JWT signing
- [x] Match Express implementation behavior
- [x] Update tests

### 2.3 — Hono: Add `onAgentAuthenticated` callback
**File:** `packages/hono/src/middleware.ts`
**Issue:** Has `onAgentRegistered` but missing `onAgentAuthenticated` (Express has both).
**Fix:**
- [x] Add callback invocation in auth endpoint
- [x] Add tests for callback execution

### 2.4 — Persist pending registrations to AgentStore
**Files:** `packages/express/src/routes/register.ts`, `packages/next/src/middleware.ts`, `packages/hono/src/middleware.ts`
**Issue:** All three adapters store pending challenges in module-level `Map`s. If the server restarts between register step 1 and step 2, the challenge is lost. Doesn't work in multi-instance deployments.
**Fix:**
- [x] Use the `AgentStore` challenge methods (`saveChallenge`, `getChallenge`, `deleteChallenge`) which already exist in the storage interface
- [x] Remove in-memory Maps
- [x] Add TTL-based cleanup (challenges expire after 5 min)
- [x] Update tests to verify persistence

---

## PHASE 3: P1 Feature Gaps

### 3.1 — Dashboard: Wire to real AgentStore backend
**Dir:** `apps/dashboard/`
**Issue:** All 3 API routes (`/api/agents`, `/api/stats`, `/api/events`) return mock data.
**Fix:**
- [x] Accept `AGENTGATE_STORE_URL` or `DATABASE_URL` env var
- [x] Connect API routes to real `AgentStore` (Postgres or SQLite)
- [x] `/api/agents` — query `agents` table with filtering, sorting, pagination
- [x] `/api/stats` — aggregate from `agent_requests` table (traffic, revenue, frameworks, scopes)
- [x] `/api/events` — query `agent_requests` + agent status changes
- [x] Keep mock data as fallback for demo/dev mode
- [x] Add loading states and error handling in the UI
- [x] Add tests for API routes with in-memory store

### 3.2 — Dashboard: Add real-time charts
**Dir:** `apps/dashboard/src/app/page.tsx`
**Issue:** Charts are rendered as static CSS bars. No real charting library.
**Fix:**
- [x] Add lightweight chart library (e.g., recharts or chart.js)
- [x] Traffic chart: stacked bar (human vs agent) over time
- [x] Revenue chart: line/bar over time
- [x] Framework breakdown: horizontal bar chart
- [x] Auto-refresh data on interval (or SSE/websocket for real-time)

### 3.3 — Dashboard: Add agent detail page
**Issue:** No individual agent detail view. Only the list table exists.
**Fix:**
- [x] Create `/agents/[id]/page.tsx` route
- [x] Show agent profile: ID, public key, scopes, status, reputation, metadata
- [x] Show agent usage history (requests over time)
- [x] Show agent revenue contribution
- [x] Actions: suspend, ban, adjust rate limits, adjust spending caps

### 3.4 — Dashboard: Add configuration page
**Issue:** PRD specifies "Live-edit scopes, pricing, rate limits, spending caps" in dashboard.
**Fix:**
- [x] Create `/settings/page.tsx` route
- [x] Edit scopes and pricing
- [x] Edit default rate limits
- [x] Edit spending caps
- [x] Persist changes to config store
- [x] Add confirmation dialogs for destructive changes

### 3.5 — Python SDK: Add test suite and CI integration
**Dir:** `packages/python-sdk/`
**Issue:** Real Python code exists but tests aren't run in CI. Package marked as private.
**Fix:**
- [x] Write pytest tests for `agent.py`, `crypto.py`, `credentials.py`, `discovery.py`
- [x] Add `pytest` and `httpx` to test dependencies in `pyproject.toml`
- [x] Add Python test step to `.github/workflows/ci.yml`
- [x] Remove `"private": true` from package.json (or confirm intent)
- [x] Verify `pyproject.toml` has correct metadata for PyPI publishing

### 3.6 — FastAPI Adapter: Add test suite and CI integration
**Dir:** `packages/fastapi-adapter/`
**Issue:** Same as Python SDK — real code, no CI testing.
**Fix:**
- [x] Write pytest tests for `middleware.py`, `models.py`, `store.py`, `crypto.py`
- [x] Test full registration flow via FastAPI TestClient
- [x] Add to CI workflow
- [x] Remove `"private": true` or confirm intent
- [x] Verify `pyproject.toml` metadata

### 3.7 — Webhook events: Wire into Next.js and Hono adapters
**Issue:** `WebhookEmitter` exists in core and is used in Express adapter, but not in Next.js or Hono.
**Fix:**
- [x] Accept `webhooks` config in Next.js adapter
- [x] Emit `agent.registered`, `agent.authenticated` events from Next.js route handlers
- [x] Accept `webhooks` config in Hono adapter
- [x] Emit events from Hono middleware
- [x] Add tests for webhook emission in both adapters

### 3.8 — Reputation system: Wire into adapters
**Issue:** `ReputationManager` exists in core and is used in Express, but verify it's wired into Next.js and Hono.
**Fix:**
- [x] Verify reputation checks in Next.js auth guard
- [x] Verify reputation checks in Hono auth guard
- [x] Add reputation-based gating tests for both adapters
- [x] Verify reputation update on successful/failed requests

### 3.9 — Spending caps: Wire into adapters
**Issue:** `SpendingTracker` exists in core and is used in Express, but verify Next.js and Hono.
**Fix:**
- [x] Verify spending cap enforcement in Next.js
- [x] Verify spending cap enforcement in Hono
- [x] Add spending cap exceeded tests for both adapters

---

## PHASE 4: Build & CI Polish

### 4.1 — Fix Turbo output warnings
**Issue:** 7 packages produce Turbo warnings about missing `outputs` for the build task.
**Fix:**
- [x] `apps/dashboard` — add `".next/**"` to turbo outputs
- [x] `packages/python-sdk` — either add a no-op build or exclude from turbo build
- [x] `packages/fastapi-adapter` — same
- [x] `packages/template-*` (3 packages) — exclude from turbo build or add no-op
- [x] `examples/nextjs-saas` — add `".next/**"` to turbo outputs
- [x] Verify `turbo.json` task config for non-TS packages

### 4.2 — Add Python CI step
**File:** `.github/workflows/ci.yml`
**Fix:**
- [x] Add Python 3.11+ setup step
- [x] Run `pip install -e ".[test]"` for python-sdk and fastapi-adapter
- [x] Run `pytest` for both Python packages
- [x] Add to CI matrix or as a separate job

### 4.3 — Add test coverage reporting
**Fix:**
- [x] Add `vitest --coverage` to CI
- [x] Set minimum coverage thresholds (recommend: 80% lines, 75% branches)
- [x] Add coverage badge to README
- [x] Add `pytest --cov` for Python packages

### 4.4 — Verify npm publish pipeline
**File:** `.github/workflows/publish.yml`
**Fix:**
- [x] Dry-run publish locally: `pnpm -r publish --access public --dry-run`
- [x] Verify `package.json` `files` field for each package includes `dist/` and not `src/__tests__/`
- [x] Verify package names are available on npm (or scoped under @agentgate)
- [x] Add PyPI publish step for Python packages

---

## PHASE 5: Documentation & Examples Polish

### 5.1 — Flesh out examples
**Issue:** Examples are functional single-file demos. PRD envisions "full working examples."
**Fix per example:**
- [x] `express-weather-api/` — add README, .env.example, docker-compose for Postgres store, seed data
- [x] `nextjs-saas/` — add README, .env.example, show human+agent side-by-side
- [x] `hono-cloudflare/` — add README, deployment instructions, wrangler.toml walkthrough
- [x] `agent-typescript/` — add README, show credential caching, multi-service demo
- [x] `agent-langchain/` — add README, show tool composition, error handling patterns

### 5.2 — Add integration test suite
**Create:** `tests/integration/` at repo root
**Cover:**
- [x] Full E2E: Express server + SDK client — discover → register → verify → authenticated request
- [x] Full E2E: Next.js server + SDK client
- [x] Full E2E: Hono server + SDK client
- [x] Cross-adapter compatibility: register on Express, auth on same config with different adapter
- [x] Rate limiting E2E: exceed rate limit, verify 429 response
- [x] Reputation E2E: low-reputation agent gets gated
- [x] x402 payment flow E2E (mocked facilitator)
- [x] Detection middleware E2E: agent vs browser requests

### 5.3 — README improvements
**File:** `README.md`
**Fix:**
- [x] Add badges: build status, npm version, test coverage, license
- [x] Add "Quick Start" code snippet directly in README (not just link to docs)
- [x] Add architecture diagram (text-based or image)
- [x] Add comparison table vs Clerk/Auth0/Stytch
- [x] Add link to each package in packages/ with one-line description

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
