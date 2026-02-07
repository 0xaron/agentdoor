import { Router } from "express";
import type { AgentGateConfig, AgentStore } from "@agentgate/core";
import {
  generateChallenge,
  formatChallengeMessage,
  verifySignature,
  issueToken,
  generateApiKey,
  hashApiKey,
  generateAgentId,
  AgentGateError,
  AGENTGATE_VERSION,
} from "@agentgate/core";

/**
 * Creates a router with the full agent registration + challenge-response
 * flow per PRD section 18.4:
 *
 * POST /agentgate/register
 *   Agent sends public_key + scopes_requested + optional x402_wallet + metadata.
 *   Server responds with agent_id + challenge (nonce + message + expires_at).
 *
 * POST /agentgate/register/verify
 *   Agent proves key ownership by signing the challenge message.
 *   Server verifies signature, creates the agent record, issues API key + JWT.
 */
export function createRegisterRouter(
  config: AgentGateConfig,
  store: AgentStore
): Router {
  const router = Router();

  /**
   * POST /agentgate/register
   *
   * Step 1 of registration: accept agent public key, requested scopes,
   * optional x402 wallet, and metadata. Return a challenge nonce that
   * the agent must sign to prove key ownership.
   */
  router.post("/agentgate/register", async (req, res) => {
    try {
      const { public_key, scopes_requested, x402_wallet, metadata } = req.body;

      // --- Input validation ---
      if (!public_key || typeof public_key !== "string") {
        res.status(400).json({
          error: "invalid_request",
          message: "public_key is required and must be a base64-encoded Ed25519 public key",
        });
        return;
      }

      if (!scopes_requested || !Array.isArray(scopes_requested) || scopes_requested.length === 0) {
        res.status(400).json({
          error: "invalid_request",
          message: "scopes_requested is required and must be a non-empty array of scope IDs",
        });
        return;
      }

      // Validate that all requested scopes are actually available
      const availableScopeIds = config.scopes.map((s) => s.id);
      const invalidScopes = scopes_requested.filter(
        (s: string) => !availableScopeIds.includes(s)
      );
      if (invalidScopes.length > 0) {
        res.status(400).json({
          error: "invalid_scopes",
          message: `Unknown scopes: ${invalidScopes.join(", ")}`,
          available_scopes: availableScopeIds,
        });
        return;
      }

      // Check for duplicate public key
      const existingAgent = await store.findAgentByPublicKey(public_key);
      if (existingAgent) {
        res.status(409).json({
          error: "already_registered",
          message: "An agent with this public key is already registered",
          agent_id: existingAgent.id,
        });
        return;
      }

      // --- Generate agent ID and challenge ---
      const agentId = generateAgentId();
      const challenge = generateChallenge(agentId);

      // Store the pending registration with the challenge
      await store.storePendingRegistration({
        agentId,
        publicKey: public_key,
        scopesRequested: scopes_requested,
        x402Wallet: x402_wallet,
        metadata: metadata || {},
        challenge,
      });

      // Return challenge for the agent to sign
      res.status(201).json({
        agent_id: agentId,
        challenge: {
          nonce: challenge.nonce,
          message: challenge.message,
          expires_at: challenge.expiresAt,
        },
      });
    } catch (err) {
      if (err instanceof AgentGateError) {
        res.status(err.statusCode).json({
          error: err.code,
          message: err.message,
        });
        return;
      }
      console.error("[agentgate] Registration error:", err);
      res.status(500).json({
        error: "internal_error",
        message: "An unexpected error occurred during registration",
      });
    }
  });

  /**
   * POST /agentgate/register/verify
   *
   * Step 2 of registration: agent proves key ownership by providing
   * a signature over the challenge message. Server verifies the signature,
   * creates the agent record, and issues an API key + JWT token.
   */
  router.post("/agentgate/register/verify", async (req, res) => {
    try {
      const { agent_id, signature } = req.body;

      // --- Input validation ---
      if (!agent_id || typeof agent_id !== "string") {
        res.status(400).json({
          error: "invalid_request",
          message: "agent_id is required",
        });
        return;
      }

      if (!signature || typeof signature !== "string") {
        res.status(400).json({
          error: "invalid_request",
          message: "signature is required and must be a base64-encoded Ed25519 signature",
        });
        return;
      }

      // Retrieve the pending registration
      const pending = await store.getPendingRegistration(agent_id);
      if (!pending) {
        res.status(404).json({
          error: "not_found",
          message: "No pending registration found for this agent_id. It may have expired.",
        });
        return;
      }

      // Check if challenge has expired
      const now = new Date();
      if (now > new Date(pending.challenge.expiresAt)) {
        await store.deletePendingRegistration(agent_id);
        res.status(410).json({
          error: "challenge_expired",
          message: "The registration challenge has expired. Please register again.",
        });
        return;
      }

      // Verify the signature against the challenge message using the agent's public key
      const isValid = verifySignature(
        pending.challenge.message,
        signature,
        pending.publicKey
      );

      if (!isValid) {
        res.status(400).json({
          error: "invalid_signature",
          message: "Signature verification failed. Ensure you signed the exact challenge message with the correct private key.",
        });
        return;
      }

      // --- Signature is valid: create the agent ---
      const apiKey = generateApiKey();
      const apiKeyHash = hashApiKey(apiKey);

      // Determine rate limit: use config defaults or scope-specific limits
      const rateLimit = config.rateLimit ?? { requests: 1000, window: "1h" };

      const agent = await store.createAgent({
        id: agent_id,
        publicKey: pending.publicKey,
        x402Wallet: pending.x402Wallet,
        apiKeyHash,
        scopesGranted: pending.scopesRequested,
        rateLimit,
        metadata: pending.metadata,
      });

      // Issue a JWT token for the agent
      const tokenResult = await issueToken({
        agentId: agent_id,
        scopes: pending.scopesRequested,
        jwtConfig: config.jwt,
      });

      // Clean up the pending registration
      await store.deletePendingRegistration(agent_id);

      // Fire the onAgentRegistered callback if provided
      if (config.onAgentRegistered) {
        // Fire-and-forget: don't block the response
        Promise.resolve(config.onAgentRegistered(agent)).catch((err) => {
          console.error("[agentgate] onAgentRegistered callback error:", err);
        });
      }

      // Build response
      const response: Record<string, unknown> = {
        agent_id,
        api_key: apiKey,
        scopes_granted: pending.scopesRequested,
        token: tokenResult.token,
        token_expires_at: tokenResult.expiresAt,
        rate_limit: rateLimit,
      };

      // Include x402 payment info if configured
      if (config.x402) {
        response.x402 = {
          payment_address: config.x402.paymentAddress,
          network: config.x402.network,
          currency: config.x402.currency,
        };
      }

      res.status(200).json(response);
    } catch (err) {
      if (err instanceof AgentGateError) {
        res.status(err.statusCode).json({
          error: err.code,
          message: err.message,
        });
        return;
      }
      console.error("[agentgate] Verification error:", err);
      res.status(500).json({
        error: "internal_error",
        message: "An unexpected error occurred during verification",
      });
    }
  });

  return router;
}
