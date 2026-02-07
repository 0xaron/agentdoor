/**
 * @agentgate/core - JWT Token Issuance & Verification
 *
 * Uses the `jose` library for standards-compliant JWT handling.
 * Tokens carry agent identity, scopes, and metadata in their claims.
 */

import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { InvalidTokenError } from "./errors.js";
import { DEFAULT_JWT_EXPIRY } from "./constants.js";
import type { AgentContext } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Claims embedded in an AgentGate JWT. */
export interface AgentGateJWTClaims {
  /** Agent identifier */
  agent_id: string;
  /** Granted scopes */
  scopes: string[];
  /** Agent's public key (base64) */
  public_key: string;
  /** Agent metadata */
  metadata?: Record<string, string>;
  /** Reputation score */
  reputation?: number;
}

/** Result of a successful token verification. */
export interface TokenVerifyResult {
  /** The decoded agent context */
  agent: AgentContext;
  /** When the token expires */
  expiresAt: Date;
  /** When the token was issued */
  issuedAt: Date;
}

// ---------------------------------------------------------------------------
// Secret Key Encoding
// ---------------------------------------------------------------------------

/**
 * Encode a secret string into a key suitable for jose HMAC operations.
 * Uses TextEncoder to convert the secret to bytes.
 */
function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

// ---------------------------------------------------------------------------
// Token Issuance
// ---------------------------------------------------------------------------

/**
 * Issue a JWT token for an authenticated agent.
 *
 * The token includes:
 * - `sub`: agent ID
 * - `agent_id`: agent ID (explicit claim)
 * - `scopes`: granted scope IDs
 * - `public_key`: agent's Ed25519 public key
 * - `metadata`: agent metadata (framework, version, etc.)
 * - `reputation`: agent reputation score
 * - Standard claims: `iat`, `exp`, `iss`
 *
 * @param agent - Agent context to encode in the token
 * @param secret - HMAC secret for signing
 * @param expiresIn - Expiration duration string (e.g. "1h", "24h", "7d")
 * @param issuer - Token issuer identifier
 * @returns Signed JWT string
 */
export async function issueToken(
  agent: AgentContext,
  secret: string,
  expiresIn: string = DEFAULT_JWT_EXPIRY,
  issuer: string = "agentgate",
): Promise<string> {
  const key = encodeSecret(secret);

  const jwt = new SignJWT({
    agent_id: agent.id,
    scopes: agent.scopes,
    public_key: agent.publicKey,
    metadata: agent.metadata,
    reputation: agent.reputation,
  } satisfies AgentGateJWTClaims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(agent.id)
    .setIssuedAt()
    .setIssuer(issuer)
    .setExpirationTime(expiresIn);

  return jwt.sign(key);
}

/**
 * Compute the expiration Date for a given duration string.
 * Supports: "30s", "5m", "1h", "24h", "7d"
 *
 * @param expiresIn - Duration string
 * @returns Date when the token will expire
 */
export function computeExpirationDate(expiresIn: string): Date {
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(
      `Invalid expiresIn format: "${expiresIn}". Expected format like "1h", "30m", "7d".`,
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const now = Date.now();
  let ms: number;

  switch (unit) {
    case "s":
      ms = value * 1000;
      break;
    case "m":
      ms = value * 60 * 1000;
      break;
    case "h":
      ms = value * 60 * 60 * 1000;
      break;
    case "d":
      ms = value * 24 * 60 * 60 * 1000;
      break;
    default:
      throw new Error(`Unknown time unit: ${unit}`);
  }

  return new Date(now + ms);
}

// ---------------------------------------------------------------------------
// Token Verification
// ---------------------------------------------------------------------------

/**
 * Verify a JWT token and extract the agent context.
 *
 * @param token - The JWT string to verify
 * @param secret - HMAC secret used for signing
 * @param issuer - Expected token issuer (default: "agentgate")
 * @returns Verified token result with agent context
 * @throws InvalidTokenError if the token is invalid, expired, or malformed
 */
export async function verifyToken(
  token: string,
  secret: string,
  issuer: string = "agentgate",
): Promise<TokenVerifyResult> {
  const key = encodeSecret(secret);

  try {
    const { payload } = await jwtVerify(token, key, {
      issuer,
      algorithms: ["HS256"],
    });

    const claims = payload as unknown as AgentGateJWTClaims & {
      sub?: string;
      iat?: number;
      exp?: number;
    };

    // Validate required claims
    if (!claims.agent_id || !claims.scopes || !claims.public_key) {
      throw new InvalidTokenError(
        "Token is missing required claims (agent_id, scopes, public_key).",
      );
    }

    const agent: AgentContext = {
      id: claims.agent_id,
      publicKey: claims.public_key,
      scopes: claims.scopes,
      rateLimit: { requests: 0, window: "0s" }, // Rate limit checked separately
      reputation: claims.reputation,
      metadata: claims.metadata ?? {},
    };

    return {
      agent,
      expiresAt: claims.exp ? new Date(claims.exp * 1000) : new Date(0),
      issuedAt: claims.iat ? new Date(claims.iat * 1000) : new Date(0),
    };
  } catch (error) {
    if (error instanceof InvalidTokenError) {
      throw error;
    }

    if (error instanceof joseErrors.JWTExpired) {
      throw new InvalidTokenError("Token has expired. Please re-authenticate.");
    }

    if (error instanceof joseErrors.JWSSignatureVerificationFailed) {
      throw new InvalidTokenError("Token signature verification failed.");
    }

    if (error instanceof joseErrors.JWTClaimValidationFailed) {
      throw new InvalidTokenError(
        `Token claim validation failed: ${(error as Error).message}`,
      );
    }

    throw new InvalidTokenError(
      `Token verification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
