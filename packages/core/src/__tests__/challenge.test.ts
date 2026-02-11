import { describe, it, expect } from "vitest";
import {
  createChallenge,
  verifyChallenge,
  buildRegistrationChallenge,
  buildAuthMessage,
  isChallengeExpired,
  parseChallengeMessage,
  generateKeypair,
  signChallenge,
  InvalidSignatureError,
  ChallengeExpiredError,
} from "../index.js";
import type { ChallengeData } from "../index.js";

describe("createChallenge", () => {
  it("returns ChallengeData with all expected fields", () => {
    const challenge = createChallenge("ag_test123");
    expect(challenge.agentId).toBe("ag_test123");
    expect(typeof challenge.nonce).toBe("string");
    expect(challenge.nonce.length).toBeGreaterThan(0);
    expect(typeof challenge.message).toBe("string");
    expect(challenge.message).toContain("agentdoor:register:");
    expect(challenge.expiresAt).toBeInstanceOf(Date);
    expect(challenge.createdAt).toBeInstanceOf(Date);
  });

  it("expiresAt is in the future", () => {
    const challenge = createChallenge("ag_test123");
    expect(challenge.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("respects custom expirySeconds", () => {
    const before = Date.now();
    const challenge = createChallenge("ag_test123", 60);
    const after = Date.now();
    // expiresAt should be roughly 60 seconds from now
    const expiresMs = challenge.expiresAt.getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + 59_000);
    expect(expiresMs).toBeLessThanOrEqual(after + 61_000);
  });
});

describe("verifyChallenge", () => {
  it("succeeds with a valid signature", () => {
    const kp = generateKeypair();
    const challenge = createChallenge("ag_test123");
    const sig = signChallenge(challenge.message, kp.secretKey);
    // Should not throw
    expect(() => verifyChallenge(challenge, sig, kp.publicKey)).not.toThrow();
  });

  it("throws InvalidSignatureError with a bad signature", () => {
    const kp = generateKeypair();
    const challenge = createChallenge("ag_test123");
    const badSig = signChallenge("wrong message", kp.secretKey);
    expect(() => verifyChallenge(challenge, badSig, kp.publicKey)).toThrow(
      InvalidSignatureError,
    );
  });

  it("throws ChallengeExpiredError when the challenge is expired", () => {
    const kp = generateKeypair();
    const challenge = createChallenge("ag_test123");
    // Manually set expiresAt to the past
    challenge.expiresAt = new Date(Date.now() - 1000);
    const sig = signChallenge(challenge.message, kp.secretKey);
    expect(() => verifyChallenge(challenge, sig, kp.publicKey)).toThrow(
      ChallengeExpiredError,
    );
  });
});

describe("buildRegistrationChallenge", () => {
  it("returns a formatted string", () => {
    const msg = buildRegistrationChallenge("ag_abc", 1700000000, "nonce123");
    expect(msg).toBe("agentdoor:register:ag_abc:1700000000:nonce123");
  });
});

describe("buildAuthMessage", () => {
  it("returns a formatted string", () => {
    const msg = buildAuthMessage("ag_abc", "2024-01-01T00:00:00Z");
    expect(msg).toBe("agentdoor:auth:ag_abc:2024-01-01T00:00:00Z");
  });
});

describe("isChallengeExpired", () => {
  it("returns false when expiresAt is in the future", () => {
    const challenge: ChallengeData = {
      agentId: "ag_test",
      nonce: "n",
      message: "m",
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    };
    expect(isChallengeExpired(challenge)).toBe(false);
  });

  it("returns true when expiresAt is in the past", () => {
    const challenge: ChallengeData = {
      agentId: "ag_test",
      nonce: "n",
      message: "m",
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
    };
    expect(isChallengeExpired(challenge)).toBe(true);
  });
});

describe("parseChallengeMessage", () => {
  it("parses a registration challenge message", () => {
    const msg = "agentdoor:register:ag_abc:1700000000:nonce123";
    const parsed = parseChallengeMessage(msg);
    expect(parsed).not.toBeNull();
    expect(parsed!.prefix).toBe("agentdoor");
    expect(parsed!.action).toBe("register");
    expect(parsed!.agentId).toBe("ag_abc");
    expect(parsed!.timestamp).toBe(1700000000);
    expect(parsed!.nonce).toBe("nonce123");
  });

  it("parses an auth challenge message", () => {
    const msg = "agentdoor:auth:ag_abc:1700000000";
    const parsed = parseChallengeMessage(msg);
    expect(parsed).not.toBeNull();
    expect(parsed!.prefix).toBe("agentdoor");
    expect(parsed!.action).toBe("auth");
    expect(parsed!.agentId).toBe("ag_abc");
    expect(parsed!.timestamp).toBe(1700000000);
    expect(parsed!.nonce).toBeUndefined();
  });

  it("returns null for invalid format", () => {
    expect(parseChallengeMessage("invalid")).toBeNull();
    expect(parseChallengeMessage("wrong:prefix:ag_abc:123")).toBeNull();
    expect(parseChallengeMessage("agentdoor:register:ag_abc:notanumber:nonce")).toBeNull();
  });
});
