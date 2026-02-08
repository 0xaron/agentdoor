import { describe, it, expect } from "vitest";
import {
  generateKeypair,
  signChallenge,
  verifySignature,
  generateAgentId,
  generateApiKey,
  hashApiKey,
  generateNonce,
  sha256,
  encodeBase64,
  decodeBase64,
} from "../index.js";

describe("generateKeypair", () => {
  it("returns an object with publicKey and secretKey", () => {
    const kp = generateKeypair();
    expect(kp).toHaveProperty("publicKey");
    expect(kp).toHaveProperty("secretKey");
    expect(typeof kp.publicKey).toBe("string");
    expect(typeof kp.secretKey).toBe("string");
  });

  it("publicKey decodes to 32 bytes", () => {
    const kp = generateKeypair();
    const pubBytes = decodeBase64(kp.publicKey);
    expect(pubBytes.length).toBe(32);
  });

  it("secretKey decodes to 64 bytes", () => {
    const kp = generateKeypair();
    const secBytes = decodeBase64(kp.secretKey);
    expect(secBytes.length).toBe(64);
  });

  it("generates unique keypairs on each call", () => {
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    expect(kp1.publicKey).not.toBe(kp2.publicKey);
    expect(kp1.secretKey).not.toBe(kp2.secretKey);
  });
});

describe("signChallenge", () => {
  it("returns a base64-encoded signature string", () => {
    const kp = generateKeypair();
    const sig = signChallenge("hello world", kp.secretKey);
    expect(typeof sig).toBe("string");
    // Base64 signature should decode to 64 bytes (Ed25519)
    const sigBytes = decodeBase64(sig);
    expect(sigBytes.length).toBe(64);
  });

  it("produces different signatures for different messages", () => {
    const kp = generateKeypair();
    const sig1 = signChallenge("message one", kp.secretKey);
    const sig2 = signChallenge("message two", kp.secretKey);
    expect(sig1).not.toBe(sig2);
  });
});

describe("verifySignature", () => {
  it("returns true for a valid signature", () => {
    const kp = generateKeypair();
    const message = "test message";
    const sig = signChallenge(message, kp.secretKey);
    expect(verifySignature(message, sig, kp.publicKey)).toBe(true);
  });

  it("returns false for an invalid signature", () => {
    const kp = generateKeypair();
    const message = "test message";
    const sig = signChallenge(message, kp.secretKey);
    expect(verifySignature("wrong message", sig, kp.publicKey)).toBe(false);
  });

  it("returns false for a wrong public key", () => {
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    const message = "test message";
    const sig = signChallenge(message, kp1.secretKey);
    expect(verifySignature(message, sig, kp2.publicKey)).toBe(false);
  });

  it("returns false for malformed inputs without throwing", () => {
    expect(verifySignature("msg", "not-valid-base64!!!", "also-bad")).toBe(false);
  });
});

describe("generateAgentId", () => {
  it("returns a string starting with 'ag_'", () => {
    const id = generateAgentId();
    expect(id.startsWith("ag_")).toBe(true);
  });

  it("generates unique IDs on each call", () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateAgentId()));
    expect(ids.size).toBe(10);
  });
});

describe("generateApiKey", () => {
  it("defaults to live mode with 'agk_live_' prefix", () => {
    const key = generateApiKey();
    expect(key.startsWith("agk_live_")).toBe(true);
  });

  it("returns 'agk_live_' prefix in live mode", () => {
    const key = generateApiKey("live");
    expect(key.startsWith("agk_live_")).toBe(true);
  });

  it("returns 'agk_test_' prefix in test mode", () => {
    const key = generateApiKey("test");
    expect(key.startsWith("agk_test_")).toBe(true);
  });

  it("generates unique keys", () => {
    const k1 = generateApiKey();
    const k2 = generateApiKey();
    expect(k1).not.toBe(k2);
  });
});

describe("hashApiKey", () => {
  it("returns a hex string", () => {
    const hash = hashApiKey("agk_live_test123");
    expect(typeof hash).toBe("string");
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic for the same input", () => {
    const key = "agk_live_samekey";
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  it("produces different hashes for different keys", () => {
    expect(hashApiKey("key_a")).not.toBe(hashApiKey("key_b"));
  });
});

describe("generateNonce", () => {
  it("returns a string", () => {
    const nonce = generateNonce();
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBeGreaterThan(0);
  });

  it("generates unique nonces", () => {
    const n1 = generateNonce();
    const n2 = generateNonce();
    expect(n1).not.toBe(n2);
  });
});

describe("sha256", () => {
  it("returns a hex string", async () => {
    const hash = await sha256("hello");
    expect(typeof hash).toBe("string");
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic for the same input", async () => {
    const h1 = await sha256("deterministic");
    const h2 = await sha256("deterministic");
    expect(h1).toBe(h2);
  });

  it("produces different hashes for different inputs", async () => {
    const h1 = await sha256("alpha");
    const h2 = await sha256("beta");
    expect(h1).not.toBe(h2);
  });
});

describe("encodeBase64 / decodeBase64 round-trip", () => {
  it("round-trips arbitrary bytes", () => {
    const original = new Uint8Array([0, 1, 2, 128, 255]);
    const encoded = encodeBase64(original);
    expect(typeof encoded).toBe("string");
    const decoded = decodeBase64(encoded);
    expect(decoded).toEqual(original);
  });

  it("round-trips an empty array", () => {
    const original = new Uint8Array([]);
    const encoded = encodeBase64(original);
    const decoded = decodeBase64(encoded);
    expect(decoded).toEqual(original);
  });
});
