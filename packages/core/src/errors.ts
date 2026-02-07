/**
 * @agentgate/core - Error Classes
 *
 * Typed error hierarchy for AgentGate.
 * All errors extend AgentGateError for easy catch-all handling.
 */

/**
 * Base error class for all AgentGate errors.
 * Provides a `code` field for programmatic error handling and
 * an optional `statusCode` for HTTP response mapping.
 */
export class AgentGateError extends Error {
  /** Machine-readable error code */
  public readonly code: string;
  /** Suggested HTTP status code */
  public readonly statusCode: number;
  /** Additional error context */
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string = "AGENTGATE_ERROR",
    statusCode: number = 500,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AgentGateError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /** Serialize error to a JSON-friendly object for API responses. */
  toJSON(): Record<string, unknown> {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

/**
 * Thrown when a cryptographic signature fails verification.
 * Maps to HTTP 400 Bad Request.
 */
export class InvalidSignatureError extends AgentGateError {
  constructor(message: string = "Invalid signature") {
    super(message, "INVALID_SIGNATURE", 400);
    this.name = "InvalidSignatureError";
  }
}

/**
 * Thrown when a registration challenge has expired.
 * Maps to HTTP 410 Gone.
 */
export class ChallengeExpiredError extends AgentGateError {
  constructor(message: string = "Challenge has expired") {
    super(message, "CHALLENGE_EXPIRED", 410);
    this.name = "ChallengeExpiredError";
  }
}

/**
 * Thrown when an agent cannot be found by ID, API key hash, or public key.
 * Maps to HTTP 404 Not Found.
 */
export class AgentNotFoundError extends AgentGateError {
  constructor(message: string = "Agent not found") {
    super(message, "AGENT_NOT_FOUND", 404);
    this.name = "AgentNotFoundError";
  }
}

/**
 * Thrown when a rate limit is exceeded.
 * Maps to HTTP 429 Too Many Requests.
 */
export class RateLimitExceededError extends AgentGateError {
  /** Number of seconds until the rate limit resets */
  public readonly retryAfter: number;

  constructor(retryAfterMs: number, message?: string) {
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    super(
      message ?? `Rate limit exceeded. Retry after ${retryAfterSeconds} seconds.`,
      "RATE_LIMIT_EXCEEDED",
      429,
      { retry_after: retryAfterSeconds },
    );
    this.name = "RateLimitExceededError";
    this.retryAfter = retryAfterSeconds;
  }
}

/**
 * Thrown when the AgentGateConfig fails validation.
 * Maps to HTTP 500 Internal Server Error (configuration is server-side).
 */
export class InvalidConfigError extends AgentGateError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(
      `Invalid AgentGate configuration: ${message}`,
      "INVALID_CONFIG",
      500,
      details,
    );
    this.name = "InvalidConfigError";
  }
}

/**
 * Thrown when attempting to register an agent whose public key or wallet
 * address is already registered.
 * Maps to HTTP 409 Conflict.
 */
export class DuplicateAgentError extends AgentGateError {
  constructor(message: string = "An agent with this public key or wallet is already registered") {
    super(message, "DUPLICATE_AGENT", 409);
    this.name = "DuplicateAgentError";
  }
}

/**
 * Thrown when an agent requests scopes that are not available or valid.
 * Maps to HTTP 400 Bad Request.
 */
export class InvalidScopeError extends AgentGateError {
  /** The invalid scopes that were requested */
  public readonly invalidScopes: string[];

  constructor(invalidScopes: string[]) {
    super(
      `Invalid scopes requested: ${invalidScopes.join(", ")}`,
      "INVALID_SCOPE",
      400,
      { invalid_scopes: invalidScopes },
    );
    this.name = "InvalidScopeError";
    this.invalidScopes = invalidScopes;
  }
}

/**
 * Thrown when a JWT token is invalid, expired, or malformed.
 * Maps to HTTP 401 Unauthorized.
 */
export class InvalidTokenError extends AgentGateError {
  constructor(message: string = "Invalid or expired token") {
    super(message, "INVALID_TOKEN", 401);
    this.name = "InvalidTokenError";
  }
}

/**
 * Thrown when an agent is suspended or banned and attempts to authenticate.
 * Maps to HTTP 403 Forbidden.
 */
export class AgentSuspendedError extends AgentGateError {
  constructor(agentId: string, status: string) {
    super(
      `Agent ${agentId} is ${status}`,
      "AGENT_SUSPENDED",
      403,
      { agent_id: agentId, status },
    );
    this.name = "AgentSuspendedError";
  }
}
