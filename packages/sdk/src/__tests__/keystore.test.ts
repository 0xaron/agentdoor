import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  generateKeypair,
  saveKeypair,
  loadKeypair,
  loadOrCreateKeypair,
  signMessage,
  verifySignature,
} from "../keystore.js";

const tmpDir = path.join(os.tmpdir(), `agentgate-test-${Date.now()}`);

afterEach(() => {
  // Clean up temp directory after each test
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("generateKeypair", () => {
  it("returns a Keypair with the correct structure", () => {
    const kp = generateKeypair();

    expect(kp).toHaveProperty("publicKey");
    expect(kp).toHaveProperty("secretKey");
    expect(kp).toHaveProperty("publicKeyBase64");
    expect(kp).toHaveProperty("secretKeyBase64");
  });

  it("returns a publicKey that is a Uint8Array of 32 bytes", () => {
    const kp = generateKeypair();

    expect(kp.publicKey).toBeInstanceOf(Uint8Array);
    expect(kp.publicKey.length).toBe(32);
  });

  it("returns a secretKey that is a Uint8Array of 64 bytes", () => {
    const kp = generateKeypair();

    expect(kp.secretKey).toBeInstanceOf(Uint8Array);
    expect(kp.secretKey.length).toBe(64);
  });

  it("returns base64-encoded strings for publicKeyBase64 and secretKeyBase64", () => {
    const kp = generateKeypair();

    expect(typeof kp.publicKeyBase64).toBe("string");
    expect(kp.publicKeyBase64.length).toBeGreaterThan(0);

    expect(typeof kp.secretKeyBase64).toBe("string");
    expect(kp.secretKeyBase64.length).toBeGreaterThan(0);
  });

  it("generates unique keypairs on each call", () => {
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();

    expect(kp1.publicKeyBase64).not.toBe(kp2.publicKeyBase64);
    expect(kp1.secretKeyBase64).not.toBe(kp2.secretKeyBase64);
  });
});

describe("saveKeypair / loadKeypair round-trip", () => {
  it("saves and loads a keypair, with matching keys", () => {
    const kp = generateKeypair();
    const filePath = path.join(tmpDir, "keys.json");

    saveKeypair(kp, filePath);
    const loaded = loadKeypair(filePath);

    expect(loaded).not.toBeNull();
    expect(loaded!.publicKeyBase64).toBe(kp.publicKeyBase64);
    expect(loaded!.secretKeyBase64).toBe(kp.secretKeyBase64);
    expect(loaded!.publicKey).toEqual(kp.publicKey);
    expect(loaded!.secretKey).toEqual(kp.secretKey);
  });

  it("creates parent directories when saving", () => {
    const kp = generateKeypair();
    const filePath = path.join(tmpDir, "nested", "deep", "keys.json");

    saveKeypair(kp, filePath);

    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("saves the file with restricted permissions (0o600)", () => {
    const kp = generateKeypair();
    const filePath = path.join(tmpDir, "keys.json");

    saveKeypair(kp, filePath);

    const stats = fs.statSync(filePath);
    // Check owner read/write only (0o600 = 384 decimal)
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("stores valid JSON with publicKey, secretKey, and createdAt fields", () => {
    const kp = generateKeypair();
    const filePath = path.join(tmpDir, "keys.json");

    saveKeypair(kp, filePath);

    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);

    expect(parsed).toHaveProperty("publicKey", kp.publicKeyBase64);
    expect(parsed).toHaveProperty("secretKey", kp.secretKeyBase64);
    expect(parsed).toHaveProperty("createdAt");
    expect(typeof parsed.createdAt).toBe("string");
  });
});

describe("loadKeypair", () => {
  it("returns null for a non-existent path", () => {
    const result = loadKeypair(path.join(tmpDir, "nonexistent.json"));
    expect(result).toBeNull();
  });

  it("throws if the file contains invalid JSON", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, "bad.json");
    fs.writeFileSync(filePath, "not valid json {{{");

    expect(() => loadKeypair(filePath)).toThrow("failed to parse JSON");
  });

  it("throws if the file is missing required fields", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, "incomplete.json");
    fs.writeFileSync(filePath, JSON.stringify({ publicKey: "abc" }));

    expect(() => loadKeypair(filePath)).toThrow("missing required fields");
  });
});

describe("loadOrCreateKeypair", () => {
  it("creates a key file if it does not exist", () => {
    const filePath = path.join(tmpDir, "auto-keys.json");

    const kp = loadOrCreateKeypair(filePath);

    expect(kp.publicKey).toBeInstanceOf(Uint8Array);
    expect(kp.publicKey.length).toBe(32);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("returns the existing keypair if the file already exists", () => {
    const filePath = path.join(tmpDir, "existing-keys.json");

    const kp1 = loadOrCreateKeypair(filePath);
    const kp2 = loadOrCreateKeypair(filePath);

    expect(kp1.publicKeyBase64).toBe(kp2.publicKeyBase64);
    expect(kp1.secretKeyBase64).toBe(kp2.secretKeyBase64);
  });
});

describe("signMessage", () => {
  it("returns a base64-encoded signature string", () => {
    const kp = generateKeypair();
    const message = "hello world";

    const signature = signMessage(message, kp.secretKey);

    expect(typeof signature).toBe("string");
    expect(signature.length).toBeGreaterThan(0);
  });

  it("produces different signatures for different messages", () => {
    const kp = generateKeypair();

    const sig1 = signMessage("message one", kp.secretKey);
    const sig2 = signMessage("message two", kp.secretKey);

    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures with different keys", () => {
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    const message = "same message";

    const sig1 = signMessage(message, kp1.secretKey);
    const sig2 = signMessage(message, kp2.secretKey);

    expect(sig1).not.toBe(sig2);
  });
});

describe("verifySignature", () => {
  it("returns true for a valid signature", () => {
    const kp = generateKeypair();
    const message = "test message for verification";

    const signature = signMessage(message, kp.secretKey);
    const isValid = verifySignature(message, signature, kp.publicKey);

    expect(isValid).toBe(true);
  });

  it("returns false when the message has been tampered with", () => {
    const kp = generateKeypair();
    const message = "original message";

    const signature = signMessage(message, kp.secretKey);
    const isValid = verifySignature("tampered message", signature, kp.publicKey);

    expect(isValid).toBe(false);
  });

  it("returns false when verified with the wrong public key", () => {
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    const message = "test message";

    const signature = signMessage(message, kp1.secretKey);
    const isValid = verifySignature(message, signature, kp2.publicKey);

    expect(isValid).toBe(false);
  });

  it("round-trips sign and verify for an empty string", () => {
    const kp = generateKeypair();
    const message = "";

    const signature = signMessage(message, kp.secretKey);
    const isValid = verifySignature(message, signature, kp.publicKey);

    expect(isValid).toBe(true);
  });

  it("round-trips sign and verify for unicode content", () => {
    const kp = generateKeypair();
    const message = "Hello, world! Bonjour le monde!";

    const signature = signMessage(message, kp.secretKey);
    const isValid = verifySignature(message, signature, kp.publicKey);

    expect(isValid).toBe(true);
  });
});
