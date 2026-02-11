/**
 * @agentdoor/core - Challenge-Response Logic
 *
 * Nonce generation, challenge message construction, signature verification,
 * and expiry checking for the registration and authentication flows.
 */

import { generateNonce, verifySignature } from "./crypto.js";
import {
  CHALLENGE_PREFIX,
  CHALLENGE_REGISTER_ACTION,
  CHALLENGE_AUTH_ACTION,
  DEFAULT_CHALLENGE_EXPIRY_SECONDS,
} from "./constants.js";
import { ChallengeExpiredError, InvalidSignatureError } from "./errors.js";
import type { ChallengeData } from "./types.js";

// ---------------------------------------------------------------------------
// Challenge Message Format
// ---------------------------------------------------------------------------

/**
 * Build a registration challenge message.
 * Format: "agentdoor:register:{agent_id}:{timestamp}:{nonce}"
 *
 * @param agentId - The assigned agent ID
 * @param timestamp - Unix timestamp in seconds
 * @param nonce - Random nonce string
 * @returns Formatted challenge message string
 */
export function buildRegistrationChallenge(
  agentId: string,
  timestamp: number,
  nonce: string,
): string {
  return `${CHALLENGE_PREFIX}:${CHALLENGE_REGISTER_ACTION}:${agentId}:${timestamp}:${nonce}`;
}

/**
 * Build an authentication challenge message (for returning agents).
 * Format: "agentdoor:auth:{agent_id}:{timestamp}"
 *
 * @param agentId - The agent's ID
 * @param timestamp - ISO 8601 timestamp string
 * @returns Formatted auth message string
 */
export function buildAuthMessage(agentId: string, timestamp: string): string {
  return `${CHALLENGE_PREFIX}:${CHALLENGE_AUTH_ACTION}:${agentId}:${timestamp}`;
}

// ---------------------------------------------------------------------------
// Challenge Creation
// ---------------------------------------------------------------------------

/**
 * Create a new registration challenge for an agent.
 *
 * @param agentId - The assigned agent ID
 * @param expirySeconds - How long the challenge is valid (default: 300s / 5 min)
 * @returns ChallengeData with nonce, message, and expiration
 */
export function createChallenge(
  agentId: string,
  expirySeconds: number = DEFAULT_CHALLENGE_EXPIRY_SECONDS,
): ChallengeData {
  const nonce = generateNonce();
  const now = Math.floor(Date.now() / 1000);
  const message = buildRegistrationChallenge(agentId, now, nonce);
  const expiresAt = new Date((now + expirySeconds) * 1000);

  return {
    agentId,
    nonce,
    message,
    expiresAt,
    createdAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Challenge Verification
// ---------------------------------------------------------------------------

/**
 * Verify a registration challenge response.
 *
 * Checks:
 * 1. Challenge has not expired
 * 2. Signature is valid against the agent's public key
 *
 * @param challenge - The stored ChallengeData
 * @param signature - Base64-encoded Ed25519 signature from the agent
 * @param publicKey - Base64-encoded Ed25519 public key of the agent
 * @throws ChallengeExpiredError if the challenge has expired
 * @throws InvalidSignatureError if the signature does not verify
 */
export function verifyChallenge(
  challenge: ChallengeData,
  signature: string,
  publicKey: string,
): void {
  // Check expiry
  if (isChallengeExpired(challenge)) {
    throw new ChallengeExpiredError(
      `Challenge expired at ${challenge.expiresAt.toISOString()}. ` +
        `Please request a new challenge by re-registering.`,
    );
  }

  // Verify signature
  const isValid = verifySignature(challenge.message, signature, publicKey);
  if (!isValid) {
    throw new InvalidSignatureError(
      "Signature verification failed. Ensure you signed the exact challenge message " +
        "with the correct private key.",
    );
  }
}

/**
 * Verify an auth request from a returning agent.
 *
 * The agent signs "agentdoor:auth:{agent_id}:{timestamp}" and we verify
 * the signature and check the timestamp is recent (within tolerance).
 *
 * @param agentId - The agent's ID
 * @param timestamp - ISO 8601 timestamp from the auth request
 * @param signature - Base64-encoded signature
 * @param publicKey - Base64-encoded public key
 * @param maxAgeSeconds - Maximum age of the timestamp (default: 300s / 5 min)
 * @throws ChallengeExpiredError if the timestamp is too old
 * @throws InvalidSignatureError if the signature is invalid
 */
export function verifyAuthRequest(
  agentId: string,
  timestamp: string,
  signature: string,
  publicKey: string,
  maxAgeSeconds: number = DEFAULT_CHALLENGE_EXPIRY_SECONDS,
): void {
  // Check timestamp freshness
  const requestTime = new Date(timestamp).getTime();
  const now = Date.now();
  const ageMs = now - requestTime;

  if (isNaN(requestTime)) {
    throw new InvalidSignatureError("Invalid timestamp format. Use ISO 8601.");
  }

  if (ageMs > maxAgeSeconds * 1000) {
    throw new ChallengeExpiredError(
      `Auth request timestamp too old. Maximum age is ${maxAgeSeconds} seconds.`,
    );
  }

  if (ageMs < -30_000) {
    // Allow 30 seconds of clock skew into the future
    throw new InvalidSignatureError(
      "Auth request timestamp is in the future. Check system clock.",
    );
  }

  // Verify signature
  const message = buildAuthMessage(agentId, timestamp);
  const isValid = verifySignature(message, signature, publicKey);
  if (!isValid) {
    throw new InvalidSignatureError(
      "Auth signature verification failed. Ensure you signed " +
        `"${CHALLENGE_PREFIX}:${CHALLENGE_AUTH_ACTION}:{agent_id}:{timestamp}" ` +
        "with the correct private key.",
    );
  }
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Check if a challenge has expired.
 *
 * @param challenge - The ChallengeData to check
 * @returns true if the challenge has expired
 */
export function isChallengeExpired(challenge: ChallengeData): boolean {
  return Date.now() > challenge.expiresAt.getTime();
}

/**
 * Parse a challenge message string into its components.
 *
 * @param message - Challenge message string
 * @returns Parsed components or null if the format is invalid
 */
export function parseChallengeMessage(message: string): {
  prefix: string;
  action: string;
  agentId: string;
  timestamp: number;
  nonce?: string;
} | null {
  const parts = message.split(":");
  if (parts.length < 4 || parts[0] !== CHALLENGE_PREFIX) {
    return null;
  }

  const action = parts[1];
  const agentId = parts[2];
  const timestamp = parseInt(parts[3], 10);

  if (isNaN(timestamp)) {
    return null;
  }

  if (action === CHALLENGE_REGISTER_ACTION && parts.length === 5) {
    return { prefix: parts[0], action, agentId, timestamp, nonce: parts[4] };
  }

  if (action === CHALLENGE_AUTH_ACTION && parts.length === 4) {
    return { prefix: parts[0], action, agentId, timestamp };
  }

  return null;
}
