import type {
  AgentGateConfig,
  AgentContext,
  ScopeDefinition,
  Agent,
} from "@agentgate/core";

// ---------------------------------------------------------------------------
// Cloudflare environment bindings
// ---------------------------------------------------------------------------

/**
 * Cloudflare Workers environment bindings for AgentGate.
 * When using Durable Objects, bind the AgentGateDurableObject in wrangler.toml:
 *
 * ```toml
 * [durable_objects]
 * bindings = [
 *   { name = "AGENTGATE_DO", class_name = "AgentGateDurableObject" }
 * ]
 * ```
 */
export interface CloudflareEnv {
  AGENTGATE_DO?: {
    idFromName(name: string): { toString(): string };
    get(id: { toString(): string }): {
      fetch(request: Request): Promise<Response>;
    };
  };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// In-memory stores (fallback when Durable Objects not available)
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
// Crypto helpers (Web Crypto API — Cloudflare Workers runtime)
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

export interface AgentGateCloudflareConfig extends AgentGateConfig {
  /**
   * Path prefix patterns that require agent auth verification.
   * Defaults to `["/api/"]`.
   */
  protectedPaths?: string[];

  /**
   * When `true`, unauthenticated requests to protected paths pass through
   * with an `x-agentgate-authenticated: false` header.
   * When `false` (default), unauthenticated requests receive a 401.
   */
  passthrough?: boolean;

  /**
   * When `true`, delegate agent storage to the AgentGateDurableObject
   * (requires AGENTGATE_DO binding in the environment).
   * When `false` (default), use in-memory Maps.
   */
  useDurableObjects?: boolean;
}

// ---------------------------------------------------------------------------
// Durable Object for persistent agent state
// ---------------------------------------------------------------------------

/**
 * Durable Object class for persisting agent registrations across Worker
 * invocations. Bind in wrangler.toml:
 *
 * ```toml
 * [durable_objects]
 * bindings = [
 *   { name = "AGENTGATE_DO", class_name = "AgentGateDurableObject" }
 * ]
 *
 * [[migrations]]
 * tag = "v1"
 * new_classes = ["AgentGateDurableObject"]
 * ```
 */
export class AgentGateDurableObject {
  private agents: Map<string, StoredAgent> = new Map();
  private challenges: Map<string, PendingChallenge> = new Map();
  private state: {
    storage: {
      get(key: string): Promise<unknown>;
      put(key: string, value: unknown): Promise<void>;
      delete(key: string): Promise<boolean>;
      list(options?: { prefix?: string }): Promise<Map<string, unknown>>;
    };
  };

  constructor(state: typeof AgentGateDurableObject.prototype.state) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Internal API for the Worker to delegate storage operations.
    if (pathname === "/do/agent/get") {
      const { id } = (await request.json()) as { id: string };
      const agent = await this.getAgent(id);
      return jsonResponse(agent ?? null, agent ? 200 : 404);
    }

    if (pathname === "/do/agent/set") {
      const { id, agent } = (await request.json()) as { id: string; agent: StoredAgent };
      await this.setAgent(id, agent);
      return jsonResponse({ ok: true }, 200);
    }

    if (pathname === "/do/agent/find-by-key") {
      const { apiKey } = (await request.json()) as { apiKey: string };
      const agent = await this.findAgentByKey(apiKey);
      return jsonResponse(agent ?? null, agent ? 200 : 404);
    }

    if (pathname === "/do/agent/find-by-pubkey") {
      const { publicKey } = (await request.json()) as { publicKey: string };
      const agent = await this.findAgentByPublicKey(publicKey);
      return jsonResponse(agent ?? null, agent ? 200 : 404);
    }

    if (pathname === "/do/challenge/get") {
      const { id } = (await request.json()) as { id: string };
      const challenge = await this.getChallenge(id);
      return jsonResponse(challenge ?? null, challenge ? 200 : 404);
    }

    if (pathname === "/do/challenge/set") {
      const { id, challenge } = (await request.json()) as { id: string; challenge: PendingChallenge };
      await this.setChallenge(id, challenge);
      return jsonResponse({ ok: true }, 200);
    }

    if (pathname === "/do/challenge/delete") {
      const { id } = (await request.json()) as { id: string };
      await this.deleteChallenge(id);
      return jsonResponse({ ok: true }, 200);
    }

    return jsonResponse({ error: "Not found" }, 404);
  }

  private async getAgent(id: string): Promise<StoredAgent | undefined> {
    // Check in-memory first, then persistent storage.
    if (this.agents.has(id)) return this.agents.get(id);
    const stored = (await this.state.storage.get(`agent:${id}`)) as StoredAgent | undefined;
    if (stored) this.agents.set(id, stored);
    return stored;
  }

  private async setAgent(id: string, agent: StoredAgent): Promise<void> {
    this.agents.set(id, agent);
    await this.state.storage.put(`agent:${id}`, agent);
  }

  private async findAgentByKey(apiKey: string): Promise<StoredAgent | undefined> {
    // Search in-memory agents.
    for (const agent of this.agents.values()) {
      if (agent.apiKey === apiKey) return agent;
    }
    // Search persistent storage.
    const entries = await this.state.storage.list({ prefix: "agent:" });
    for (const [, value] of entries) {
      const agent = value as StoredAgent;
      if (agent.apiKey === apiKey) {
        this.agents.set(agent.id, agent);
        return agent;
      }
    }
    return undefined;
  }

  private async findAgentByPublicKey(publicKey: string): Promise<StoredAgent | undefined> {
    for (const agent of this.agents.values()) {
      if (agent.publicKey === publicKey) return agent;
    }
    const entries = await this.state.storage.list({ prefix: "agent:" });
    for (const [, value] of entries) {
      const agent = value as StoredAgent;
      if (agent.publicKey === publicKey) {
        this.agents.set(agent.id, agent);
        return agent;
      }
    }
    return undefined;
  }

  private async getChallenge(id: string): Promise<PendingChallenge | undefined> {
    if (this.challenges.has(id)) return this.challenges.get(id);
    const stored = (await this.state.storage.get(`challenge:${id}`)) as PendingChallenge | undefined;
    if (stored) this.challenges.set(id, stored);
    return stored;
  }

  private async setChallenge(id: string, challenge: PendingChallenge): Promise<void> {
    this.challenges.set(id, challenge);
    await this.state.storage.put(`challenge:${id}`, challenge);
  }

  private async deleteChallenge(id: string): Promise<void> {
    this.challenges.delete(id);
    await this.state.storage.delete(`challenge:${id}`);
  }
}

// ---------------------------------------------------------------------------
// Worker fetch handler factory
// ---------------------------------------------------------------------------

/**
 * Create a standalone Cloudflare Workers fetch handler that handles all
 * AgentGate routes. Uses in-memory Maps for state.
 *
 * ```ts
 * import { createAgentGateWorker } from "@agentgate/cloudflare";
 *
 * export default {
 *   fetch: createAgentGateWorker({
 *     scopes: [{ id: "data.read", description: "Read data" }],
 *   }),
 * };
 * ```
 */
export function createAgentGateWorker(
  config: AgentGateCloudflareConfig,
): (request: Request, env?: CloudflareEnv) => Promise<Response> {
  return (request: Request, env?: CloudflareEnv) => handleRequest(request, env ?? {}, config);
}

// ---------------------------------------------------------------------------
// Main request handler
// ---------------------------------------------------------------------------

/**
 * Handle an incoming request in a Cloudflare Worker. This is the primary
 * entry point that routes to discovery, register, verify, auth, or auth
 * guard handlers.
 */
export async function handleRequest(
  request: Request,
  env: CloudflareEnv,
  config: AgentGateCloudflareConfig,
): Promise<Response> {
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
    return handleRegister(request, env, config);
  }

  // ---- Registration verify ----
  if (pathname === "/agentgate/register/verify" && method === "POST") {
    return handleRegisterVerify(request, env, config);
  }

  // ---- Auth (returning agents) ----
  if (pathname === "/agentgate/auth" && method === "POST") {
    return handleAuth(request, env, config);
  }

  // ---- Auth guard for protected routes ----
  const protectedPrefixes = config.protectedPaths ?? ["/api/"];
  const isProtected = protectedPrefixes.some((prefix) => pathname.startsWith(prefix));
  if (isProtected) {
    return handleAuthGuard(request, env, config);
  }

  // Non-AgentGate routes — return 404 (in a real worker, you would call
  // the origin or return your own response here).
  return jsonResponse({ error: "Not found" }, 404);
}

// ---------------------------------------------------------------------------
// Route handler implementations
// ---------------------------------------------------------------------------

async function handleRegister(
  request: Request,
  _env: CloudflareEnv,
  config: AgentGateCloudflareConfig,
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

  // Validate requested scopes.
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
  _env: CloudflareEnv,
  config: AgentGateCloudflareConfig,
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

async function handleAuth(
  request: Request,
  _env: CloudflareEnv,
  config: AgentGateCloudflareConfig,
): Promise<Response> {
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

  // Fire callback.
  if (config.onAgentAuthenticated) {
    try {
      const agentRecord: Agent = {
        id: agent.id,
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
      // Non-fatal.
    }
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
  _env: CloudflareEnv,
  config: AgentGateCloudflareConfig,
): Promise<Response> {
  const passthrough = config.passthrough ?? false;
  const authHeader = request.headers.get("authorization");

  if (!authHeader) {
    if (passthrough) {
      return passthroughResponse();
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
      return passthroughResponse();
    }
    return jsonResponse({ error: "Invalid or expired token" }, 401);
  }

  // Build agent context.
  const agentContext: AgentContext = {
    id: matchedAgent.id,
    publicKey: matchedAgent.publicKey,
    scopes: matchedAgent.scopesGranted,
    rateLimit: config.rateLimit ?? { requests: 1000, window: "1h" },
    metadata: matchedAgent.metadata,
  };

  // Return a response with agent context injected as headers.
  return new Response(null, {
    status: 200,
    headers: {
      "x-agentgate-agent": JSON.stringify(agentContext),
      "x-agentgate-authenticated": "true",
      "x-agentgate-agent-id": matchedAgent.id,
    },
  });
}

function passthroughResponse(): Response {
  return new Response(null, {
    status: 200,
    headers: {
      "x-agentgate-authenticated": "false",
    },
  });
}
