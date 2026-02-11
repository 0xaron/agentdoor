import { Router } from "express";
import type { AgentStore, AgentContext } from "@agentdoor/core";
import {
  createChallenge,
  verifySignature,
  issueToken,
  computeExpirationDate,
  generateApiKey,
  hashApiKey,
  generateAgentId,
  AgentDoorError,
  DEFAULT_REPUTATION,
} from "@agentdoor/core";
import type { ResolvedConfig } from "@agentdoor/core";
import type { P1Services } from "../middleware.js";

/**
 * Pending registration data stored between step 1 (register) and step 2 (verify).
 * Keyed by agent_id.
 */
interface PendingRegistration {
  publicKey: string;
  scopesRequested: string[];
  x402Wallet?: string;
  metadata: Record<string, string>;
}

/** Module-level map for pending registration data. */
const pendingRegistrations = new Map<string, PendingRegistration>();

/**
 * Creates a router with the full agent registration + challenge-response flow:
 *
 * POST /agentdoor/register
 *   Agent sends public_key + scopes_requested + optional x402_wallet + metadata.
 *   Server responds with agent_id + challenge (nonce + message + expires_at).
 *
 * POST /agentdoor/register/verify
 *   Agent proves key ownership by signing the challenge message.
 *   Server verifies signature, creates the agent record, issues API key + JWT.
 */
export function createRegisterRouter(
  config: ResolvedConfig,
  store: AgentStore,
  p1Services?: P1Services,
): Router {
  const router = Router();

  /**
   * POST /agentdoor/register
   *
   * Step 1 of registration: accept agent public key, requested scopes,
   * optional x402 wallet, and metadata. Return a challenge nonce that
   * the agent must sign to prove key ownership.
   */
  router.post("/agentdoor/register", async (req, res) => {
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
      const existingAgent = await store.getAgentByPublicKey(public_key);
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
      const challenge = createChallenge(agentId, config.challengeExpirySeconds);

      // Persist challenge and pending registration data together in the store.
      // This ensures pending registrations survive process restarts.
      challenge.pendingRegistration = {
        publicKey: public_key,
        scopesRequested: scopes_requested,
        x402Wallet: x402_wallet,
        metadata: metadata || {},
      };
      await store.createChallenge(challenge);

      // Also keep in memory for backward compatibility
      pendingRegistrations.set(agentId, {
        publicKey: public_key,
        scopesRequested: scopes_requested,
        x402Wallet: x402_wallet,
        metadata: metadata || {},
      });

      // Return challenge for the agent to sign
      res.status(201).json({
        agent_id: agentId,
        challenge: {
          nonce: challenge.nonce,
          message: challenge.message,
          expires_at: challenge.expiresAt.toISOString(),
        },
      });
    } catch (err) {
      if (err instanceof AgentDoorError) {
        res.status(err.statusCode).json({
          error: err.code,
          message: err.message,
        });
        return;
      }
      console.error("[agentdoor] Registration error:", err);
      res.status(500).json({
        error: "internal_error",
        message: "An unexpected error occurred during registration",
      });
    }
  });

  /**
   * POST /agentdoor/register/verify
   *
   * Step 2 of registration: agent proves key ownership by providing
   * a signature over the challenge message. Server verifies the signature,
   * creates the agent record, and issues an API key + JWT token.
   */
  router.post("/agentdoor/register/verify", async (req, res) => {
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

      // Retrieve the pending challenge
      const challenge = await store.getChallenge(agent_id);
      if (!challenge) {
        res.status(404).json({
          error: "not_found",
          message: "No pending registration found for this agent_id. It may have expired.",
        });
        return;
      }

      // Retrieve the pending registration data. Try in-memory first, then
      // fall back to the persisted data in the challenge (survives restarts).
      let pending = pendingRegistrations.get(agent_id);
      if (!pending && challenge.pendingRegistration) {
        pending = challenge.pendingRegistration;
      }
      if (!pending) {
        res.status(404).json({
          error: "not_found",
          message: "No pending registration data found for this agent_id.",
        });
        return;
      }

      // Check if challenge has expired
      if (Date.now() > challenge.expiresAt.getTime()) {
        await store.deleteChallenge(agent_id);
        pendingRegistrations.delete(agent_id);
        res.status(410).json({
          error: "challenge_expired",
          message: "The registration challenge has expired. Please register again.",
        });
        return;
      }

      // Verify the signature against the challenge message using the agent's public key
      const isValid = verifySignature(
        challenge.message,
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
      const apiKey = generateApiKey(config.mode);
      const apiKeyHash = hashApiKey(apiKey);

      const rateLimit = config.rateLimit;

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
      const agentContext: AgentContext = {
        id: agent_id,
        publicKey: pending.publicKey,
        scopes: pending.scopesRequested,
        rateLimit,
        reputation: DEFAULT_REPUTATION,
        metadata: pending.metadata,
      };

      const token = await issueToken(
        agentContext,
        config.jwt.secret,
        config.jwt.expiresIn,
      );
      const tokenExpiresAt = computeExpirationDate(config.jwt.expiresIn);

      // Clean up the pending registration
      await store.deleteChallenge(agent_id);
      pendingRegistrations.delete(agent_id);

      // Fire the onAgentRegistered callback if provided
      if (config.onAgentRegistered) {
        Promise.resolve(config.onAgentRegistered(agent)).catch((err) => {
          console.error("[agentdoor] onAgentRegistered callback error:", err);
        });
      }

      // P1: Emit webhook event for agent registration
      if (p1Services?.webhookEmitter) {
        p1Services.webhookEmitter.emit("agent.registered", {
          agent_id,
          public_key: pending.publicKey,
          scopes_granted: pending.scopesRequested,
          x402_wallet: pending.x402Wallet,
          metadata: pending.metadata,
        }).catch((err) => {
          console.error("[agentdoor] Webhook emit error:", err);
        });
      }

      // Build response
      const response: Record<string, unknown> = {
        agent_id,
        api_key: apiKey,
        scopes_granted: pending.scopesRequested,
        token,
        token_expires_at: tokenExpiresAt.toISOString(),
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
      if (err instanceof AgentDoorError) {
        res.status(err.statusCode).json({
          error: err.code,
          message: err.message,
        });
        return;
      }
      console.error("[agentdoor] Verification error:", err);
      res.status(500).json({
        error: "internal_error",
        message: "An unexpected error occurred during verification",
      });
    }
  });

  return router;
}
