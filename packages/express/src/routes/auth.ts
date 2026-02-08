import { Router } from "express";
import type { AgentStore, AgentContext } from "@agentgate/core";
import {
  verifySignature,
  issueToken,
  computeExpirationDate,
  AgentGateError,
} from "@agentgate/core";
import type { ResolvedConfig } from "@agentgate/core";
import type { P1Services } from "../middleware.js";

/**
 * Maximum allowed clock skew between agent timestamp and server time.
 * Requests with timestamps older than this are rejected to prevent
 * replay attacks.
 */
const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Creates a router for POST /agentgate/auth.
 *
 * This endpoint is for returning agents that have already completed
 * registration and want to obtain a fresh JWT token. The agent proves
 * identity by signing a message containing their agent_id + timestamp
 * with their Ed25519 private key.
 */
export function createAuthRouter(
  config: ResolvedConfig,
  store: AgentStore,
  p1Services?: P1Services,
): Router {
  const router = Router();

  router.post("/agentgate/auth", async (req, res) => {
    try {
      const { agent_id, timestamp, signature } = req.body;

      // --- Input validation ---
      if (!agent_id || typeof agent_id !== "string") {
        res.status(400).json({
          error: "invalid_request",
          message: "agent_id is required",
        });
        return;
      }

      if (!timestamp || typeof timestamp !== "string") {
        res.status(400).json({
          error: "invalid_request",
          message: "timestamp is required (ISO 8601 format)",
        });
        return;
      }

      if (!signature || typeof signature !== "string") {
        res.status(400).json({
          error: "invalid_request",
          message: "signature is required",
        });
        return;
      }

      // Validate timestamp is not too old or too far in the future
      const requestTime = new Date(timestamp);
      if (isNaN(requestTime.getTime())) {
        res.status(400).json({
          error: "invalid_request",
          message: "timestamp must be a valid ISO 8601 date string",
        });
        return;
      }

      const now = Date.now();
      const skew = Math.abs(now - requestTime.getTime());
      if (skew > MAX_TIMESTAMP_SKEW_MS) {
        res.status(400).json({
          error: "timestamp_invalid",
          message: `Timestamp is too far from server time. Maximum allowed skew is ${MAX_TIMESTAMP_SKEW_MS / 1000} seconds.`,
        });
        return;
      }

      // Look up the agent
      const agent = await store.getAgent(agent_id);
      if (!agent) {
        res.status(404).json({
          error: "agent_not_found",
          message: "No registered agent found with this agent_id",
        });
        return;
      }

      // Check agent status
      if (agent.status !== "active") {
        res.status(403).json({
          error: "agent_inactive",
          message: `Agent account is ${agent.status}. Contact the service owner for assistance.`,
        });
        return;
      }

      // Reconstruct the expected signed message: agentgate:auth:{agent_id}:{timestamp}
      const expectedMessage = `agentgate:auth:${agent_id}:${timestamp}`;

      // Verify the signature
      const isValid = verifySignature(expectedMessage, signature, agent.publicKey);
      if (!isValid) {
        res.status(401).json({
          error: "invalid_signature",
          message: "Signature verification failed. Ensure you signed the message 'agentgate:auth:{agent_id}:{timestamp}' with the correct private key.",
        });
        return;
      }

      // Issue a fresh JWT
      const agentContext: AgentContext = {
        id: agent.id,
        publicKey: agent.publicKey,
        scopes: agent.scopesGranted,
        rateLimit: agent.rateLimit,
        reputation: agent.reputation,
        metadata: agent.metadata,
      };

      const token = await issueToken(
        agentContext,
        config.jwt.secret,
        config.jwt.expiresIn,
      );
      const tokenExpiresAt = computeExpirationDate(config.jwt.expiresIn);

      // Update last auth timestamp
      await store.updateAgent(agent_id, { lastAuthAt: new Date() });

      // Fire the onAgentAuthenticated callback if configured
      if (config.onAgentAuthenticated) {
        Promise.resolve(config.onAgentAuthenticated(agent)).catch((err) => {
          console.error("[agentgate] onAgentAuthenticated callback error:", err);
        });
      }

      // P1: Emit webhook event for agent authentication
      if (p1Services?.webhookEmitter) {
        p1Services.webhookEmitter.emit("agent.authenticated", {
          agent_id: agent.id,
          method: "challenge" as const,
        }).catch((err) => {
          console.error("[agentgate] Webhook emit error:", err);
        });
      }

      res.status(200).json({
        token,
        expires_at: tokenExpiresAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof AgentGateError) {
        res.status(err.statusCode).json({
          error: err.code,
          message: err.message,
        });
        return;
      }
      console.error("[agentgate] Auth error:", err);
      res.status(500).json({
        error: "internal_error",
        message: "An unexpected error occurred during authentication",
      });
    }
  });

  return router;
}
