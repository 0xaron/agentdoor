import { Router } from "express";
import type { AgentStore } from "@agentgate/core";
import { AGENTGATE_VERSION } from "@agentgate/core";

/**
 * Creates a router for GET /agentgate/health.
 *
 * Returns the health status of the AgentGate middleware including:
 * - Current status (healthy/degraded)
 * - AgentGate version
 * - Server uptime
 * - Storage connectivity check
 * - Current timestamp (useful for agents to check clock skew)
 */
export function createHealthRouter(store: AgentStore): Router {
  const router = Router();
  const startedAt = new Date();

  router.get("/agentgate/health", async (_req, res) => {
    const now = new Date();
    const uptimeMs = now.getTime() - startedAt.getTime();

    let storageStatus: "connected" | "error" = "connected";
    let storageError: string | undefined;

    // Probe storage to verify connectivity
    try {
      await store.healthCheck();
    } catch (err) {
      storageStatus = "error";
      storageError = err instanceof Error ? err.message : "Unknown storage error";
    }

    const isHealthy = storageStatus === "connected";

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? "healthy" : "degraded",
      version: AGENTGATE_VERSION,
      uptime_ms: uptimeMs,
      timestamp: now.toISOString(),
      storage: {
        status: storageStatus,
        ...(storageError ? { error: storageError } : {}),
      },
    });
  });

  return router;
}
