import type { Context, MiddlewareHandler, Hono } from "hono";
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

/** Per-agent spending tracker (request count). */
const agentSpending = new Map<string, number>();

// ---------------------------------------------------------------------------
// Crypto helpers (Web Crypto API — works on CF Workers, Deno, Bun, Node 20+)
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
 * Issue a JWT token using HMAC-SHA256. Edge-compatible implementation
 * using the Web Crypto API (no jose dependency needed at the edge).
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
// Phase 3.7: Webhook helper (fire-and-forget)
// ---------------------------------------------------------------------------

/**
 * Fire a webhook event to all configured endpoints. The call is
 * fire-and-forget — it does not await the response and silently catches
 * any errors so it never blocks request processing.
 */
function fireWebhook(
  config: AgentGateHonoConfig,
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
  config: AgentGateHonoConfig,
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
  config: AgentGateHonoConfig,
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
// Hono variable types — extend Hono's context variables
// ---------------------------------------------------------------------------

/**
 * Variables that AgentGate middleware sets on the Hono context.
 * Consumers can declare these in their app type:
 *
 * ```ts
 * type Env = { Variables: AgentGateVariables };
 * const app = new Hono<Env>();
 * ```
 */
export interface AgentGateVariables {
  agent: AgentContext | null;
  isAgent: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AgentGateHonoConfig extends AgentGateConfig {
  /**
   * Path prefix patterns that require agent auth verification.
   * Defaults to `["/api"]`.
   */
  protectedPaths?: string[];

  /**
   * When true, unauthenticated requests to protected paths pass through
   * with `c.get("isAgent")` set to `false`. When false (default),
   * unauthenticated requests receive a 401 JSON response.
   */
  passthrough?: boolean;

  /**
   * Base path prefix for AgentGate routes. Defaults to empty string.
   * Set to e.g. "/v1" to mount routes at "/v1/agentgate/register" etc.
   */
  basePath?: string;
}

// ---------------------------------------------------------------------------
// Route mounting helper
// ---------------------------------------------------------------------------

/**
 * Mount all AgentGate routes onto a Hono app instance. This registers the
 * discovery, register, verify, and auth endpoints as explicit routes, plus
 * an auth guard middleware for protected paths.
 *
 * ```ts
 * import { Hono } from "hono";
 * import { agentgate } from "@agentgate/hono";
 *
 * const app = new Hono();
 *
 * agentgate(app, {
 *   scopes: [{ id: "data.read", description: "Read data" }],
 *   pricing: { "data.read": "$0.001/req" },
 * });
 *
 * app.get("/api/data", (c) => {
 *   const agent = c.get("agent");
 *   return c.json({ isAgent: c.get("isAgent"), agentId: agent?.id });
 * });
 *
 * export default app;
 * ```
 */
export function agentgate(app: Hono<{ Variables: AgentGateVariables }>, config: AgentGateHonoConfig): void {
  const base = config.basePath ?? "";

  // Discovery endpoint.
  app.get(`${base}/.well-known/agentgate.json`, (c: Context) => {
    const doc = buildDiscoveryDocument(config);
    return c.json(doc, 200, {
      "Cache-Control": "public, max-age=3600",
    });
  });

  // Registration endpoint.
  app.post(`${base}/agentgate/register`, async (c: Context) => {
    return handleRegister(c, config);
  });

  // Registration verification endpoint.
  app.post(`${base}/agentgate/register/verify`, async (c: Context) => {
    return handleRegisterVerify(c, config);
  });

  // Auth endpoint (returning agents).
  app.post(`${base}/agentgate/auth`, async (c: Context) => {
    return handleAuth(c, config);
  });

  // Auth guard middleware for protected paths.
  app.use("*", createAuthGuardMiddleware(config));
}

// ---------------------------------------------------------------------------
// Standalone middleware factories
// ---------------------------------------------------------------------------

/**
 * Create a Hono middleware that only mounts the auth guard on protected paths.
 * Useful when you want to mount AgentGate routes manually but still get
 * automatic auth verification.
 */
export function createAuthGuardMiddleware(
  config: AgentGateHonoConfig,
): MiddlewareHandler<{ Variables: AgentGateVariables }> {
  const protectedPrefixes = config.protectedPaths ?? ["/api"];
  const passthrough = config.passthrough ?? false;

  return async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    const isProtected = protectedPrefixes.some((prefix) => pathname.startsWith(prefix));

    if (!isProtected) {
      c.set("agent", null);
      c.set("isAgent", false);
      await next();
      return;
    }

    const authHeader = c.req.header("authorization");

    if (!authHeader) {
      if (passthrough) {
        c.set("agent", null);
        c.set("isAgent", false);
        await next();
        return;
      }
      return c.json({ error: "Authorization header required" }, 401);
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
      // Try hash comparison for tokens that were hashed.
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
        c.set("agent", null);
        c.set("isAgent", false);
        await next();
        return;
      }
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    // Phase 3.8: Check reputation gates before granting access.
    const reputationResult = checkReputationGates(config);
    if (reputationResult && reputationResult.action === "block") {
      return c.json(
        {
          error: "Insufficient reputation",
          required: reputationResult.minReputation,
          current: 50,
        },
        403,
      );
    }

    // Phase 3.9: Check spending caps before granting access.
    const spendingResult = checkSpendingCap(config, matchedAgent.id);
    if (spendingResult) {
      return c.json(
        {
          error: "Spending cap exceeded",
          current_spend: spendingResult.currentSpend,
          cap: spendingResult.cap,
        },
        402,
      );
    }

    const agentContext: AgentContext = {
      id: matchedAgent.id,
      publicKey: matchedAgent.publicKey,
      scopes: matchedAgent.scopesGranted,
      rateLimit: config.rateLimit ?? { requests: 1000, window: "1h" },
      metadata: matchedAgent.metadata,
    };

    c.set("agent", agentContext);
    c.set("isAgent", true);

    await next();
  };
}

/**
 * Create a standalone Hono middleware that handles all AgentGate routes
 * and auth guard in a single middleware function. Alternative to `agentgate()`
 * for more control over middleware ordering.
 *
 * ```ts
 * import { Hono } from "hono";
 * import { createAgentGateMiddleware } from "@agentgate/hono";
 *
 * const app = new Hono();
 * app.use("*", createAgentGateMiddleware({
 *   scopes: [{ id: "data.read", description: "Read data" }],
 * }));
 * ```
 */
export function createAgentGateMiddleware(
  config: AgentGateHonoConfig,
): MiddlewareHandler<{ Variables: AgentGateVariables }> {
  const base = config.basePath ?? "";
  const protectedPrefixes = config.protectedPaths ?? ["/api"];
  const passthrough = config.passthrough ?? false;

  return async (c, next) => {
    const url = new URL(c.req.url);
    const pathname = url.pathname;
    const method = c.req.method;

    // Discovery.
    if (pathname === `${base}/.well-known/agentgate.json` && method === "GET") {
      const doc = buildDiscoveryDocument(config);
      return c.json(doc, 200, {
        "Cache-Control": "public, max-age=3600",
      });
    }

    // Register.
    if (pathname === `${base}/agentgate/register` && method === "POST") {
      return handleRegister(c, config);
    }

    // Verify.
    if (pathname === `${base}/agentgate/register/verify` && method === "POST") {
      return handleRegisterVerify(c, config);
    }

    // Auth.
    if (pathname === `${base}/agentgate/auth` && method === "POST") {
      return handleAuth(c, config);
    }

    // Auth guard for protected paths.
    const isProtected = protectedPrefixes.some((prefix) => pathname.startsWith(prefix));
    if (isProtected) {
      const authHeader = c.req.header("authorization");

      if (!authHeader) {
        if (passthrough) {
          c.set("agent", null);
          c.set("isAgent", false);
          await next();
          return;
        }
        return c.json({ error: "Authorization header required" }, 401);
      }

      const token = authHeader.replace(/^Bearer\s+/i, "");
      let matchedAgent: StoredAgent | undefined;

      for (const agent of registeredAgents.values()) {
        if (agent.apiKey === token) {
          matchedAgent = agent;
          break;
        }
      }

      if (!matchedAgent) {
        if (passthrough) {
          c.set("agent", null);
          c.set("isAgent", false);
          await next();
          return;
        }
        return c.json({ error: "Invalid or expired token" }, 401);
      }

      // Phase 3.8: Check reputation gates before granting access.
      const reputationResult = checkReputationGates(config);
      if (reputationResult && reputationResult.action === "block") {
        return c.json(
          {
            error: "Insufficient reputation",
            required: reputationResult.minReputation,
            current: 50,
          },
          403,
        );
      }

      // Phase 3.9: Check spending caps before granting access.
      const spendingResult = checkSpendingCap(config, matchedAgent.id);
      if (spendingResult) {
        return c.json(
          {
            error: "Spending cap exceeded",
            current_spend: spendingResult.currentSpend,
            cap: spendingResult.cap,
          },
          402,
        );
      }

      const agentContext: AgentContext = {
        id: matchedAgent.id,
        publicKey: matchedAgent.publicKey,
        scopes: matchedAgent.scopesGranted,
        rateLimit: config.rateLimit ?? { requests: 1000, window: "1h" },
        metadata: matchedAgent.metadata,
      };

      c.set("agent", agentContext);
      c.set("isAgent", true);

      await next();
      return;
    }

    // Non-protected, non-AgentGate routes.
    c.set("agent", null);
    c.set("isAgent", false);
    await next();
  };
}

// ---------------------------------------------------------------------------
// Route handler implementations
// ---------------------------------------------------------------------------

async function handleRegister(c: Context, config: AgentGateHonoConfig): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const publicKey = body.public_key as string | undefined;
  const scopesRequested = body.scopes_requested as string[] | undefined;
  const x402Wallet = body.x402_wallet as string | undefined;
  const metadata = (body.metadata as Record<string, string>) ?? {};

  if (!publicKey || typeof publicKey !== "string") {
    return c.json({ error: "public_key is required" }, 400);
  }

  if (!scopesRequested || !Array.isArray(scopesRequested) || scopesRequested.length === 0) {
    return c.json({ error: "scopes_requested must be a non-empty array" }, 400);
  }

  // Validate scopes.
  const availableScopeIds = new Set((config.scopes ?? []).map((s) => s.id));
  const invalidScopes = scopesRequested.filter((s) => !availableScopeIds.has(s));
  if (invalidScopes.length > 0) {
    return c.json({ error: `Invalid scopes: ${invalidScopes.join(", ")}` }, 400);
  }

  // Duplicate public key check.
  for (const agent of registeredAgents.values()) {
    if (agent.publicKey === publicKey) {
      return c.json(
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

  return c.json(
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
  c: Context,
  config: AgentGateHonoConfig,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const agentId = body.agent_id as string | undefined;
  const signature = body.signature as string | undefined;

  if (!agentId || !signature) {
    return c.json({ error: "agent_id and signature are required" }, 400);
  }

  const challenge = pendingChallenges.get(agentId);
  if (!challenge) {
    return c.json({ error: "Unknown agent_id or challenge not found" }, 404);
  }

  if (Date.now() > challenge.expiresAt) {
    pendingChallenges.delete(agentId);
    return c.json({ error: "Challenge expired" }, 410);
  }

  const valid = await verifyEd25519(challenge.message, signature, challenge.publicKey);
  if (!valid) {
    return c.json({ error: "Invalid signature" }, 400);
  }

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

  return c.json(responseBody, 200);
}

async function handleAuth(c: Context, config: AgentGateHonoConfig): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const agentId = body.agent_id as string | undefined;
  const signature = body.signature as string | undefined;
  const timestamp = body.timestamp as string | undefined;

  if (!agentId || !signature || !timestamp) {
    return c.json(
      { error: "agent_id, signature, and timestamp are required" },
      400,
    );
  }

  const agent = registeredAgents.get(agentId);
  if (!agent) {
    return c.json({ error: "Unknown agent_id" }, 404);
  }

  const message = `agentgate:auth:${agentId}:${timestamp}`;
  const valid = await verifyEd25519(message, signature, agent.publicKey);
  if (!valid) {
    return c.json({ error: "Invalid signature" }, 400);
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
      const agentRecord: Agent = {
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
      };
      await config.onAgentAuthenticated(agentRecord);
    } catch {
      // Callback errors are non-fatal.
    }
  }

  // Fire agent.authenticated webhook (fire-and-forget).
  fireWebhook(config, "agent.authenticated", {
    agent_id: agentId,
    method: "challenge",
  });

  return c.json({
    token,
    expires_at: expiresAt.toISOString(),
  });
}

export { buildDiscoveryDocument };
