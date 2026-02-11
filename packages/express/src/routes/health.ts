import { Router } from "express";
import type { AgentStore } from "@agentdoor/core";
import { AGENTDOOR_VERSION } from "@agentdoor/core";

/**
 * Creates a router for GET /agentdoor/health.
 *
 * Returns the health status of the AgentDoor middleware including:
 * - Current status (healthy/degraded)
 * - AgentDoor version
 * - Server uptime
 * - Storage connectivity check
 * - Current timestamp (useful for agents to check clock skew)
 */
export function createHealthRouter(store: AgentStore): Router {
  const router = Router();
  const startedAt = new Date();

  router.get("/agentdoor/health", async (_req, res) => {
    const now = new Date();
    const uptimeMs = now.getTime() - startedAt.getTime();

    let storageStatus: "connected" | "error" = "connected";
    let storageError: string | undefined;

    // Probe storage to verify connectivity by performing a lightweight read
    try {
      await store.getAgent("__health_check__");
    } catch (err) {
      storageStatus = "error";
      storageError = err instanceof Error ? err.message : "Unknown storage error";
    }

    const isHealthy = storageStatus === "connected";

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? "healthy" : "degraded",
      version: AGENTDOOR_VERSION,
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
