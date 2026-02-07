import { Router, json } from "express";
import type { AgentGateConfig, AgentStore } from "@agentgate/core";
import {
  validateConfig,
  MemoryStore,
  AGENTGATE_VERSION,
} from "@agentgate/core";
import { createDiscoveryRouter } from "./routes/discovery.js";
import { createRegisterRouter } from "./routes/register.js";
import { createAuthRouter } from "./routes/auth.js";
import { createHealthRouter } from "./routes/health.js";
import { createAuthGuard } from "./auth-guard.js";

/**
 * Options for the agentgate() factory beyond the core AgentGateConfig.
 * These control Express-specific behavior.
 */
export interface AgentGateExpressOptions extends AgentGateConfig {
  /**
   * Custom agent store implementation. If not provided, an in-memory
   * store is created automatically (suitable for development and testing).
   *
   * For production, supply a persistent store (SQLite, Postgres, etc.)
   * from @agentgate/core.
   */
  store?: AgentStore;

  /**
   * If true, the auth guard middleware will be applied to all routes
   * that pass through this router, enriching requests with req.agent
   * and req.isAgent. Defaults to true.
   */
  enableAuthGuard?: boolean;

  /**
   * If true, the built-in JSON body parser will be applied to
   * AgentGate routes. Set to false if your app already uses
   * express.json() globally. Defaults to true.
   */
  enableBodyParser?: boolean;
}

/**
 * Creates the AgentGate Express middleware.
 *
 * Usage:
 * ```typescript
 * import { agentgate } from "@agentgate/express";
 *
 * app.use(agentgate({
 *   scopes: [{ id: "data.read", description: "Read data" }],
 *   pricing: { "data.read": "$0.001/req" },
 *   rateLimit: { requests: 1000, window: "1h" },
 * }));
 * ```
 *
 * This mounts:
 * - GET  /.well-known/agentgate.json   (discovery)
 * - POST /agentgate/register           (registration step 1)
 * - POST /agentgate/register/verify    (registration step 2)
 * - POST /agentgate/auth               (returning agent auth)
 * - GET  /agentgate/health             (health check)
 * - Auth guard middleware on all subsequent routes
 *
 * @param options - AgentGate config + Express-specific options
 * @returns Express Router to mount with app.use()
 */
export function agentgate(options: AgentGateExpressOptions): Router {
  // Validate the config using core's zod schema. This will throw
  // a descriptive error if the config is invalid, failing fast
  // at server startup rather than at request time.
  const config = validateConfig(options);

  // Create or use the provided storage backend
  const store: AgentStore = options.store ?? new MemoryStore();

  const enableAuthGuard = options.enableAuthGuard !== false;
  const enableBodyParser = options.enableBodyParser !== false;

  const router = Router();

  // Apply JSON body parsing for AgentGate POST routes if needed
  if (enableBodyParser) {
    router.use(
      ["/agentgate/register", "/agentgate/register/verify", "/agentgate/auth"],
      json({ limit: "16kb" })
    );
  }

  // Log initialization
  console.log(
    `[agentgate] v${AGENTGATE_VERSION} initialized with ${config.scopes.length} scope(s)`
  );

  // Mount route handlers
  router.use(createDiscoveryRouter(config));
  router.use(createRegisterRouter(config, store));
  router.use(createAuthRouter(config, store));
  router.use(createHealthRouter(store));

  // Apply auth guard to all routes that pass through this router.
  // The guard enriches requests with req.agent and req.isAgent but
  // does NOT block unauthenticated requests. SaaS app handlers
  // decide access policy.
  if (enableAuthGuard) {
    router.use(createAuthGuard(config, store));
  }

  return router;
}
