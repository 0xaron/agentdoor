/**
 * Local Ed25519 keypair management.
 *
 * Generates Ed25519 keypairs using tweetnacl.
 * Saves and loads from a configurable file path (default: ~/.agentgate/keys.json).
 * Auto-generates a keypair if none exists on disk.
 */

import nacl from "tweetnacl";
import {
  encodeBase64,
  decodeBase64,
} from "tweetnacl-util";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/** Serialized keypair stored on disk. */
export interface StoredKeypair {
  publicKey: string;   // base64-encoded 32-byte public key
  secretKey: string;   // base64-encoded 64-byte secret key
  createdAt: string;   // ISO-8601 timestamp
}

/** In-memory keypair with raw Uint8Arrays alongside base64 representations. */
export interface Keypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  publicKeyBase64: string;
  secretKeyBase64: string;
}

/**
 * Resolve a key file path, expanding `~` to the user's home directory.
 */
function resolvePath(filePath: string): string {
  if (filePath.startsWith("~/") || filePath === "~") {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return path.resolve(filePath);
}

/**
 * Default key file path: ~/.agentgate/keys.json
 */
export const DEFAULT_KEY_PATH = "~/.agentgate/keys.json";

/**
 * Generate a fresh Ed25519 keypair.
 */
export function generateKeypair(): Keypair {
  const kp = nacl.sign.keyPair();
  return {
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    publicKeyBase64: encodeBase64(kp.publicKey),
    secretKeyBase64: encodeBase64(kp.secretKey),
  };
}

/**
 * Save a keypair to disk as JSON.
 * Creates parent directories if they don't exist.
 */
export function saveKeypair(keypair: Keypair, filePath: string): void {
  const resolved = resolvePath(filePath);
  const dir = path.dirname(resolved);

  fs.mkdirSync(dir, { recursive: true });

  const stored: StoredKeypair = {
    publicKey: keypair.publicKeyBase64,
    secretKey: keypair.secretKeyBase64,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(resolved, JSON.stringify(stored, null, 2), {
    encoding: "utf-8",
    mode: 0o600, // Owner read/write only -- secret key material
  });
}

/**
 * Load a keypair from disk.
 * Returns null if the file does not exist.
 * Throws if the file exists but is malformed.
 */
export function loadKeypair(filePath: string): Keypair | null {
  const resolved = resolvePath(filePath);

  if (!fs.existsSync(resolved)) {
    return null;
  }

  const raw = fs.readFileSync(resolved, "utf-8");

  let stored: StoredKeypair;
  try {
    stored = JSON.parse(raw) as StoredKeypair;
  } catch {
    throw new Error(`AgentGate: Invalid keypair file at ${resolved} -- failed to parse JSON`);
  }

  if (!stored.publicKey || !stored.secretKey) {
    throw new Error(
      `AgentGate: Keypair file at ${resolved} is missing required fields (publicKey, secretKey)`,
    );
  }

  const publicKey = decodeBase64(stored.publicKey);
  const secretKey = decodeBase64(stored.secretKey);

  if (publicKey.length !== 32) {
    throw new Error(
      `AgentGate: Invalid public key length (${publicKey.length} bytes, expected 32) in ${resolved}`,
    );
  }
  if (secretKey.length !== 64) {
    throw new Error(
      `AgentGate: Invalid secret key length (${secretKey.length} bytes, expected 64) in ${resolved}`,
    );
  }

  return {
    publicKey,
    secretKey,
    publicKeyBase64: stored.publicKey,
    secretKeyBase64: stored.secretKey,
  };
}

/**
 * Load an existing keypair from disk, or generate and save a new one
 * if none exists.
 */
export function loadOrCreateKeypair(filePath: string = DEFAULT_KEY_PATH): Keypair {
  const existing = loadKeypair(filePath);
  if (existing) {
    return existing;
  }

  const keypair = generateKeypair();
  saveKeypair(keypair, filePath);
  return keypair;
}

/**
 * Sign an arbitrary message with the agent's secret key.
 * Returns the detached signature as a base64 string.
 */
export function signMessage(message: string, secretKey: Uint8Array): string {
  const messageBytes = new TextEncoder().encode(message);
  const signature = nacl.sign.detached(messageBytes, secretKey);
  return encodeBase64(signature);
}

/**
 * Verify a detached Ed25519 signature.
 */
export function verifySignature(
  message: string,
  signatureBase64: string,
  publicKey: Uint8Array,
): boolean {
  const messageBytes = new TextEncoder().encode(message);
  const signature = decodeBase64(signatureBase64);
  return nacl.sign.detached.verify(messageBytes, signature, publicKey);
}
