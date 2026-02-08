import type {
  AgentGateConfig,
  AgentContext,
  ScopeDefinition,
  Agent,
} from "@agentgate/core";

// ---------------------------------------------------------------------------
// In-memory stores (edge-compatible, no native deps)
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

interface StoredAgent {
  id: string;
  publicKey: string;
  apiKeyHash: string;
  apiKey: string;
  scopesGranted: string[];
  x402Wallet?: string;
  metadata: Record<string, string>;
  createdAt: Date;
}

const registeredAgents = new Map<string, StoredAgent>();
const pendingChallenges = new Map<string, PendingChallenge>();

// ---------------------------------------------------------------------------
// Crypto helpers (Web Crypto API — edge runtime compatible)
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
    return false;
  }
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
// JSON response helper
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AgentGateVercelConfig extends AgentGateConfig {
  /**
   * Path patterns that require agent auth verification.
   * Defaults to `["/api/"]`.
   */
  protectedPaths?: string[];

  /**
   * When `true`, unauthenticated requests to protected paths pass through
   * with `x-agentgate-authenticated` header set to `"false"`.
   * When `false` (default), unauthenticated requests receive a 401.
   */
  passthrough?: boolean;
}

// ---------------------------------------------------------------------------
// Edge middleware factory
// ---------------------------------------------------------------------------

/**
 * Creates a Vercel Edge middleware function that uses standard Web APIs.
 *
 * Handles:
 * 1. `GET /.well-known/agentgate.json` — discovery document
 * 2. `POST /agentgate/register` — agent registration + challenge
 * 3. `POST /agentgate/register/verify` — challenge verification
 * 4. `POST /agentgate/auth` — returning agent authentication
 * 5. Auth guard for protected path prefixes
 *
 * Non-matching requests are passed through (returns `null`), signaling
 * that the Vercel platform should continue to the origin.
 */
export function createEdgeMiddleware(config: AgentGateVercelConfig) {
  const protectedPrefixes = config.protectedPaths ?? ["/api/"];
  const passthrough = config.passthrough ?? false;

  return async function agentGateEdgeMiddleware(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // ---- Discovery ----
    if (pathname === "/.well-known/agentgate.json" && method === "GET") {
      return jsonResponse(buildDiscoveryDocument(config), 200, {
        "Cache-Control": "public, max-age=3600",
      });
    }

    // ---- Registration ----
    if (pathname === "/agentgate/register" && method === "POST") {
      return handleRegister(request, config);
    }

    // ---- Registration verify ----
    if (pathname === "/agentgate/register/verify" && method === "POST") {
      return handleRegisterVerify(request, config);
    }

    // ---- Auth (returning agents) ----
    if (pathname === "/agentgate/auth" && method === "POST") {
      return handleAuth(request);
    }

    // ---- Auth guard for protected routes ----
    const isProtected = protectedPrefixes.some((prefix) => pathname.startsWith(prefix));
    if (isProtected) {
      return handleAuthGuard(request, passthrough, config);
    }

    // Non-AgentGate routes — return null to pass through to origin.
    return null;
  };
}

// ---------------------------------------------------------------------------
// Route handler implementations
// ---------------------------------------------------------------------------

async function handleRegister(
  request: Request,
  config: AgentGateVercelConfig,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const publicKey = body.public_key as string | undefined;
  const scopesRequested = body.scopes_requested as string[] | undefined;
  const x402Wallet = body.x402_wallet as string | undefined;
  const metadata = (body.metadata as Record<string, string>) ?? {};

  if (!publicKey || typeof publicKey !== "string") {
    return jsonResponse({ error: "public_key is required" }, 400);
  }

  if (!scopesRequested || !Array.isArray(scopesRequested) || scopesRequested.length === 0) {
    return jsonResponse({ error: "scopes_requested must be a non-empty array" }, 400);
  }

  // Validate requested scopes against available scopes.
  const availableScopeIds = new Set((config.scopes ?? []).map((s) => s.id));
  const invalidScopes = scopesRequested.filter((s) => !availableScopeIds.has(s));
  if (invalidScopes.length > 0) {
    return jsonResponse(
      { error: `Invalid scopes: ${invalidScopes.join(", ")}` },
      400,
    );
  }

  // Check for duplicate public key.
  for (const agent of registeredAgents.values()) {
    if (agent.publicKey === publicKey) {
      return jsonResponse(
        { error: "Public key already registered", agent_id: agent.id },
        409,
      );
    }
  }

  const agentId = generateId("ag_");
  const nonce = generateNonce();
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `agentgate:register:${agentId}:${timestamp}:${nonce}`;
  const expiresAt = Date.now() + 5 * 60 * 1000;

  pendingChallenges.set(agentId, {
    nonce,
    message,
    publicKey,
    scopesRequested,
    x402Wallet,
    metadata,
    expiresAt,
  });

  return jsonResponse(
    {
      agent_id: agentId,
      challenge: {
        nonce,
        message,
        expires_at: new Date(expiresAt).toISOString(),
      },
    },
    201,
  );
}

async function handleRegisterVerify(
  request: Request,
  config: AgentGateVercelConfig,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const agentId = body.agent_id as string | undefined;
  const signature = body.signature as string | undefined;

  if (!agentId || !signature) {
    return jsonResponse({ error: "agent_id and signature are required" }, 400);
  }

  const challenge = pendingChallenges.get(agentId);
  if (!challenge) {
    return jsonResponse({ error: "Unknown agent_id or challenge not found" }, 404);
  }

  if (Date.now() > challenge.expiresAt) {
    pendingChallenges.delete(agentId);
    return jsonResponse({ error: "Challenge expired" }, 410);
  }

  const valid = await verifyEd25519(challenge.message, signature, challenge.publicKey);
  if (!valid) {
    return jsonResponse({ error: "Invalid signature" }, 400);
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
      const agentRecord: Agent = {
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
        lastAuthAt: new Date(),
        totalRequests: 0,
        totalX402Paid: 0,
      };
      await config.onAgentRegistered(agentRecord);
    } catch {
      // Non-fatal.
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

  return jsonResponse(responseBody, 200);
}

async function handleAuth(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const agentId = body.agent_id as string | undefined;
  const signature = body.signature as string | undefined;
  const timestamp = body.timestamp as string | undefined;

  if (!agentId || !signature || !timestamp) {
    return jsonResponse(
      { error: "agent_id, signature, and timestamp are required" },
      400,
    );
  }

  const agent = registeredAgents.get(agentId);
  if (!agent) {
    return jsonResponse({ error: "Unknown agent_id" }, 404);
  }

  const message = `agentgate:auth:${agentId}:${timestamp}`;
  const valid = await verifyEd25519(message, signature, agent.publicKey);
  if (!valid) {
    return jsonResponse({ error: "Invalid signature" }, 400);
  }

  const token = `agt_${generateId("")}`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  return jsonResponse({
    token,
    expires_at: expiresAt.toISOString(),
  }, 200);
}

async function handleAuthGuard(
  request: Request,
  passthrough: boolean,
  config: AgentGateVercelConfig,
): Promise<Response> {
  const authHeader = request.headers.get("authorization");

  if (!authHeader) {
    if (passthrough) {
      return passthroughResponse(request);
    }
    return jsonResponse({ error: "Authorization header required" }, 401);
  }

  const token = authHeader.replace(/^Bearer\s+/i, "");

  // Look up agent by API key.
  let matchedAgent: StoredAgent | undefined;

  for (const agent of registeredAgents.values()) {
    if (agent.apiKey === token) {
      matchedAgent = agent;
      break;
    }
  }

  if (!matchedAgent) {
    // Try hash comparison.
    const hashed = await sha256(token);
    for (const agent of registeredAgents.values()) {
      if (agent.apiKeyHash === hashed) {
        matchedAgent = agent;
        break;
      }
    }
  }

  if (!matchedAgent) {
    if (passthrough) {
      return passthroughResponse(request);
    }
    return jsonResponse({ error: "Invalid or expired token" }, 401);
  }

  // Build agent context and pass it via headers to downstream handlers.
  const agentContext: AgentContext = {
    id: matchedAgent.id,
    publicKey: matchedAgent.publicKey,
    scopes: matchedAgent.scopesGranted,
    rateLimit: config.rateLimit ?? { requests: 1000, window: "1h" },
    metadata: matchedAgent.metadata,
  };

  // Return a response that signals the platform to continue to origin
  // with the agent context injected as headers.
  const headers = new Headers(request.headers);
  headers.set("x-agentgate-agent", JSON.stringify(agentContext));
  headers.set("x-agentgate-authenticated", "true");
  headers.set("x-agentgate-agent-id", matchedAgent.id);

  // Return a 200 with agent context headers. In a real Vercel deployment,
  // you would use NextResponse.next() — here we return a JSON response
  // that includes the context for testing/standalone use.
  return new Response(null, {
    status: 200,
    headers: {
      "x-agentgate-agent": JSON.stringify(agentContext),
      "x-agentgate-authenticated": "true",
      "x-agentgate-agent-id": matchedAgent.id,
    },
  });
}

/**
 * Return a passthrough response indicating the request is not from an
 * authenticated agent.
 */
function passthroughResponse(_request: Request): Response {
  return new Response(null, {
    status: 200,
    headers: {
      "x-agentgate-authenticated": "false",
    },
  });
}
