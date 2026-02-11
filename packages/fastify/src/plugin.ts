import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type {
  AgentDoorConfig,
  AgentContext,
  ScopeDefinition,
  Agent,
} from "@agentdoor/core";

// ---------------------------------------------------------------------------
// Fastify type augmentation
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyRequest {
    agent: AgentContext | null;
    isAgent: boolean;
  }
}

// ---------------------------------------------------------------------------
// In-memory stores (same pattern as hono/next adapters)
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
// Crypto helpers (Web Crypto API)
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
// JSON schemas for Fastify request validation
// ---------------------------------------------------------------------------

const registerSchema = {
  body: {
    type: "object" as const,
    required: ["public_key", "scopes_requested"],
    properties: {
      public_key: { type: "string" as const },
      scopes_requested: { type: "array" as const, items: { type: "string" as const }, minItems: 1 },
      x402_wallet: { type: "string" as const },
      metadata: { type: "object" as const, additionalProperties: { type: "string" as const } },
    },
  },
};

const verifySchema = {
  body: {
    type: "object" as const,
    required: ["agent_id", "signature"],
    properties: {
      agent_id: { type: "string" as const },
      signature: { type: "string" as const },
    },
  },
};

const authSchema = {
  body: {
    type: "object" as const,
    required: ["agent_id", "signature", "timestamp"],
    properties: {
      agent_id: { type: "string" as const },
      signature: { type: "string" as const },
      timestamp: { type: "string" as const },
    },
  },
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AgentDoorFastifyConfig extends AgentDoorConfig {
  /**
   * Path prefix patterns that require agent auth verification.
   * Defaults to `["/api"]`.
   */
  protectedPaths?: string[];

  /**
   * When true, unauthenticated requests to protected paths pass through
   * with `request.isAgent` set to `false`. When false (default),
   * unauthenticated requests receive a 401 JSON response.
   */
  passthrough?: boolean;

  /**
   * Base path prefix for AgentDoor routes. Defaults to empty string.
   * Set to e.g. "/v1" to mount routes at "/v1/agentdoor/register" etc.
   */
  basePath?: string;
}

// ---------------------------------------------------------------------------
// Fastify plugin
// ---------------------------------------------------------------------------

/**
 * AgentDoor Fastify plugin. Registers all AgentDoor routes and an onRequest
 * hook for auth guard on protected paths. Decorates requests with `agent`
 * and `isAgent`.
 *
 * ```ts
 * import Fastify from "fastify";
 * import { agentdoorPlugin } from "@agentdoor/fastify";
 *
 * const app = Fastify();
 * app.register(agentdoorPlugin, {
 *   scopes: [{ id: "data.read", description: "Read data" }],
 * });
 * ```
 */
async function agentdoorPluginFn(
  fastify: FastifyInstance,
  config: AgentDoorFastifyConfig,
): Promise<void> {
  const base = config.basePath ?? "";
  const protectedPrefixes = config.protectedPaths ?? ["/api"];
  const passthrough = config.passthrough ?? false;

  // Decorate request with agent context.
  fastify.decorateRequest("agent", null);
  fastify.decorateRequest("isAgent", false);

  // ---- Discovery endpoint ----
  fastify.get(`${base}/.well-known/agentdoor.json`, async (_request, reply) => {
    const doc = buildDiscoveryDocument(config);
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.status(200).send(doc);
  });

  // ---- Registration endpoint ----
  fastify.post(`${base}/agentdoor/register`, { schema: registerSchema }, async (request, reply) => {
    return handleRegister(request, reply, config);
  });

  // ---- Registration verification endpoint ----
  fastify.post(`${base}/agentdoor/register/verify`, { schema: verifySchema }, async (request, reply) => {
    return handleRegisterVerify(request, reply, config);
  });

  // ---- Auth endpoint ----
  fastify.post(`${base}/agentdoor/auth`, { schema: authSchema }, async (request, reply) => {
    return handleAuth(request, reply);
  });

  // ---- Auth guard onRequest hook ----
  fastify.addHook("onRequest", async (request, reply) => {
    const pathname = new URL(request.url, `http://${request.hostname || "localhost"}`).pathname;

    // Skip AgentDoor endpoints themselves.
    if (
      pathname === `${base}/.well-known/agentdoor.json` ||
      pathname === `${base}/agentdoor/register` ||
      pathname === `${base}/agentdoor/register/verify` ||
      pathname === `${base}/agentdoor/auth`
    ) {
      request.agent = null;
      request.isAgent = false;
      return;
    }

    const isProtected = protectedPrefixes.some((prefix) => pathname.startsWith(prefix));

    if (!isProtected) {
      request.agent = null;
      request.isAgent = false;
      return;
    }

    const authHeader = request.headers.authorization;

    if (!authHeader) {
      if (passthrough) {
        request.agent = null;
        request.isAgent = false;
        return;
      }
      return reply.status(401).send({ error: "Authorization header required" });
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
        request.agent = null;
        request.isAgent = false;
        return;
      }
      return reply.status(401).send({ error: "Invalid or expired token" });
    }

    const agentContext: AgentContext = {
      id: matchedAgent.id,
      publicKey: matchedAgent.publicKey,
      scopes: matchedAgent.scopesGranted,
      rateLimit: config.rateLimit ?? { requests: 1000, window: "1h" },
      metadata: matchedAgent.metadata,
    };

    request.agent = agentContext;
    request.isAgent = true;
  });
}

// ---------------------------------------------------------------------------
// Route handler implementations
// ---------------------------------------------------------------------------

async function handleRegister(
  request: FastifyRequest,
  reply: FastifyReply,
  config: AgentDoorFastifyConfig,
): Promise<void> {
  const body = request.body as Record<string, unknown>;

  const publicKey = body.public_key as string;
  const scopesRequested = body.scopes_requested as string[];
  const x402Wallet = body.x402_wallet as string | undefined;
  const metadata = (body.metadata as Record<string, string>) ?? {};

  // Validate scopes.
  const availableScopeIds = new Set((config.scopes ?? []).map((s) => s.id));
  const invalidScopes = scopesRequested.filter((s) => !availableScopeIds.has(s));
  if (invalidScopes.length > 0) {
    return reply.status(400).send({ error: `Invalid scopes: ${invalidScopes.join(", ")}` });
  }

  // Duplicate public key check.
  for (const agent of registeredAgents.values()) {
    if (agent.publicKey === publicKey) {
      return reply.status(409).send({
        error: "Public key already registered",
        agent_id: agent.id,
      });
    }
  }

  const agentId = generateId("ag_");
  const nonce = generateNonce();
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `agentdoor:register:${agentId}:${timestamp}:${nonce}`;
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

  return reply.status(201).send({
    agent_id: agentId,
    challenge: {
      nonce,
      message,
      expires_at: new Date(expiresAt).toISOString(),
    },
  });
}

async function handleRegisterVerify(
  request: FastifyRequest,
  reply: FastifyReply,
  config: AgentDoorFastifyConfig,
): Promise<void> {
  const body = request.body as Record<string, unknown>;

  const agentId = body.agent_id as string;
  const signature = body.signature as string;

  const challenge = pendingChallenges.get(agentId);
  if (!challenge) {
    return reply.status(404).send({ error: "Unknown agent_id or challenge not found" });
  }

  if (Date.now() > challenge.expiresAt) {
    pendingChallenges.delete(agentId);
    return reply.status(410).send({ error: "Challenge expired" });
  }

  const valid = await verifyEd25519(challenge.message, signature, challenge.publicKey);
  if (!valid) {
    return reply.status(400).send({ error: "Invalid signature" });
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

  return reply.status(200).send(responseBody);
}

async function handleAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = request.body as Record<string, unknown>;

  const agentId = body.agent_id as string;
  const signature = body.signature as string;
  const timestamp = body.timestamp as string;

  const agent = registeredAgents.get(agentId);
  if (!agent) {
    return reply.status(404).send({ error: "Unknown agent_id" });
  }

  const message = `agentdoor:auth:${agentId}:${timestamp}`;
  const valid = await verifyEd25519(message, signature, agent.publicKey);
  if (!valid) {
    return reply.status(400).send({ error: "Invalid signature" });
  }

  const token = `agt_${generateId("")}`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  return reply.status(200).send({
    token,
    expires_at: expiresAt.toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Export as fastify-plugin compatible (plugin metadata)
// ---------------------------------------------------------------------------

// Attach fastify-plugin metadata so Fastify does not encapsulate the plugin.
// This allows decorators and hooks to be visible to sibling routes.
(agentdoorPluginFn as any)[Symbol.for("skip-override")] = true;
(agentdoorPluginFn as any)[Symbol.for("fastify.display-name")] = "agentdoor";

export const agentdoorPlugin = agentdoorPluginFn;
