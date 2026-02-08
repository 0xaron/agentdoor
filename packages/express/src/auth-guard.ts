import type { Request, Response, NextFunction } from "express";
import type { AgentStore, AgentContext } from "@agentgate/core";
import {
  verifyToken,
  hashApiKey,
  API_KEY_PREFIX,
} from "@agentgate/core";

/**
 * Paths managed by AgentGate itself. The auth guard should not
 * intercept these routes since they have their own authentication
 * logic (or are public by design).
 */
const AGENTGATE_PATHS = new Set([
  "/.well-known/agentgate.json",
  "/agentgate/register",
  "/agentgate/register/verify",
  "/agentgate/auth",
  "/agentgate/health",
]);

/**
 * Creates an Express middleware that validates the Authorization header
 * on incoming requests.
 *
 * Supports two token formats:
 * 1. API Key: "Bearer agk_*" - looked up by hash in the agent store
 * 2. JWT: "Bearer eyJ*" - verified using jose, claims extracted
 *
 * On successful auth, sets:
 *   req.agent  - AgentContext with id, publicKey, scopes, rateLimit, etc.
 *   req.isAgent - true
 *
 * On missing/invalid auth:
 *   req.agent  - undefined
 *   req.isAgent - false
 *   (Does NOT block the request - the SaaS app decides access policy)
 *
 * This middleware is non-blocking by design. It enriches the request
 * with agent context but does not reject unauthenticated requests.
 * This allows SaaS owners to serve both human and agent traffic
 * through the same handlers, checking req.isAgent when needed.
 */
export function createAuthGuard(
  store: AgentStore,
  jwtSecret: string,
): (req: Request, res: Response, next: NextFunction) => void {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // Initialize defaults on every request
    req.isAgent = false;
    req.agent = undefined;

    // Skip AgentGate's own routes
    if (AGENTGATE_PATHS.has(req.path)) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      next();
      return;
    }

    // Must be a Bearer token
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      next();
      return;
    }

    const token = parts[1];

    try {
      let agentContext: AgentContext | undefined;

      if (token.startsWith(API_KEY_PREFIX)) {
        // --- API Key authentication ---
        agentContext = await resolveApiKey(token, store);
      } else if (token.startsWith("eyJ")) {
        // --- JWT authentication ---
        agentContext = await resolveJwt(token, jwtSecret);
      }

      if (agentContext) {
        req.agent = agentContext;
        req.isAgent = true;
      }
    } catch (err) {
      // Auth failures are logged but don't block the request.
      // The SaaS application decides what to do with unauthenticated
      // requests. This is the "sits alongside Clerk" philosophy.
      console.warn("[agentgate] Auth guard: token validation failed:", err instanceof Error ? err.message : err);
    }

    next();
  };
}

/**
 * Resolves an API key (agk_*) by hashing it and looking up the
 * corresponding agent in the store.
 */
async function resolveApiKey(
  apiKey: string,
  store: AgentStore
): Promise<AgentContext | undefined> {
  const keyHash = hashApiKey(apiKey);
  const agent = await store.getAgentByApiKeyHash(keyHash);

  if (!agent) {
    return undefined;
  }

  if (agent.status !== "active") {
    return undefined;
  }

  return {
    id: agent.id,
    publicKey: agent.publicKey,
    scopes: agent.scopesGranted,
    rateLimit: agent.rateLimit,
    reputation: agent.reputation,
    metadata: agent.metadata,
  };
}

/**
 * Resolves a JWT token by verifying it and extracting the agent context.
 */
async function resolveJwt(
  token: string,
  jwtSecret: string,
): Promise<AgentContext | undefined> {
  try {
    const result = await verifyToken(token, jwtSecret);
    return result.agent;
  } catch {
    return undefined;
  }
}
