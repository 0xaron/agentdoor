import type {
  AgentGateConfig,
  ScopeDefinition,
} from "@agentgate/core";

/**
 * Next.js App Router route handlers for AgentGate endpoints.
 *
 * Usage in `app/.well-known/agentgate.json/route.ts`:
 * ```ts
 * import { createRouteHandlers } from "@agentgate/next/route-handlers";
 * import config from "../../../agentgate.config";
 *
 * const { GET, POST } = createRouteHandlers(config);
 * export { GET, POST };
 * ```
 *
 * Or mount individual endpoints:
 *
 * `app/agentgate/register/route.ts`:
 * ```ts
 * export { POST } from "./handlers";
 * ```
 */

// ---------------------------------------------------------------------------
// Lightweight in-memory state (same pattern as middleware.ts but for
// App Router route handlers which run in a different execution context).
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

const agents = new Map<string, StoredAgent>();
const challenges = new Map<string, PendingChallenge>();

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
// Discovery document
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
// App Router handler types (minimal to avoid importing `next` at type level)
// ---------------------------------------------------------------------------

interface RouteRequest {
  method: string;
  json(): Promise<unknown>;
  headers: Headers;
  url: string;
}

type RouteHandler = (request: RouteRequest) => Promise<Response> | Response;

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------

export interface RouteHandlers {
  /** GET handler for `/.well-known/agentgate.json` */
  GET: RouteHandler;
  /** POST handler for `/agentgate/register`, `/agentgate/register/verify`, and `/agentgate/auth` */
  POST: RouteHandler;
}

/**
 * Create App Router–compatible route handlers for all AgentGate endpoints.
 *
 * The returned `GET` handler serves the discovery document.
 * The returned `POST` handler dispatches to register, verify, or auth based
 * on the request URL pathname.
 */
export function createRouteHandlers(config: AgentGateConfig): RouteHandlers {
  const GET: RouteHandler = () => {
    const document = buildDiscoveryDocument(config);
    return new Response(JSON.stringify(document), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    });
  };

  const POST: RouteHandler = async (request: RouteRequest) => {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/agentgate/register") {
      return handleRegister(request, config);
    }

    if (pathname === "/agentgate/register/verify") {
      return handleRegisterVerify(request, config);
    }

    if (pathname === "/agentgate/auth") {
      return handleAuth(request);
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { GET, POST };
}

// ---------------------------------------------------------------------------
// Individual route handler factories for fine-grained mounting
// ---------------------------------------------------------------------------

/**
 * Create a GET handler specifically for the discovery endpoint.
 * Use in `app/.well-known/agentgate.json/route.ts`.
 */
export function createDiscoveryHandler(config: AgentGateConfig): RouteHandler {
  return () => {
    const document = buildDiscoveryDocument(config);
    return new Response(JSON.stringify(document), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    });
  };
}

/**
 * Create a POST handler for agent registration.
 * Use in `app/agentgate/register/route.ts`.
 */
export function createRegisterHandler(
  config: AgentGateConfig,
): RouteHandler {
  return (request: RouteRequest) => handleRegister(request, config);
}

/**
 * Create a POST handler for registration verification.
 * Use in `app/agentgate/register/verify/route.ts`.
 */
export function createVerifyHandler(
  config: AgentGateConfig,
): RouteHandler {
  return (request: RouteRequest) => handleRegisterVerify(request, config);
}

/**
 * Create a POST handler for returning agent authentication.
 * Use in `app/agentgate/auth/route.ts`.
 */
export function createAuthHandler(): RouteHandler {
  return (request: RouteRequest) => handleAuth(request);
}

// ---------------------------------------------------------------------------
// Internal route implementations
// ---------------------------------------------------------------------------

async function handleRegister(
  request: RouteRequest,
  config: AgentGateConfig,
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

  const availableScopeIds = new Set((config.scopes ?? []).map((s) => s.id));
  const invalidScopes = scopesRequested.filter((s) => !availableScopeIds.has(s));
  if (invalidScopes.length > 0) {
    return jsonResponse({ error: `Invalid scopes: ${invalidScopes.join(", ")}` }, 400);
  }

  // Duplicate public key check.
  for (const agent of agents.values()) {
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

  challenges.set(agentId, {
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
  request: RouteRequest,
  config: AgentGateConfig,
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

  const challenge = challenges.get(agentId);
  if (!challenge) {
    return jsonResponse({ error: "Unknown agent_id or challenge not found" }, 404);
  }

  if (Date.now() > challenge.expiresAt) {
    challenges.delete(agentId);
    return jsonResponse({ error: "Challenge expired" }, 410);
  }

  const valid = await verifyEd25519(challenge.message, signature, challenge.publicKey);
  if (!valid) {
    return jsonResponse({ error: "Invalid signature" }, 400);
  }

  const apiKey = `agk_live_${generateId("")}`;
  const apiKeyHash = await sha256(apiKey);

  agents.set(agentId, {
    id: agentId,
    publicKey: challenge.publicKey,
    apiKeyHash,
    apiKey,
    scopesGranted: challenge.scopesRequested,
    x402Wallet: challenge.x402Wallet,
    metadata: challenge.metadata,
    createdAt: new Date(),
  });

  challenges.delete(agentId);

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

async function handleAuth(request: RouteRequest): Promise<Response> {
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

  const agent = agents.get(agentId);
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
  });
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Helper to extract the AgentContext from request headers set by the edge
 * middleware. Use in App Router server components or route handlers:
 *
 * ```ts
 * import { getAgentContext } from "@agentgate/next";
 * import { headers } from "next/headers";
 *
 * export async function GET() {
 *   const h = await headers();
 *   const agent = getAgentContext(h);
 *   if (agent) {
 *     return Response.json({ agent: agent.id });
 *   }
 * }
 * ```
 */
export function getAgentContext(headers: Headers): import("@agentgate/core").AgentContext | null {
  const raw = headers.get("x-agentgate-agent");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
