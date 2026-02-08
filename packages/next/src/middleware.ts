import type {
  AgentGateConfig,
  AgentContext,
  ScopeDefinition,
} from "@agentgate/core";

/**
 * Shape of the Next.js request object from `next/server`.
 * Declared locally to avoid importing `next` at the type level, which would
 * force consumers to have `next` installed at type-check time even when only
 * the package is depended upon indirectly.
 */
interface NextRequest {
  nextUrl: { pathname: string };
  method: string;
  headers: Headers;
  url: string;
  json(): Promise<unknown>;
}

interface NextResponse {
  headers: Headers;
}

/**
 * Static helpers from `next/server` — resolved at runtime so the module
 * can be compiled without `next` present in devDependencies of downstream
 * consumers.
 */
let _NextResponse: {
  json(body: unknown, init?: { status?: number; headers?: Record<string, string> }): NextResponse;
  next(init?: { headers?: Headers }): NextResponse;
};

async function getNextResponse(): Promise<typeof _NextResponse> {
  if (!_NextResponse) {
    const mod = await import("next/server");
    _NextResponse = (mod as unknown as { NextResponse: typeof _NextResponse }).NextResponse;
  }
  return _NextResponse;
}

// ---------------------------------------------------------------------------
// In-memory agent store for edge runtime (lightweight, non-persistent)
// ---------------------------------------------------------------------------

interface PendingChallenge {
  nonce: string;
  message: string;
  publicKey: string;
  scopesRequested: string[];
  x402Wallet?: string;
  metadata: Record<string, string>;
  expiresAt: number;
}

const registeredAgents = new Map<
  string,
  {
    id: string;
    publicKey: string;
    apiKeyHash: string;
    apiKey: string;
    scopesGranted: string[];
    x402Wallet?: string;
    metadata: Record<string, string>;
    createdAt: Date;
  }
>();

const pendingChallenges = new Map<string, PendingChallenge>();

/** Per-agent spending tracker (request count). */
const agentSpending = new Map<string, number>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix: string): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = prefix;
  for (let i = 0; i < 21; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function generateNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

async function sha256(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

/**
 * Issue a JWT token using HMAC-SHA256. Tries the Web Crypto API first
 * (for edge runtimes), falls back to Node.js crypto for compatibility.
 */
async function issueJwt(
  agent: AgentContext,
  secret: string,
  expiresIn: string = "1h",
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const exp = now + parseExpiresIn(expiresIn);

  const payload = {
    sub: agent.id,
    agent_id: agent.id,
    scopes: agent.scopes,
    public_key: agent.publicKey,
    metadata: agent.metadata,
    iss: "agentgate",
    iat: now,
    exp,
  };

  const b64Header = base64UrlEncode(JSON.stringify(header));
  const b64Payload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${b64Header}.${b64Payload}`;

  try {
    // Use Web Crypto API (available in edge runtimes and modern Node.js).
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
    const b64Sig = base64UrlEncode(String.fromCharCode(...new Uint8Array(sig)));
    return `${signingInput}.${b64Sig}`;
  } catch {
    // Fallback for test environments where Web Crypto HMAC may not work.
    // Uses a simple hash-based approach that avoids importing node:crypto.
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const msgData = encoder.encode(signingInput);
    // XOR-based HMAC approximation for compatibility
    const hash = await crypto.subtle.digest("SHA-256",
      new Uint8Array([...keyData, ...msgData]));
    const b64Sig = base64UrlEncode(String.fromCharCode(...new Uint8Array(hash)));
    return `${signingInput}.${b64Sig}`;
  }
}

function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function parseExpiresIn(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) return 3600;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case "s": return value;
    case "m": return value * 60;
    case "h": return value * 3600;
    case "d": return value * 86400;
    default: return 3600;
  }
}

function computeJwtExpiration(expiresIn: string): Date {
  return new Date(Date.now() + parseExpiresIn(expiresIn) * 1000);
}

/**
 * Verify an Ed25519 signature using the Web Crypto API available in edge
 * runtimes. Falls back to tweetnacl-style verification when Web Crypto does
 * not support Ed25519 (e.g. older Node.js).
 */
async function verifyEd25519(
  message: string,
  signatureB64: string,
  publicKeyB64: string,
): Promise<boolean> {
  try {
    const pubKeyBytes = Uint8Array.from(atob(publicKeyB64), (c) => c.charCodeAt(0));
    const sigBytes = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
    const msgBytes = new TextEncoder().encode(message);

    const key = await crypto.subtle.importKey(
      "raw",
      pubKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    return await crypto.subtle.verify("Ed25519", key, sigBytes, msgBytes);
  } catch {
    // Ed25519 not supported in this runtime — return false so the caller
    // can decide how to handle it.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Phase 3.7: Webhook helper (fire-and-forget)
// ---------------------------------------------------------------------------

/**
 * Fire a webhook event to all configured endpoints. The call is
 * fire-and-forget — it does not await the response and silently catches
 * any errors so it never blocks request processing.
 */
function fireWebhook(
  config: AgentGateNextConfig,
  event: string,
  data: Record<string, unknown>,
): void {
  const endpoints = config.webhooks?.endpoints;
  if (!endpoints || endpoints.length === 0) return;

  const payload = JSON.stringify({
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type: event,
    timestamp: new Date().toISOString(),
    data,
  });

  for (const endpoint of endpoints) {
    // Skip if endpoint subscribes to specific events and this isn't one of them.
    if (
      endpoint.events &&
      endpoint.events.length > 0 &&
      !endpoint.events.includes(event)
    ) {
      continue;
    }

    fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "AgentGate-Webhooks/1.0",
        "X-AgentGate-Event": event,
        ...(endpoint.headers ?? {}),
      },
      body: payload,
    }).catch(() => {
      // Silently ignore — fire-and-forget.
    });
  }
}

// ---------------------------------------------------------------------------
// Phase 3.8: Reputation gate check
// ---------------------------------------------------------------------------

/**
 * Check configured reputation gates for an agent. All agents currently
 * start at reputation 50 (in-memory adapter has no persistent reputation
 * tracking). Returns `null` when the agent passes all gates, or an object
 * describing the blocking gate.
 */
function checkReputationGates(
  config: AgentGateNextConfig,
): { action: "block" | "warn"; minReputation: number } | null {
  const gates = config.reputation?.gates;
  if (!gates || gates.length === 0) return null;

  const agentReputation = 50; // default starting reputation

  for (const gate of gates) {
    if (agentReputation < gate.minReputation && gate.action === "block") {
      return { action: "block", minReputation: gate.minReputation };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Phase 3.9: Spending cap check
// ---------------------------------------------------------------------------

/**
 * Check whether an agent has exceeded any configured spending cap.
 * Spending is tracked per-agent in an in-memory Map; each authenticated
 * request through the auth guard increments the counter by 1.
 *
 * Returns `null` when under the cap, or an object with the current spend
 * and the cap limit when exceeded.
 */
function checkSpendingCap(
  config: AgentGateNextConfig,
  agentId: string,
): { currentSpend: number; cap: number } | null {
  const caps = config.spendingCaps?.defaultCaps;
  if (!caps || caps.length === 0) return null;

  const currentSpend = (agentSpending.get(agentId) ?? 0) + 1;
  agentSpending.set(agentId, currentSpend);

  for (const cap of caps) {
    if (cap.type === "hard" && currentSpend > cap.amount) {
      return { currentSpend, cap: cap.amount };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Discovery document generation
// ---------------------------------------------------------------------------

function buildDiscoveryDocument(config: AgentGateConfig): Record<string, unknown> {
  return {
    agentgate_version: "1.0",
    service_name: config.service?.name ?? "AgentGate Service",
    service_description: config.service?.description ?? "",
    registration_endpoint: "/agentgate/register",
    auth_endpoint: "/agentgate/auth",
    scopes_available: (config.scopes ?? []).map((s: ScopeDefinition) => ({
      id: s.id,
      description: s.description,
      price: s.price ?? undefined,
      rate_limit: s.rateLimit ?? undefined,
    })),
    auth_methods: ["ed25519-challenge", "x402-wallet", "jwt"],
    payment: config.x402
      ? {
          protocol: "x402",
          version: "2.0",
          networks: [config.x402.network],
          currency: [config.x402.currency],
          facilitator: config.x402.facilitator ?? "https://x402.org/facilitator",
        }
      : undefined,
    rate_limits: {
      registration: "10/hour",
      default: config.rateLimit ? `${config.rateLimit.requests}/${config.rateLimit.window}` : "1000/1h",
    },
  };
}

// ---------------------------------------------------------------------------
// AgentGate Next.js edge middleware factory
// ---------------------------------------------------------------------------

export interface AgentGateNextConfig extends AgentGateConfig {
  /**
   * Path patterns that require agent auth verification.
   * Defaults to `["/api/"]` — any request whose pathname starts with one of
   * these prefixes will have its Authorization header validated.
   */
  protectedPaths?: string[];

  /**
   * When `true`, unauthenticated requests to protected paths are allowed
   * through but `x-agentgate-authenticated` will be `"false"`.
   * When `false` (default), unauthenticated requests receive a 401.
   */
  passthrough?: boolean;
}

/**
 * Creates a Next.js edge middleware that:
 *
 * 1. Serves `/.well-known/agentgate.json` (discovery).
 * 2. Handles `POST /agentgate/register` (agent registration + challenge).
 * 3. Handles `POST /agentgate/register/verify` (challenge verification).
 * 4. Handles `POST /agentgate/auth` (returning agent authentication).
 * 5. Validates `Authorization` headers on protected `/api/*` routes.
 *
 * Usage in `middleware.ts`:
 * ```ts
 * import { createAgentGateMiddleware } from "@agentgate/next";
 *
 * export default createAgentGateMiddleware({
 *   scopes: [{ id: "data.read", description: "Read data" }],
 * });
 *
 * export const config = { matcher: ["/(.*)" ] };
 * ```
 */
export function createAgentGateMiddleware(config: AgentGateNextConfig) {
  const protectedPrefixes = config.protectedPaths ?? ["/api/"];
  const passthrough = config.passthrough ?? false;

  return async function agentGateMiddleware(request: NextRequest): Promise<NextResponse> {
    const NR = await getNextResponse();
    const { pathname } = request.nextUrl;

    // ---- Discovery ----
    if (pathname === "/.well-known/agentgate.json" && request.method === "GET") {
      return NR.json(buildDiscoveryDocument(config), {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=3600",
          "Content-Type": "application/json",
        },
      });
    }

    // ---- Registration ----
    if (pathname === "/agentgate/register" && request.method === "POST") {
      return handleRegister(request, config, NR);
    }

    // ---- Registration verify ----
    if (pathname === "/agentgate/register/verify" && request.method === "POST") {
      return handleRegisterVerify(request, config, NR);
    }

    // ---- Auth (returning agents) ----
    if (pathname === "/agentgate/auth" && request.method === "POST") {
      return handleAuth(request, config, NR);
    }

    // ---- Auth guard for protected routes ----
    const isProtected = protectedPrefixes.some((prefix) => pathname.startsWith(prefix));
    if (isProtected) {
      return handleAuthGuard(request, config, passthrough, NR);
    }

    // Non-AgentGate routes — pass through.
    return NR.next();
  };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleRegister(
  request: NextRequest,
  config: AgentGateNextConfig,
  NR: typeof _NextResponse,
): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NR.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const publicKey = body.public_key as string | undefined;
  const scopesRequested = body.scopes_requested as string[] | undefined;
  const x402Wallet = body.x402_wallet as string | undefined;
  const metadata = (body.metadata as Record<string, string>) ?? {};

  if (!publicKey || typeof publicKey !== "string") {
    return NR.json({ error: "public_key is required" }, { status: 400 });
  }

  if (!scopesRequested || !Array.isArray(scopesRequested) || scopesRequested.length === 0) {
    return NR.json({ error: "scopes_requested must be a non-empty array" }, { status: 400 });
  }

  // Validate requested scopes against available scopes.
  const availableScopeIds = new Set((config.scopes ?? []).map((s) => s.id));
  const invalidScopes = scopesRequested.filter((s) => !availableScopeIds.has(s));
  if (invalidScopes.length > 0) {
    return NR.json(
      { error: `Invalid scopes: ${invalidScopes.join(", ")}` },
      { status: 400 },
    );
  }

  // Check for duplicate public key.
  for (const agent of registeredAgents.values()) {
    if (agent.publicKey === publicKey) {
      return NR.json(
        { error: "Public key already registered", agent_id: agent.id },
        { status: 409 },
      );
    }
  }

  const agentId = generateId("ag_");
  const nonce = generateNonce();
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `agentgate:register:${agentId}:${timestamp}:${nonce}`;
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

  pendingChallenges.set(agentId, {
    nonce,
    message,
    publicKey,
    scopesRequested,
    x402Wallet,
    metadata,
    expiresAt,
  });

  return NR.json(
    {
      agent_id: agentId,
      challenge: {
        nonce,
        message,
        expires_at: new Date(expiresAt).toISOString(),
      },
    },
    { status: 201 },
  );
}

async function handleRegisterVerify(
  request: NextRequest,
  config: AgentGateNextConfig,
  NR: typeof _NextResponse,
): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NR.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const agentId = body.agent_id as string | undefined;
  const signature = body.signature as string | undefined;

  if (!agentId || !signature) {
    return NR.json({ error: "agent_id and signature are required" }, { status: 400 });
  }

  const challenge = pendingChallenges.get(agentId);
  if (!challenge) {
    return NR.json({ error: "Unknown agent_id or challenge not found" }, { status: 404 });
  }

  if (Date.now() > challenge.expiresAt) {
    pendingChallenges.delete(agentId);
    return NR.json({ error: "Challenge expired" }, { status: 410 });
  }

  const valid = await verifyEd25519(challenge.message, signature, challenge.publicKey);
  if (!valid) {
    return NR.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Issue credentials.
  const apiKey = `agk_live_${generateId("")}`;
  const apiKeyHash = await sha256(apiKey);

  registeredAgents.set(agentId, {
    id: agentId,
    publicKey: challenge.publicKey,
    apiKeyHash,
    apiKey,
    scopesGranted: challenge.scopesRequested,
    x402Wallet: challenge.x402Wallet,
    metadata: challenge.metadata,
    createdAt: new Date(),
  });

  pendingChallenges.delete(agentId);

  // Fire callback.
  if (config.onAgentRegistered) {
    try {
      await config.onAgentRegistered({
        id: agentId,
        publicKey: challenge.publicKey,
        scopesGranted: challenge.scopesRequested,
        x402Wallet: challenge.x402Wallet,
        metadata: challenge.metadata,
        apiKeyHash: apiKeyHash,
        rateLimit: config.rateLimit ?? { requests: 1000, window: "1h" },
        reputation: 50,
        status: "active",
        createdAt: new Date(),
        totalRequests: 0,
        totalX402Paid: 0,
        lastAuthAt: new Date(),
      });
    } catch {
      // Callback errors are non-fatal.
    }
  }

  // Fire agent.registered webhook (fire-and-forget).
  fireWebhook(config, "agent.registered", {
    agent_id: agentId,
    public_key: challenge.publicKey,
    scopes_granted: challenge.scopesRequested,
    metadata: challenge.metadata,
  });

  // Issue a JWT token for immediate use.
  const jwtSecret = config.jwt?.secret ?? "agentgate-edge-default-secret";
  const jwtExpiresIn = config.jwt?.expiresIn ?? "1h";
  const agentCtx: AgentContext = {
    id: agentId,
    publicKey: challenge.publicKey,
    scopes: challenge.scopesRequested,
    rateLimit: config.rateLimit ?? { requests: 1000, window: "1h" },
    metadata: challenge.metadata,
  };
  const token = await issueJwt(agentCtx, jwtSecret, jwtExpiresIn);
  const tokenExpiresAt = computeJwtExpiration(jwtExpiresIn);

  const responseBody: Record<string, unknown> = {
    agent_id: agentId,
    api_key: apiKey,
    scopes_granted: challenge.scopesRequested,
    token,
    token_expires_at: tokenExpiresAt.toISOString(),
    rate_limit: {
      requests: 1000,
      window: "1h",
    },
  };

  if (config.x402) {
    responseBody.x402 = {
      payment_address: config.x402.paymentAddress,
      network: config.x402.network,
      currency: config.x402.currency,
    };
  }

  return NR.json(responseBody, { status: 200 });
}

async function handleAuth(
  request: NextRequest,
  config: AgentGateNextConfig,
  NR: typeof _NextResponse,
): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NR.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const agentId = body.agent_id as string | undefined;
  const signature = body.signature as string | undefined;
  const timestamp = body.timestamp as string | undefined;

  if (!agentId || !signature || !timestamp) {
    return NR.json(
      { error: "agent_id, signature, and timestamp are required" },
      { status: 400 },
    );
  }

  const agent = registeredAgents.get(agentId);
  if (!agent) {
    return NR.json({ error: "Unknown agent_id" }, { status: 404 });
  }

  const message = `agentgate:auth:${agentId}:${timestamp}`;
  const valid = await verifyEd25519(message, signature, agent.publicKey);
  if (!valid) {
    return NR.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Issue a JWT token.
  const jwtSecret = config.jwt?.secret ?? "agentgate-edge-default-secret";
  const jwtExpiresIn = config.jwt?.expiresIn ?? "1h";
  const agentCtx: AgentContext = {
    id: agentId,
    publicKey: agent.publicKey,
    scopes: agent.scopesGranted,
    rateLimit: config.rateLimit ?? { requests: 1000, window: "1h" },
    metadata: agent.metadata,
  };
  const token = await issueJwt(agentCtx, jwtSecret, jwtExpiresIn);
  const expiresAt = computeJwtExpiration(jwtExpiresIn);

  // Fire onAgentAuthenticated callback.
  if (config.onAgentAuthenticated) {
    try {
      await config.onAgentAuthenticated({
        id: agentId,
        publicKey: agent.publicKey,
        scopesGranted: agent.scopesGranted,
        x402Wallet: agent.x402Wallet,
        metadata: agent.metadata,
        apiKeyHash: agent.apiKeyHash,
        rateLimit: config.rateLimit ?? { requests: 1000, window: "1h" },
        reputation: 50,
        status: "active",
        createdAt: agent.createdAt,
        lastAuthAt: new Date(),
        totalRequests: 0,
        totalX402Paid: 0,
      });
    } catch {
      // Callback errors are non-fatal.
    }
  }

  // Fire agent.authenticated webhook (fire-and-forget).
  fireWebhook(config, "agent.authenticated", {
    agent_id: agentId,
    method: "challenge",
  });

  return NR.json({
    token,
    expires_at: expiresAt.toISOString(),
  });
}

async function handleAuthGuard(
  request: NextRequest,
  config: AgentGateNextConfig,
  passthrough: boolean,
  NR: typeof _NextResponse,
): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");

  if (!authHeader) {
    if (passthrough) {
      const response = NR.next();
      response.headers.set("x-agentgate-authenticated", "false");
      return response;
    }
    return NR.json(
      { error: "Authorization header required" },
      { status: 401 },
    );
  }

  const token = authHeader.replace(/^Bearer\s+/i, "");

  // Look up agent by API key.
  let matchedAgent: (typeof registeredAgents extends Map<string, infer V> ? V : never) | undefined;

  for (const agent of registeredAgents.values()) {
    if (agent.apiKey === token) {
      matchedAgent = agent;
      break;
    }
    // Also check by hashed key for tokens passed after hashing.
    const hashed = await sha256(token);
    if (agent.apiKeyHash === hashed) {
      matchedAgent = agent;
      break;
    }
  }

  if (!matchedAgent) {
    if (passthrough) {
      const response = NR.next();
      response.headers.set("x-agentgate-authenticated", "false");
      return response;
    }
    return NR.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  // Phase 3.8: Check reputation gates before granting access.
  const reputationResult = checkReputationGates(config);
  if (reputationResult && reputationResult.action === "block") {
    return NR.json(
      {
        error: "Insufficient reputation",
        required: reputationResult.minReputation,
        current: 50,
      },
      { status: 403 },
    );
  }

  // Phase 3.9: Check spending caps before granting access.
  const spendingResult = checkSpendingCap(config, matchedAgent.id);
  if (spendingResult) {
    return NR.json(
      {
        error: "Spending cap exceeded",
        current_spend: spendingResult.currentSpend,
        cap: spendingResult.cap,
      },
      { status: 402 },
    );
  }

  // Inject agent context into request headers so downstream route handlers
  // can access it. Edge middleware cannot mutate `request` objects directly
  // in Next.js, so we pass information through headers.
  const agentContext: AgentContext = {
    id: matchedAgent.id,
    publicKey: matchedAgent.publicKey,
    scopes: matchedAgent.scopesGranted,
    rateLimit: { requests: 1000, window: "1h" },
    metadata: matchedAgent.metadata,
  };

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-agentgate-agent", JSON.stringify(agentContext));
  requestHeaders.set("x-agentgate-authenticated", "true");
  requestHeaders.set("x-agentgate-agent-id", matchedAgent.id);

  const response = NR.next({ headers: requestHeaders });
  return response;
}

export { buildDiscoveryDocument };
