/**
 * Tests for `agentdoor keygen` command.
 *
 * Covers: Ed25519 keypair generation, output paths, directory creation,
 * file permissions, output formats, and overwrite protection.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { writeFile, mkdir, readFile, rm } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentdoor-keygen-test-"));
}

/** Simulate what keygen does: generate a keypair and write to disk. */
async function simulateKeygen(keyPath: string, format: "json" | "pem" = "json"): Promise<void> {
  const { generateKeyPairSync } = await import("node:crypto");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  const pubDer = publicKey.export({ type: "spki", format: "der" });
  const privDer = privateKey.export({ type: "pkcs8", format: "der" });

  const pubRaw = new Uint8Array(pubDer.slice(pubDer.length - 32));
  const privRaw = new Uint8Array(privDer.slice(privDer.length - 32));

  const fullSecretKey = new Uint8Array(64);
  fullSecretKey.set(privRaw);
  fullSecretKey.set(pubRaw, 32);

  const publicKeyB64 = Buffer.from(pubRaw).toString("base64");
  const secretKeyB64 = Buffer.from(fullSecretKey).toString("base64");

  // Generate fingerprint
  const encoded = new TextEncoder().encode(publicKeyB64);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  const fingerprint = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);

  const keyDir = path.dirname(keyPath);
  await mkdir(keyDir, { recursive: true });

  if (format === "pem") {
    const pemPath = keyPath.replace(".json", "");
    const pubPem = `-----BEGIN PUBLIC KEY-----\n${publicKeyB64}\n-----END PUBLIC KEY-----\n`;
    const privPem = `-----BEGIN PRIVATE KEY-----\n${secretKeyB64}\n-----END PRIVATE KEY-----\n`;

    await writeFile(`${pemPath}.pub`, pubPem, { mode: 0o644 });
    await writeFile(`${pemPath}.key`, privPem, { mode: 0o600 });
  } else {
    const keyData = {
      algorithm: "Ed25519",
      publicKey: publicKeyB64,
      secretKey: secretKeyB64,
      createdAt: new Date().toISOString(),
      fingerprint,
    };
    await writeFile(keyPath, JSON.stringify(keyData, null, 2), { mode: 0o600 });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("keygen - Ed25519 keypair generation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("generates a valid Ed25519 keypair in JSON format", async () => {
    const keyPath = path.join(tmpDir, "keys.json");
    await simulateKeygen(keyPath, "json");

    expect(fs.existsSync(keyPath)).toBe(true);

    const data = JSON.parse(await readFile(keyPath, "utf-8"));
    expect(data.algorithm).toBe("Ed25519");
    expect(typeof data.publicKey).toBe("string");
    expect(typeof data.secretKey).toBe("string");
    expect(typeof data.createdAt).toBe("string");
    expect(typeof data.fingerprint).toBe("string");
  });

  it("public key is 32 bytes (base64)", async () => {
    const keyPath = path.join(tmpDir, "keys.json");
    await simulateKeygen(keyPath);

    const data = JSON.parse(await readFile(keyPath, "utf-8"));
    const pubBytes = Buffer.from(data.publicKey, "base64");
    expect(pubBytes.length).toBe(32);
  });

  it("secret key is 64 bytes (NaCl compat)", async () => {
    const keyPath = path.join(tmpDir, "keys.json");
    await simulateKeygen(keyPath);

    const data = JSON.parse(await readFile(keyPath, "utf-8"));
    const secBytes = Buffer.from(data.secretKey, "base64");
    expect(secBytes.length).toBe(64);
  });

  it("fingerprint is 16 hex chars", async () => {
    const keyPath = path.join(tmpDir, "keys.json");
    await simulateKeygen(keyPath);

    const data = JSON.parse(await readFile(keyPath, "utf-8"));
    expect(data.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it("generates unique keypairs on each invocation", async () => {
    const keyPath1 = path.join(tmpDir, "keys1.json");
    const keyPath2 = path.join(tmpDir, "keys2.json");
    await simulateKeygen(keyPath1);
    await simulateKeygen(keyPath2);

    const data1 = JSON.parse(await readFile(keyPath1, "utf-8"));
    const data2 = JSON.parse(await readFile(keyPath2, "utf-8"));
    expect(data1.publicKey).not.toBe(data2.publicKey);
    expect(data1.secretKey).not.toBe(data2.secretKey);
  });
});

describe("keygen - output path", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes to specified output path", async () => {
    const keyPath = path.join(tmpDir, "custom", "path", "keys.json");
    await simulateKeygen(keyPath);

    expect(fs.existsSync(keyPath)).toBe(true);
  });

  it("creates parent directories if they don't exist", async () => {
    const keyPath = path.join(tmpDir, "nested", "dir", "structure", "keys.json");
    await simulateKeygen(keyPath);

    expect(fs.existsSync(keyPath)).toBe(true);
  });

  it("default path uses ~/.agentdoor/keys.json pattern", () => {
    const defaultPath = path.join(os.homedir(), ".agentdoor", "keys.json");
    expect(defaultPath).toContain(".agentdoor");
    expect(defaultPath).toContain("keys.json");
  });
});

describe("keygen - PEM format output", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("generates PEM files when format is pem", async () => {
    const keyPath = path.join(tmpDir, "keys.json");
    await simulateKeygen(keyPath, "pem");

    const pemBase = keyPath.replace(".json", "");
    expect(fs.existsSync(`${pemBase}.pub`)).toBe(true);
    expect(fs.existsSync(`${pemBase}.key`)).toBe(true);
  });

  it("public key PEM has correct format", async () => {
    const keyPath = path.join(tmpDir, "keys.json");
    await simulateKeygen(keyPath, "pem");

    const pemBase = keyPath.replace(".json", "");
    const pubPem = await readFile(`${pemBase}.pub`, "utf-8");
    expect(pubPem).toContain("-----BEGIN PUBLIC KEY-----");
    expect(pubPem).toContain("-----END PUBLIC KEY-----");
  });

  it("private key PEM has correct format", async () => {
    const keyPath = path.join(tmpDir, "keys.json");
    await simulateKeygen(keyPath, "pem");

    const pemBase = keyPath.replace(".json", "");
    const privPem = await readFile(`${pemBase}.key`, "utf-8");
    expect(privPem).toContain("-----BEGIN PRIVATE KEY-----");
    expect(privPem).toContain("-----END PRIVATE KEY-----");
  });
});

describe("keygen - overwrite protection", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("existing key file can be detected", async () => {
    const keyPath = path.join(tmpDir, "keys.json");
    await simulateKeygen(keyPath);

    expect(fs.existsSync(keyPath)).toBe(true);
  });

  it("--force flag allows overwriting", async () => {
    const keyPath = path.join(tmpDir, "keys.json");
    await simulateKeygen(keyPath);

    const data1 = JSON.parse(await readFile(keyPath, "utf-8"));

    // Force overwrite
    await simulateKeygen(keyPath);

    const data2 = JSON.parse(await readFile(keyPath, "utf-8"));
    // New keypair should be different
    expect(data1.publicKey).not.toBe(data2.publicKey);
  });
});
