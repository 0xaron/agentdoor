import { Router } from "express";
import type { AgentGateConfig, AgentStore } from "@agentgate/core";
import {
  verifySignature,
  issueToken,
  AgentGateError,
} from "@agentgate/core";

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
 *
 * Request body:
 *   {
 *     "agent_id": "ag_xxx",
 *     "timestamp": "2026-02-08T12:30:00Z",
 *     "signature": "base64-signature-of-agentgate:auth:agent_id:timestamp"
 *   }
 *
 * Response:
 *   {
 *     "token": "eyJhbGci...",
 *     "expires_at": "2026-02-08T13:30:00Z"
 *   }
 */
export function createAuthRouter(
  config: AgentGateConfig,
  store: AgentStore
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
      const agent = await store.findAgentById(agent_id);
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
      const tokenResult = await issueToken({
        agentId: agent_id,
        scopes: agent.scopesGranted,
        jwtConfig: config.jwt,
      });

      // Update last auth timestamp
      await store.updateAgentLastAuth(agent_id, new Date());

      // Fire the onAgentAuthenticated callback if configured
      if (config.onAgentAuthenticated) {
        Promise.resolve(config.onAgentAuthenticated(agent)).catch((err) => {
          console.error("[agentgate] onAgentAuthenticated callback error:", err);
        });
      }

      res.status(200).json({
        token: tokenResult.token,
        expires_at: tokenResult.expiresAt,
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
