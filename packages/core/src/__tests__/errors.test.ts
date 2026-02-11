import { describe, it, expect } from "vitest";
import {
  AgentDoorError,
  InvalidSignatureError,
  ChallengeExpiredError,
  AgentNotFoundError,
  RateLimitExceededError,
  InvalidConfigError,
  DuplicateAgentError,
  InvalidScopeError,
  InvalidTokenError,
  AgentSuspendedError,
} from "../errors.js";

// ---------------------------------------------------------------------------
// AgentDoorError (base)
// ---------------------------------------------------------------------------

describe("AgentDoorError", () => {
  it("instantiates with message, code, and statusCode", () => {
    const err = new AgentDoorError("test error", "TEST_CODE", 418);
    expect(err.message).toBe("test error");
    expect(err.code).toBe("TEST_CODE");
    expect(err.statusCode).toBe(418);
    expect(err.name).toBe("AgentDoorError");
  });

  it("defaults code to AGENTDOOR_ERROR", () => {
    const err = new AgentDoorError("test");
    expect(err.code).toBe("AGENTDOOR_ERROR");
  });

  it("defaults statusCode to 500", () => {
    const err = new AgentDoorError("test");
    expect(err.statusCode).toBe(500);
  });

  it("supports optional details", () => {
    const err = new AgentDoorError("test", "CODE", 500, { key: "value" });
    expect(err.details).toEqual({ key: "value" });
  });

  it("is instanceof Error", () => {
    const err = new AgentDoorError("test");
    expect(err).toBeInstanceOf(Error);
  });

  it("is instanceof AgentDoorError", () => {
    const err = new AgentDoorError("test");
    expect(err).toBeInstanceOf(AgentDoorError);
  });

  it("has a stack trace", () => {
    const err = new AgentDoorError("test");
    expect(err.stack).toBeDefined();
  });

  describe("toJSON", () => {
    it("serializes to JSON response format", () => {
      const err = new AgentDoorError("test error", "TEST_CODE", 400);
      const json = err.toJSON();
      expect(json).toEqual({
        error: {
          code: "TEST_CODE",
          message: "test error",
        },
      });
    });

    it("includes details when present", () => {
      const err = new AgentDoorError("test", "CODE", 500, { foo: "bar" });
      const json = err.toJSON();
      expect(json.error).toHaveProperty("details");
      expect((json.error as Record<string, unknown>).details).toEqual({ foo: "bar" });
    });

    it("omits details when not present", () => {
      const err = new AgentDoorError("test", "CODE", 500);
      const json = err.toJSON();
      expect(json.error).not.toHaveProperty("details");
    });
  });
});

// ---------------------------------------------------------------------------
// InvalidSignatureError
// ---------------------------------------------------------------------------

describe("InvalidSignatureError", () => {
  it("has correct defaults", () => {
    const err = new InvalidSignatureError();
    expect(err.message).toBe("Invalid signature");
    expect(err.code).toBe("INVALID_SIGNATURE");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("InvalidSignatureError");
  });

  it("accepts custom message", () => {
    const err = new InvalidSignatureError("bad sig");
    expect(err.message).toBe("bad sig");
  });

  it("is instanceof AgentDoorError", () => {
    const err = new InvalidSignatureError();
    expect(err).toBeInstanceOf(AgentDoorError);
  });

  it("is instanceof Error", () => {
    const err = new InvalidSignatureError();
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// ChallengeExpiredError
// ---------------------------------------------------------------------------

describe("ChallengeExpiredError", () => {
  it("has correct defaults", () => {
    const err = new ChallengeExpiredError();
    expect(err.message).toBe("Challenge has expired");
    expect(err.code).toBe("CHALLENGE_EXPIRED");
    expect(err.statusCode).toBe(410);
    expect(err.name).toBe("ChallengeExpiredError");
  });

  it("is instanceof AgentDoorError", () => {
    const err = new ChallengeExpiredError();
    expect(err).toBeInstanceOf(AgentDoorError);
  });
});

// ---------------------------------------------------------------------------
// AgentNotFoundError
// ---------------------------------------------------------------------------

describe("AgentNotFoundError", () => {
  it("has correct defaults", () => {
    const err = new AgentNotFoundError();
    expect(err.message).toBe("Agent not found");
    expect(err.code).toBe("AGENT_NOT_FOUND");
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe("AgentNotFoundError");
  });

  it("is instanceof AgentDoorError", () => {
    const err = new AgentNotFoundError();
    expect(err).toBeInstanceOf(AgentDoorError);
  });
});

// ---------------------------------------------------------------------------
// RateLimitExceededError
// ---------------------------------------------------------------------------

describe("RateLimitExceededError", () => {
  it("converts ms to seconds", () => {
    const err = new RateLimitExceededError(5000);
    expect(err.retryAfter).toBe(5);
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(err.name).toBe("RateLimitExceededError");
  });

  it("rounds up to nearest second", () => {
    const err = new RateLimitExceededError(1500);
    expect(err.retryAfter).toBe(2);
  });

  it("includes retry_after in details", () => {
    const err = new RateLimitExceededError(3000);
    expect(err.details).toEqual({ retry_after: 3 });
  });

  it("includes retry_after in default message", () => {
    const err = new RateLimitExceededError(10000);
    expect(err.message).toContain("10 seconds");
  });

  it("accepts custom message", () => {
    const err = new RateLimitExceededError(1000, "slow down");
    expect(err.message).toBe("slow down");
  });

  it("is instanceof AgentDoorError", () => {
    const err = new RateLimitExceededError(1000);
    expect(err).toBeInstanceOf(AgentDoorError);
  });
});

// ---------------------------------------------------------------------------
// InvalidConfigError
// ---------------------------------------------------------------------------

describe("InvalidConfigError", () => {
  it("prepends standard prefix to message", () => {
    const err = new InvalidConfigError("missing scopes");
    expect(err.message).toBe("Invalid AgentDoor configuration: missing scopes");
    expect(err.code).toBe("INVALID_CONFIG");
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe("InvalidConfigError");
  });

  it("includes details", () => {
    const err = new InvalidConfigError("bad", { field: "scopes" });
    expect(err.details).toEqual({ field: "scopes" });
  });

  it("is instanceof AgentDoorError", () => {
    const err = new InvalidConfigError("test");
    expect(err).toBeInstanceOf(AgentDoorError);
  });
});

// ---------------------------------------------------------------------------
// DuplicateAgentError
// ---------------------------------------------------------------------------

describe("DuplicateAgentError", () => {
  it("has correct defaults", () => {
    const err = new DuplicateAgentError();
    expect(err.message).toContain("already registered");
    expect(err.code).toBe("DUPLICATE_AGENT");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("DuplicateAgentError");
  });

  it("accepts custom message", () => {
    const err = new DuplicateAgentError("duplicate key");
    expect(err.message).toBe("duplicate key");
  });

  it("is instanceof AgentDoorError", () => {
    const err = new DuplicateAgentError();
    expect(err).toBeInstanceOf(AgentDoorError);
  });
});

// ---------------------------------------------------------------------------
// InvalidScopeError
// ---------------------------------------------------------------------------

describe("InvalidScopeError", () => {
  it("lists invalid scopes in message", () => {
    const err = new InvalidScopeError(["admin.write", "secret.read"]);
    expect(err.message).toContain("admin.write");
    expect(err.message).toContain("secret.read");
    expect(err.code).toBe("INVALID_SCOPE");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("InvalidScopeError");
  });

  it("stores invalid scopes array", () => {
    const err = new InvalidScopeError(["bad.scope"]);
    expect(err.invalidScopes).toEqual(["bad.scope"]);
  });

  it("includes invalid_scopes in details", () => {
    const err = new InvalidScopeError(["a", "b"]);
    expect(err.details).toEqual({ invalid_scopes: ["a", "b"] });
  });

  it("is instanceof AgentDoorError", () => {
    const err = new InvalidScopeError(["test"]);
    expect(err).toBeInstanceOf(AgentDoorError);
  });
});

// ---------------------------------------------------------------------------
// InvalidTokenError
// ---------------------------------------------------------------------------

describe("InvalidTokenError", () => {
  it("has correct defaults", () => {
    const err = new InvalidTokenError();
    expect(err.message).toBe("Invalid or expired token");
    expect(err.code).toBe("INVALID_TOKEN");
    expect(err.statusCode).toBe(401);
    expect(err.name).toBe("InvalidTokenError");
  });

  it("is instanceof AgentDoorError", () => {
    const err = new InvalidTokenError();
    expect(err).toBeInstanceOf(AgentDoorError);
  });
});

// ---------------------------------------------------------------------------
// AgentSuspendedError
// ---------------------------------------------------------------------------

describe("AgentSuspendedError", () => {
  it("includes agent ID and status in message", () => {
    const err = new AgentSuspendedError("ag_123", "suspended");
    expect(err.message).toContain("ag_123");
    expect(err.message).toContain("suspended");
    expect(err.code).toBe("AGENT_SUSPENDED");
    expect(err.statusCode).toBe(403);
    expect(err.name).toBe("AgentSuspendedError");
  });

  it("includes agent_id and status in details", () => {
    const err = new AgentSuspendedError("ag_456", "banned");
    expect(err.details).toEqual({ agent_id: "ag_456", status: "banned" });
  });

  it("is instanceof AgentDoorError", () => {
    const err = new AgentSuspendedError("ag_123", "suspended");
    expect(err).toBeInstanceOf(AgentDoorError);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: all error types
// ---------------------------------------------------------------------------

describe("Error hierarchy", () => {
  const errors = [
    new InvalidSignatureError(),
    new ChallengeExpiredError(),
    new AgentNotFoundError(),
    new RateLimitExceededError(1000),
    new InvalidConfigError("test"),
    new DuplicateAgentError(),
    new InvalidScopeError(["test"]),
    new InvalidTokenError(),
    new AgentSuspendedError("ag_1", "banned"),
  ];

  it("all are instanceof AgentDoorError", () => {
    for (const err of errors) {
      expect(err).toBeInstanceOf(AgentDoorError);
    }
  });

  it("all are instanceof Error", () => {
    for (const err of errors) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("all have toJSON method", () => {
    for (const err of errors) {
      const json = err.toJSON();
      expect(json).toHaveProperty("error");
      expect(json.error).toHaveProperty("code");
      expect(json.error).toHaveProperty("message");
    }
  });

  it("all have distinct error codes", () => {
    const codes = errors.map((e) => e.code);
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(codes.length);
  });
});
