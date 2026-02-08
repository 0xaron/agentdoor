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
    return handleAuth(c);
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
      return handleAuth(c);
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

  return c.json(responseBody, 200);
}

async function handleAuth(c: Context): Promise<Response> {
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

  const token = `agt_${generateId("")}`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  return c.json({
    token,
    expires_at: expiresAt.toISOString(),
  });
}

export { buildDiscoveryDocument };
