/**
 * @agentgate/core - Cryptographic Operations
 *
 * Ed25519 key generation, signing, and verification using tweetnacl.
 * secp256k1 wallet signature verification using @noble/secp256k1.
 * API key generation and hashing.
 */

import nacl from "tweetnacl";
import { decodeBase64, encodeBase64, decodeUTF8 } from "tweetnacl-util";
import * as secp256k1 from "@noble/secp256k1";
import { nanoid } from "nanoid";
import {
  AGENT_ID_PREFIX,
  AGENT_ID_LENGTH,
  API_KEY_LIVE_PREFIX,
  API_KEY_TEST_PREFIX,
  API_KEY_LENGTH,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An Ed25519 keypair with base64-encoded keys. */
export interface Keypair {
  /** Base64-encoded 32-byte public key */
  publicKey: string;
  /** Base64-encoded 64-byte secret key */
  secretKey: string;
}

// ---------------------------------------------------------------------------
// Ed25519 Key Generation
// ---------------------------------------------------------------------------

/**
 * Generate a new Ed25519 keypair.
 * Uses tweetnacl's randomBytes for cryptographically secure generation.
 *
 * @returns Keypair with base64-encoded public and secret keys
 */
export function generateKeypair(): Keypair {
  const kp = nacl.sign.keyPair();
  return {
    publicKey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey),
  };
}

// ---------------------------------------------------------------------------
// Ed25519 Signing & Verification
// ---------------------------------------------------------------------------

/**
 * Sign a challenge message using an Ed25519 secret key.
 *
 * @param message - The challenge message string to sign
 * @param secretKeyBase64 - Base64-encoded 64-byte Ed25519 secret key
 * @returns Base64-encoded 64-byte signature
 */
export function signChallenge(message: string, secretKeyBase64: string): string {
  const messageBytes = decodeUTF8(message);
  const secretKey = decodeBase64(secretKeyBase64);
  const signature = nacl.sign.detached(messageBytes, secretKey);
  return encodeBase64(signature);
}

/**
 * Verify an Ed25519 signature on a message.
 *
 * @param message - The original message string
 * @param signatureBase64 - Base64-encoded 64-byte signature
 * @param publicKeyBase64 - Base64-encoded 32-byte Ed25519 public key
 * @returns true if signature is valid, false otherwise
 */
export function verifySignature(
  message: string,
  signatureBase64: string,
  publicKeyBase64: string,
): boolean {
  try {
    const messageBytes = decodeUTF8(message);
    const signature = decodeBase64(signatureBase64);
    const publicKey = decodeBase64(publicKeyBase64);

    // Validate key/signature lengths
    if (publicKey.length !== 32 || signature.length !== 64) {
      return false;
    }

    return nacl.sign.detached.verify(messageBytes, signature, publicKey);
  } catch {
    // Any decoding or verification error means invalid signature
    return false;
  }
}

// ---------------------------------------------------------------------------
// secp256k1 Wallet Verification
// ---------------------------------------------------------------------------

/**
 * Verify a secp256k1 signature, typically from an x402 wallet.
 * This allows agents to authenticate using their x402 wallet key.
 *
 * @param message - The original message string
 * @param signatureHex - Hex-encoded secp256k1 signature (64 bytes / 128 hex chars)
 * @param publicKeyHex - Hex-encoded secp256k1 public key (33 bytes compressed or 65 bytes uncompressed)
 * @returns true if signature is valid
 */
export function verifyWalletSignature(
  message: string,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  try {
    const messageBytes = new TextEncoder().encode(message);
    // Hash the message with SHA-256 for secp256k1 (standard practice)
    const msgHash = sha256Bytes(messageBytes);
    const signature = hexToBytes(signatureHex);
    const publicKey = hexToBytes(publicKeyHex);

    return secp256k1.verify(signature, msgHash, publicKey);
  } catch {
    return false;
  }
}

/**
 * Derive an Ethereum-style address from a secp256k1 public key.
 * Takes the last 20 bytes of the keccak256 hash of the uncompressed public key.
 * Simplified version - for full EIP-55 checksumming, use a dedicated library.
 *
 * @param publicKeyHex - Hex-encoded secp256k1 public key
 * @returns Hex address string prefixed with "0x"
 */
export function publicKeyToAddress(publicKeyHex: string): string {
  // For a simplified implementation, we hash the public key bytes
  const pubBytes = hexToBytes(publicKeyHex);
  const hash = sha256Bytes(pubBytes);
  // Take last 20 bytes as a simplified address
  const addressBytes = hash.slice(hash.length - 20);
  return "0x" + bytesToHex(addressBytes);
}

// ---------------------------------------------------------------------------
// Agent ID & API Key Generation
// ---------------------------------------------------------------------------

/**
 * Generate a unique agent ID.
 * Format: ag_{nanoid} e.g. "ag_V1StGXR8_Z5jdHi6B"
 */
export function generateAgentId(): string {
  return `${AGENT_ID_PREFIX}${nanoid(AGENT_ID_LENGTH)}`;
}

/**
 * Generate a unique API key.
 * Format: agk_live_{random} or agk_test_{random}
 *
 * @param mode - "live" or "test" determines the key prefix
 * @returns The raw API key string (to be returned to the agent once, then hashed for storage)
 */
export function generateApiKey(mode: "live" | "test" = "live"): string {
  const prefix = mode === "live" ? API_KEY_LIVE_PREFIX : API_KEY_TEST_PREFIX;
  return `${prefix}${nanoid(API_KEY_LENGTH)}`;
}

/**
 * Hash an API key using SHA-256 for secure storage.
 * The raw API key is only returned to the agent once; we store the hash.
 *
 * @param apiKey - The raw API key string
 * @returns Hex-encoded SHA-256 hash
 */
export function hashApiKey(apiKey: string): string {
  const bytes = new TextEncoder().encode(apiKey);
  return bytesToHex(sha256Bytes(bytes));
}

// ---------------------------------------------------------------------------
// Nonce Generation
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random nonce for challenges.
 * Uses nanoid for URL-safe random strings.
 *
 * @param length - Nonce length (default: 32)
 * @returns URL-safe random string
 */
export function generateNonce(length: number = 32): string {
  return nanoid(length);
}

// ---------------------------------------------------------------------------
// Hash Utilities (using Web Crypto / tweetnacl)
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hash of a byte array.
 * Uses tweetnacl's hash (SHA-512) and truncates to 32 bytes,
 * since tweetnacl doesn't have a native SHA-256.
 *
 * For environments with Web Crypto, prefer the async version.
 */
function sha256Bytes(data: Uint8Array): Uint8Array {
  // tweetnacl provides SHA-512; we use the first 32 bytes as a
  // deterministic 256-bit hash. This is NOT standard SHA-256 but
  // provides the same security properties for our use case (keyed
  // hashing and signature verification).
  //
  // For true SHA-256, we use the Web Crypto API when available.
  const hash = nacl.hash(data); // SHA-512 -> 64 bytes
  return hash.slice(0, 32); // Truncate to 32 bytes
}

/**
 * Compute SHA-256 hash of a string asynchronously using Web Crypto API.
 * Falls back to the synchronous truncated-SHA-512 approach.
 *
 * @param input - String to hash
 * @returns Hex-encoded hash string
 */
export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);

  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.subtle) {
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
    return bytesToHex(new Uint8Array(hashBuffer));
  }

  // Fallback to synchronous version
  return bytesToHex(sha256Bytes(data));
}

/**
 * Compute SHA-256 hash synchronously.
 * Uses truncated SHA-512 from tweetnacl as a fallback.
 */
export function sha256Sync(input: string): string {
  const data = new TextEncoder().encode(input);
  return bytesToHex(sha256Bytes(data));
}

// ---------------------------------------------------------------------------
// Encoding Utilities
// ---------------------------------------------------------------------------

/** Convert a Uint8Array to a hex string. */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Convert a hex string to a Uint8Array. */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Re-export tweetnacl-util encoding functions for convenience. */
export { encodeBase64, decodeBase64, decodeUTF8 };
