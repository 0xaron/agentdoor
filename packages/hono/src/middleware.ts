import type { Context, MiddlewareHandler, Hono } from "hono";
import type {
  AgentDoorConfig,
  AgentContext,
  ScopeDefinition,
  Agent,
  AgentStore,
  ChallengeData,
  WebhooksConfig,
  ReputationConfig,
} from "@agentdoor/core";
import { MemoryStore, WebhookEmitter, ReputationManager } from "@agentdoor/core";

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
    iss: "agentdoor",
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
// Reputation gate check — now uses core ReputationManager
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Spending cap check (still in-memory for edge runtime)
// ---------------------------------------------------------------------------

/** Per-agent spending tracker (request count). */
const agentSpending = new Map<string, number>();

/**
 * Check whether an agent has exceeded any configured spending cap.
 */
function checkSpendingCap(
  config: AgentDoorHonoConfig,
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

function buildDiscoveryDocument(config: AgentDoorConfig): Record<string, unknown> {
  return {
    agentdoor_version: "1.0",
    service_name: config.service?.name ?? "AgentDoor Service",
    service_description: config.service?.description ?? "",
    registration_endpoint: "/agentdoor/register",
    auth_endpoint: "/agentdoor/auth",
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
 * Variables that AgentDoor middleware sets on the Hono context.
 * Consumers can declare these in their app type:
 *
 * ```ts
 * type Env = { Variables: AgentDoorVariables };
 * const app = new Hono<Env>();
 * ```
 */
export interface AgentDoorVariables {
  agent: AgentContext | null;
  isAgent: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AgentDoorHonoConfig extends AgentDoorConfig {
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
   * Base path prefix for AgentDoor routes. Defaults to empty string.
   * Set to e.g. "/v1" to mount routes at "/v1/agentdoor/register" etc.
   */
  basePath?: string;

  /**
   * Custom agent store implementation. If not provided, an in-memory
   * store is created automatically (suitable for development and testing).
   *
   * For production, supply a persistent store (SQLite, Postgres, etc.)
   * from @agentdoor/core.
   */
  store?: AgentStore;
}

// ---------------------------------------------------------------------------
// Route mounting helper
// ---------------------------------------------------------------------------

/**
 * Mount all AgentDoor routes onto a Hono app instance. This registers the
 * discovery, register, verify, and auth endpoints as explicit routes, plus
 * an auth guard middleware for protected paths.
 *
 * ```ts
 * import { Hono } from "hono";
 * import { agentdoor } from "@agentdoor/hono";
 *
 * const app = new Hono();
 *
 * agentdoor(app, {
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
export function agentdoor(app: Hono<{ Variables: AgentDoorVariables }>, config: AgentDoorHonoConfig): void {
  const base = config.basePath ?? "";
  const store: AgentStore = config.store ?? new MemoryStore();
  const webhookEmitter = new WebhookEmitter(config.webhooks as WebhooksConfig | undefined);
  const reputationManager = new ReputationManager(config.reputation as ReputationConfig | undefined);

  // Discovery endpoint.
  app.get(`${base}/.well-known/agentdoor.json`, (c: Context) => {
    const doc = buildDiscoveryDocument(config);
    return c.json(doc, 200, {
      "Cache-Control": "public, max-age=3600",
    });
  });

  // Registration endpoint.
  app.post(`${base}/agentdoor/register`, async (c: Context) => {
    return handleRegister(c, config, store);
  });

  // Registration verification endpoint.
  app.post(`${base}/agentdoor/register/verify`, async (c: Context) => {
    return handleRegisterVerify(c, config, store, webhookEmitter);
  });

  // Auth endpoint (returning agents).
  app.post(`${base}/agentdoor/auth`, async (c: Context) => {
    return handleAuth(c, config, store, webhookEmitter);
  });

  // Auth guard middleware for protected paths.
  app.use("*", createAuthGuardMiddleware(config, store, reputationManager));
}

// ---------------------------------------------------------------------------
// Standalone middleware factories
// ---------------------------------------------------------------------------

/**
 * Create a Hono middleware that only mounts the auth guard on protected paths.
 * Useful when you want to mount AgentDoor routes manually but still get
 * automatic auth verification.
 */
export function createAuthGuardMiddleware(
  config: AgentDoorHonoConfig,
  storeOverride?: AgentStore,
  reputationManagerOverride?: ReputationManager,
): MiddlewareHandler<{ Variables: AgentDoorVariables }> {
  const protectedPrefixes = config.protectedPaths ?? ["/api"];
  const passthrough = config.passthrough ?? false;
  const store: AgentStore = storeOverride ?? config.store ?? new MemoryStore();
  const repMgr = reputationManagerOverride ?? new ReputationManager(config.reputation as ReputationConfig | undefined);

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

    // Look up agent by API key hash via store.
    const apiKeyHash = await sha256(token);
    const matchedAgent = await store.getAgentByApiKeyHash(apiKeyHash);

    if (!matchedAgent) {
      if (passthrough) {
        c.set("agent", null);
        c.set("isAgent", false);
        await next();
        return;
      }
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    // Check reputation gates using the core ReputationManager.
    const reputationResult = repMgr.checkGate(matchedAgent.reputation ?? 50);
    if (!reputationResult.allowed) {
      if (reputationResult.action === "block") {
        // Update reputation for the failed request
        const newScore = repMgr.calculateScore(matchedAgent.reputation ?? 50, "request_error");
        store.updateAgent(matchedAgent.id, { reputation: newScore }).catch(() => {});

        return c.json(
          {
            error: "Insufficient reputation",
            required: reputationResult.requiredScore,
            current: reputationResult.currentScore,
          },
          403,
        );
      }
    }

    // Check spending caps before granting access.
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

    // Update reputation for successful request and increment request count
    const newScore = repMgr.calculateScore(matchedAgent.reputation ?? 50, "request_success");
    await store.updateAgent(matchedAgent.id, { reputation: newScore, incrementRequests: 1 }).catch(() => {});

    const agentContext: AgentContext = {
      id: matchedAgent.id,
      publicKey: matchedAgent.publicKey,
      scopes: matchedAgent.scopesGranted,
      rateLimit: config.rateLimit ?? { requests: 1000, window: "1h" },
      metadata: matchedAgent.metadata,
    };

    c.set("agent", agentContext);
    c.set("isAgent", true);

    // Add reputation warning header if gate returned a "warn" action
    if (reputationResult.action === "warn") {
      c.header("x-agentdoor-reputation-warning", `score=${reputationResult.currentScore},required=${reputationResult.requiredScore}`);
    }

    await next();
  };
}

/**
 * Create a standalone Hono middleware that handles all AgentDoor routes
 * and auth guard in a single middleware function. Alternative to `agentdoor()`
 * for more control over middleware ordering.
 *
 * ```ts
 * import { Hono } from "hono";
 * import { createAgentDoorMiddleware } from "@agentdoor/hono";
 *
 * const app = new Hono();
 * app.use("*", createAgentDoorMiddleware({
 *   scopes: [{ id: "data.read", description: "Read data" }],
 * }));
 * ```
 */
export function createAgentDoorMiddleware(
  config: AgentDoorHonoConfig,
): MiddlewareHandler<{ Variables: AgentDoorVariables }> {
  const base = config.basePath ?? "";
  const protectedPrefixes = config.protectedPaths ?? ["/api"];
  const passthrough = config.passthrough ?? false;
  const store: AgentStore = config.store ?? new MemoryStore();
  const webhookEmitter = new WebhookEmitter(config.webhooks as WebhooksConfig | undefined);
  const repMgr = new ReputationManager(config.reputation as ReputationConfig | undefined);

  // Periodically clean expired challenges (every 5 minutes)
  let lastCleanup = Date.now();
  const CLEANUP_INTERVAL = 5 * 60 * 1000;

  return async (c, next) => {
    const url = new URL(c.req.url);
    const pathname = url.pathname;
    const method = c.req.method;

    // TTL-based cleanup: clean expired challenges periodically
    if (Date.now() - lastCleanup > CLEANUP_INTERVAL) {
      lastCleanup = Date.now();
      store.cleanExpiredChallenges().catch(() => {});
    }

    // Discovery.
    if (pathname === `${base}/.well-known/agentdoor.json` && method === "GET") {
      const doc = buildDiscoveryDocument(config);
      return c.json(doc, 200, {
        "Cache-Control": "public, max-age=3600",
      });
    }

    // Register.
    if (pathname === `${base}/agentdoor/register` && method === "POST") {
      return handleRegister(c, config, store);
    }

    // Verify.
    if (pathname === `${base}/agentdoor/register/verify` && method === "POST") {
      return handleRegisterVerify(c, config, store, webhookEmitter);
    }

    // Auth.
    if (pathname === `${base}/agentdoor/auth` && method === "POST") {
      return handleAuth(c, config, store, webhookEmitter);
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

      // Look up agent by API key hash via store.
      const apiKeyHash = await sha256(token);
      const matchedAgent = await store.getAgentByApiKeyHash(apiKeyHash);

      if (!matchedAgent) {
        if (passthrough) {
          c.set("agent", null);
          c.set("isAgent", false);
          await next();
          return;
        }
        return c.json({ error: "Invalid or expired token" }, 401);
      }

      // Check reputation gates using the core ReputationManager.
      const reputationResult = repMgr.checkGate(matchedAgent.reputation ?? 50);
      if (!reputationResult.allowed) {
        if (reputationResult.action === "block") {
          // Update reputation for the failed request
          const newScore = repMgr.calculateScore(matchedAgent.reputation ?? 50, "request_error");
          store.updateAgent(matchedAgent.id, { reputation: newScore }).catch(() => {});

          return c.json(
            {
              error: "Insufficient reputation",
              required: reputationResult.requiredScore,
              current: reputationResult.currentScore,
            },
            403,
          );
        }
      }

      // Check spending caps before granting access.
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

      // Update reputation for successful request and increment request count
      const newScore = repMgr.calculateScore(matchedAgent.reputation ?? 50, "request_success");
      await store.updateAgent(matchedAgent.id, { reputation: newScore, incrementRequests: 1 }).catch(() => {});

      const agentContext: AgentContext = {
        id: matchedAgent.id,
        publicKey: matchedAgent.publicKey,
        scopes: matchedAgent.scopesGranted,
        rateLimit: config.rateLimit ?? { requests: 1000, window: "1h" },
        metadata: matchedAgent.metadata,
      };

      c.set("agent", agentContext);
      c.set("isAgent", true);

      // Add reputation warning header if gate returned a "warn" action
      if (reputationResult.action === "warn") {
        c.header("x-agentdoor-reputation-warning", `score=${reputationResult.currentScore},required=${reputationResult.requiredScore}`);
      }

      await next();
      return;
    }

    // Non-protected, non-AgentDoor routes.
    c.set("agent", null);
    c.set("isAgent", false);
    await next();
  };
}

// ---------------------------------------------------------------------------
// Route handler implementations
// ---------------------------------------------------------------------------

async function handleRegister(c: Context, config: AgentDoorHonoConfig, store: AgentStore): Promise<Response> {
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

  // Duplicate public key check via store.
  const existingAgent = await store.getAgentByPublicKey(publicKey);
  if (existingAgent) {
    return c.json(
      { error: "Public key already registered", agent_id: existingAgent.id },
      409,
    );
  }

  const agentId = generateId("ag_");
  const nonce = generateNonce();
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `agentdoor:register:${agentId}:${timestamp}:${nonce}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  // Persist challenge to AgentStore
  const challengeData: ChallengeData = {
    agentId,
    nonce,
    message,
    expiresAt,
    createdAt: new Date(),
    pendingRegistration: {
      publicKey,
      scopesRequested,
      x402Wallet,
      metadata,
    },
  };
  await store.createChallenge(challengeData);

  return c.json(
    {
      agent_id: agentId,
      challenge: {
        nonce,
        message,
        expires_at: expiresAt.toISOString(),
      },
    },
    201,
  );
}

async function handleRegisterVerify(
  c: Context,
  config: AgentDoorHonoConfig,
  store: AgentStore,
  webhookEmitter: WebhookEmitter,
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

  // Retrieve challenge from store
  const challenge = await store.getChallenge(agentId);
  if (!challenge) {
    return c.json({ error: "Unknown agent_id or challenge not found" }, 404);
  }

  if (Date.now() > challenge.expiresAt.getTime()) {
    await store.deleteChallenge(agentId);
    return c.json({ error: "Challenge expired" }, 410);
  }

  const pending = challenge.pendingRegistration;
  if (!pending) {
    return c.json({ error: "Challenge missing registration data" }, 400);
  }

  const valid = await verifyEd25519(challenge.message, signature, pending.publicKey);
  if (!valid) {
    return c.json({ error: "Invalid signature" }, 400);
  }

  const apiKey = `agk_live_${generateId("")}`;
  const apiKeyHash = await sha256(apiKey);

  // Persist agent to store
  await store.createAgent({
    id: agentId,
    publicKey: pending.publicKey,
    apiKeyHash,
    scopesGranted: pending.scopesRequested,
    x402Wallet: pending.x402Wallet,
    metadata: pending.metadata,
    rateLimit: config.rateLimit ?? { requests: 1000, window: "1h" },
  });

  await store.deleteChallenge(agentId);

  // Fire callback.
  if (config.onAgentRegistered) {
    try {
      const agentRecord: Agent = {
        id: agentId,
        publicKey: pending.publicKey,
        scopesGranted: pending.scopesRequested,
        x402Wallet: pending.x402Wallet,
        metadata: pending.metadata,
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

  // Fire agent.registered webhook via core WebhookEmitter (with HMAC + retry).
  webhookEmitter.emit("agent.registered", {
    agent_id: agentId,
    public_key: pending.publicKey,
    scopes_granted: pending.scopesRequested,
    metadata: pending.metadata,
  }).catch(() => {});

  // Issue a JWT token for immediate use.
  const jwtSecret = config.jwt?.secret ?? "agentdoor-edge-default-secret";
  const jwtExpiresIn = config.jwt?.expiresIn ?? "1h";
  const agentCtx: AgentContext = {
    id: agentId,
    publicKey: pending.publicKey,
    scopes: pending.scopesRequested,
    rateLimit: config.rateLimit ?? { requests: 1000, window: "1h" },
    metadata: pending.metadata,
  };
  const token = await issueJwt(agentCtx, jwtSecret, jwtExpiresIn);
  const tokenExpiresAt = computeJwtExpiration(jwtExpiresIn);

  const responseBody: Record<string, unknown> = {
    agent_id: agentId,
    api_key: apiKey,
    scopes_granted: pending.scopesRequested,
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

async function handleAuth(c: Context, config: AgentDoorHonoConfig, store: AgentStore, webhookEmitter: WebhookEmitter): Promise<Response> {
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

  // Look up agent from store
  const agent = await store.getAgent(agentId);
  if (!agent) {
    return c.json({ error: "Unknown agent_id" }, 404);
  }

  const message = `agentdoor:auth:${agentId}:${timestamp}`;
  const valid = await verifyEd25519(message, signature, agent.publicKey);
  if (!valid) {
    return c.json({ error: "Invalid signature" }, 400);
  }

  // Issue a JWT token.
  const jwtSecret = config.jwt?.secret ?? "agentdoor-edge-default-secret";
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

  // Update last auth timestamp
  await store.updateAgent(agentId, { lastAuthAt: new Date() }).catch(() => {});

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
        reputation: agent.reputation,
        status: agent.status,
        createdAt: agent.createdAt,
        lastAuthAt: new Date(),
        totalRequests: agent.totalRequests,
        totalX402Paid: agent.totalX402Paid,
      };
      await config.onAgentAuthenticated(agentRecord);
    } catch {
      // Callback errors are non-fatal.
    }
  }

  // Fire agent.authenticated webhook via core WebhookEmitter (with HMAC + retry).
  webhookEmitter.emit("agent.authenticated", {
    agent_id: agentId,
    method: "challenge",
  }).catch(() => {});

  return c.json({
    token,
    expires_at: expiresAt.toISOString(),
  });
}

export { buildDiscoveryDocument };
