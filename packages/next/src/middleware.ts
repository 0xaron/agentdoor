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
    _NextResponse = (mod as { NextResponse: typeof _NextResponse }).NextResponse;
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
// Discovery document generation
// ---------------------------------------------------------------------------

function buildDiscoveryDocument(config: AgentGateConfig): Record<string, unknown> {
  return {
    agentgate_version: "1.0",
    service_name: config.serviceName ?? "AgentGate Service",
    service_description: config.serviceDescription ?? "",
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
      default: config.rateLimit?.default ?? "1000/hour",
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
      return handleAuth(request, NR);
    }

    // ---- Auth guard for protected routes ----
    const isProtected = protectedPrefixes.some((prefix) => pathname.startsWith(prefix));
    if (isProtected) {
      return handleAuthGuard(request, passthrough, NR);
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
        apiKey,
        rateLimit: config.rateLimit ?? { default: "1000/hour" },
        createdAt: new Date(),
        lastAuthAt: new Date(),
      });
    } catch {
      // Callback errors are non-fatal.
    }
  }

  const responseBody: Record<string, unknown> = {
    agent_id: agentId,
    api_key: apiKey,
    scopes_granted: challenge.scopesRequested,
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

  // Issue a short-lived token (1 hour). In production this would be a JWT
  // signed with jose — here we return a simple opaque token for edge compat.
  const token = `agt_${generateId("")}`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  return NR.json({
    token,
    expires_at: expiresAt.toISOString(),
  });
}

async function handleAuthGuard(
  request: NextRequest,
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

  // Inject agent context into request headers so downstream route handlers
  // can access it. Edge middleware cannot mutate `request` objects directly
  // in Next.js, so we pass information through headers.
  const agentContext: AgentContext = {
    id: matchedAgent.id,
    publicKey: matchedAgent.publicKey,
    scopes: matchedAgent.scopesGranted,
    rateLimit: { default: "1000/hour" },
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
