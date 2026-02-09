# AgentGate — Remaining Tasks

> Updated 2026-02-09 after codebase verification audit. Checked items are verified complete.

---

## PHASE 2: P0 Implementation Gaps

### 2.4 — Persist pending registrations to AgentStore (Next.js & Hono)
**Files:** `packages/next/src/middleware.ts`, `packages/hono/src/middleware.ts`
**Issue:** Next.js and Hono still use in-memory `pendingChallenges` Maps. Express already uses AgentStore. Multi-instance deployments lose challenges on restart.
**Fix:**
- [x] Use `AgentStore` challenge methods (`saveChallenge`, `getChallenge`, `deleteChallenge`) in Next.js adapter
- [x] Use `AgentStore` challenge methods in Hono adapter
- [x] Remove in-memory Maps from both adapters
- [x] Add TTL-based cleanup (challenges expire after 5 min)
- [x] Update tests to verify persistence — _Persistence tests added for both Next.js and Hono with custom MemoryStore_

---

## PHASE 3: P1 Feature Gaps

### 3.2 — Dashboard: Add real charting library
**Dir:** `apps/dashboard/src/app/page.tsx`
**Issue:** Charts are custom CSS/flexbox bars, not a real charting library. No `recharts` or `chart.js` in `dashboard/package.json`.
**Fix:**
- [x] Add lightweight chart library (e.g., recharts or chart.js) — _recharts ^3.7.0 added_
- [x] Traffic chart: stacked bar (human vs agent) over time
- [x] Revenue chart: line/bar over time
- [x] Framework breakdown: horizontal bar chart
- [x] Auto-refresh data on interval (or SSE/websocket for real-time) — _AutoRefreshProvider and LiveStatsCards client components poll /api/stats every 30s_

### 3.7 — Webhook events: Wire into Next.js and Hono adapters
**Issue:** `WebhookEmitter` exists in core and is used in Express adapter, but not in Next.js or Hono.
**Fix:**
- [x] Accept `webhooks` config in Next.js adapter
- [~] Emit `agent.registered`, `agent.authenticated` events from Next.js route handlers — _Uses custom `fireWebhook()` instead of core `WebhookEmitter`; no retry or HMAC_
- [x] Accept `webhooks` config in Hono adapter
- [~] Emit events from Hono middleware — _Same custom implementation as Next.js_
- [x] Add tests for webhook emission in both adapters — _6 webhook tests for Next.js, 5 for Hono_

### 3.8 — Reputation system: Wire into Next.js and Hono adapters
**Issue:** `ReputationManager` exists in core and is used in Express, but missing from Next.js and Hono.
**Fix:**
- [ ] Add ReputationManager integration in Next.js auth guard — _Custom `checkReputationGates()` exists but doesn't use `ReputationManager` class_
- [ ] Add ReputationManager integration in Hono auth guard — _Same custom implementation_
- [ ] Add reputation-based gating tests for both adapters
- [ ] Add reputation update on successful/failed requests

---

## PHASE 4: Build & CI Polish

### 4.3 — Add test coverage reporting
**Issue:** No `vitest --coverage` or `pytest --cov` in CI. No coverage badges in README.
**Fix:**
- [x] Add `vitest --coverage` to CI
- [ ] Set minimum coverage thresholds (recommend: 80% lines, 75% branches)
- [ ] Add coverage badge to README
- [ ] Add `pytest --cov` for Python packages

### ~~4.4 — Add PyPI publish step~~ ✅ COMPLETE
**File:** `.github/workflows/publish.yml`
~~**Issue:** Only npm publishing exists. No PyPI publish step for Python packages.~~
**Fix:**
- [x] Add PyPI publish step for `python-sdk` and `fastapi-adapter` — _Both configured in publish.yml with twine_

---

## PHASE 5: Documentation & Examples Polish

### 5.2 — Add integration test suite
**Create:** `tests/integration/` at repo root
**Issue:** Directory exists but only Express E2E is implemented.
**Cover:**
- [x] Full E2E: Express server + SDK client — discover → register → verify → authenticated request
- [ ] Full E2E: Next.js server + SDK client
- [ ] Full E2E: Hono server + SDK client
- [ ] Cross-adapter compatibility: register on Express, auth on same config with different adapter
- [ ] Rate limiting E2E: exceed rate limit, verify 429 response
- [ ] Reputation E2E: low-reputation agent gets gated
- [ ] x402 payment flow E2E (mocked facilitator)
- [ ] Detection middleware E2E: agent vs browser requests

### 5.3 — README badges
**File:** `README.md`
**Issue:** Quick start and architecture diagram exist, but badges are missing.
**Fix:**
- [x] Add badges: build status — _CI workflow badge present_
- [x] Add badges: npm version — _@agentgate/core version badge present_
- [ ] Add badges: test coverage — _No coverage badge (blocked by 4.3)_
- [x] Add badges: license — _MIT badge present_
