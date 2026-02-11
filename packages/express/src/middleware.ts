import { Router, json } from "express";
import type { AgentDoorConfig, AgentStore } from "@agentdoor/core";
import {
  resolveConfig,
  MemoryStore,
  AGENTDOOR_VERSION,
  WebhookEmitter,
  ReputationManager,
  SpendingTracker,
} from "@agentdoor/core";
import type { WebhooksConfig, ReputationConfig, SpendingCapsConfig } from "@agentdoor/core";
import { createDiscoveryRouter } from "./routes/discovery.js";
import { createRegisterRouter } from "./routes/register.js";
import { createAuthRouter } from "./routes/auth.js";
import { createHealthRouter } from "./routes/health.js";
import { createAuthGuard } from "./auth-guard.js";

/**
 * Options for the agentdoor() factory beyond the core AgentDoorConfig.
 * These control Express-specific behavior.
 */
export interface AgentDoorExpressOptions extends AgentDoorConfig {
  /**
   * Custom agent store implementation. If not provided, an in-memory
   * store is created automatically (suitable for development and testing).
   *
   * For production, supply a persistent store (SQLite, Postgres, etc.)
   * from @agentdoor/core.
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
   * AgentDoor routes. Set to false if your app already uses
   * express.json() globally. Defaults to true.
   */
  enableBodyParser?: boolean;

  /**
   * Pre-configured WebhookEmitter instance. If not provided,
   * one is created from the webhooks config (P1).
   */
  webhookEmitter?: WebhookEmitter;

  /**
   * Pre-configured ReputationManager instance. If not provided,
   * one is created from the reputation config (P1).
   */
  reputationManager?: ReputationManager;

  /**
   * Pre-configured SpendingTracker instance. If not provided,
   * one is created from the spendingCaps config (P1).
   */
  spendingTracker?: SpendingTracker;
}

/** P1 services bundle passed to route handlers. */
export interface P1Services {
  webhookEmitter: WebhookEmitter;
  reputationManager: ReputationManager;
  spendingTracker: SpendingTracker;
}

/**
 * Creates the AgentDoor Express middleware.
 *
 * Usage:
 * ```typescript
 * import { agentdoor } from "@agentdoor/express";
 *
 * app.use(agentdoor({
 *   scopes: [{ id: "data.read", description: "Read data" }],
 *   pricing: { "data.read": "$0.001/req" },
 *   rateLimit: { requests: 1000, window: "1h" },
 *   // P1 features:
 *   webhooks: {
 *     endpoints: [{ url: "https://hooks.example.com/agentdoor" }],
 *   },
 *   reputation: {
 *     gates: [{ minReputation: 30, action: "block" }],
 *   },
 *   spendingCaps: {
 *     defaultCaps: [{ amount: 10, currency: "USDC", period: "daily", type: "hard" }],
 *   },
 * }));
 * ```
 *
 * This mounts:
 * - GET  /.well-known/agentdoor.json   (discovery)
 * - POST /agentdoor/register           (registration step 1)
 * - POST /agentdoor/register/verify    (registration step 2)
 * - POST /agentdoor/auth               (returning agent auth)
 * - GET  /agentdoor/health             (health check)
 * - Auth guard middleware on all subsequent routes
 *
 * @param options - AgentDoor config + Express-specific options
 * @returns Express Router to mount with app.use()
 */
export function agentdoor(options: AgentDoorExpressOptions): Router {
  // Resolve the config: validates via zod and applies all defaults.
  // This ensures JWT secret, rate limits, and other values are always present.
  const resolved = resolveConfig(options);

  // Create or use the provided storage backend
  const store: AgentStore = options.store ?? new MemoryStore();

  const enableAuthGuard = options.enableAuthGuard !== false;
  const enableBodyParser = options.enableBodyParser !== false;

  // Initialize P1 services
  const webhookEmitter = options.webhookEmitter ?? new WebhookEmitter(
    resolved.webhooks as WebhooksConfig | undefined,
  );
  const reputationManager = options.reputationManager ?? new ReputationManager(
    resolved.reputation as ReputationConfig | undefined,
  );
  const spendingTracker = options.spendingTracker ?? new SpendingTracker(
    resolved.spendingCaps as SpendingCapsConfig | undefined,
  );

  const p1Services: P1Services = {
    webhookEmitter,
    reputationManager,
    spendingTracker,
  };

  const router = Router();

  // Apply JSON body parsing for AgentDoor POST routes if needed
  if (enableBodyParser) {
    router.use(
      ["/agentdoor/register", "/agentdoor/register/verify", "/agentdoor/auth"],
      json({ limit: "16kb" })
    );
  }

  // Log initialization
  console.log(
    `[agentdoor] v${AGENTDOOR_VERSION} initialized with ${resolved.scopes.length} scope(s)`
  );

  // Mount route handlers
  router.use(createDiscoveryRouter(resolved));
  router.use(createRegisterRouter(resolved, store, p1Services));
  router.use(createAuthRouter(resolved, store, p1Services));
  router.use(createHealthRouter(store));

  // Apply auth guard to all routes that pass through this router.
  // The guard enriches requests with req.agent and req.isAgent but
  // does NOT block unauthenticated requests. SaaS app handlers
  // decide access policy.
  if (enableAuthGuard) {
    router.use(createAuthGuard(store, resolved.jwt.secret));
  }

  return router;
}
