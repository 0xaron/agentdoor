/**
 * `agentdoor keygen` — Generate an Ed25519 keypair for agent authentication.
 *
 * Saves the keypair to ~/.agentdoor/keys.json. This is primarily used by
 * agent developers (demand-side) to create a persistent identity for their
 * agent, but can also be used for testing on the supply-side.
 */

import { Command } from "commander";
import chalk from "chalk";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes as _randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KeygenOptions {
  output?: string;
  force?: boolean;
  format?: "json" | "pem";
}

interface KeypairJson {
  algorithm: string;
  publicKey: string;
  secretKey: string;
  createdAt: string;
  fingerprint: string;
}

// ---------------------------------------------------------------------------
// Ed25519 keypair generation using Node.js crypto
// ---------------------------------------------------------------------------

async function generateEd25519Keypair(): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array }> {
  // Use the Web Crypto API if available (Node 20+, Deno, Bun).
  if (typeof globalThis.crypto?.subtle?.generateKey === "function") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
        "sign",
        "verify",
      ]) as any;

      const publicKeyRaw = new Uint8Array(
        await crypto.subtle.exportKey("raw", keyPair.publicKey),
      );

      // PKCS8 export for secret key — extract the raw 32-byte seed from it.
      const pkcs8 = new Uint8Array(
        await crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
      );
      // The raw Ed25519 seed is the last 32 bytes of the PKCS8 encoding.
      const secretKey = pkcs8.slice(pkcs8.length - 32);

      // Return 64-byte secret key (seed || public) for NaCl compat.
      const fullSecretKey = new Uint8Array(64);
      fullSecretKey.set(secretKey);
      fullSecretKey.set(publicKeyRaw, 32);

      return { publicKey: publicKeyRaw, secretKey: fullSecretKey };
    } catch {
      // Fall through to Node.js crypto fallback.
    }
  }

  // Fallback: use Node.js crypto module.
  const { generateKeyPairSync } = await import("node:crypto");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  const pubDer = publicKey.export({ type: "spki", format: "der" });
  const privDer = privateKey.export({ type: "pkcs8", format: "der" });

  // Extract raw 32-byte keys from DER encoding.
  const pubRaw = new Uint8Array(pubDer.slice(pubDer.length - 32));
  const privRaw = new Uint8Array(privDer.slice(privDer.length - 32));

  // NaCl-compat 64-byte secret key.
  const fullSecretKey = new Uint8Array(64);
  fullSecretKey.set(privRaw);
  fullSecretKey.set(pubRaw, 32);

  return { publicKey: pubRaw, secretKey: fullSecretKey };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function sha256Hex(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getDefaultKeyPath(): string {
  return join(homedir(), ".agentdoor", "keys.json");
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerKeygenCommand(program: Command): void {
  program
    .command("keygen")
    .description("Generate an Ed25519 keypair for agent authentication")
    .option("-o, --output <path>", "Output path for the keypair file")
    .option("-f, --force", "Overwrite existing keypair without prompting")
    .option("--format <format>", "Output format: json (default) or pem", "json")
    .action(async (options: KeygenOptions) => {
      const keyPath = options.output ?? getDefaultKeyPath();
      const keyDir = join(keyPath, "..");

      console.log(chalk.bold.cyan("\n  AgentDoor Keygen\n"));

      // Check for existing keys.
      if (existsSync(keyPath) && !options.force) {
        console.log(chalk.yellow(`  Keypair already exists at: ${keyPath}`));
        console.log(chalk.dim("  Use --force to overwrite.\n"));

        // Show existing public key.
        try {
          const existing = JSON.parse(await readFile(keyPath, "utf-8")) as KeypairJson;
          console.log(chalk.white(`  Public key: ${existing.publicKey}`));
          console.log(chalk.dim(`  Fingerprint: ${existing.fingerprint}`));
          console.log(chalk.dim(`  Created: ${existing.createdAt}\n`));
        } catch {
          console.log(chalk.dim("  (Could not read existing keypair)\n"));
        }

        return;
      }

      console.log(chalk.dim("  Generating Ed25519 keypair..."));

      const keypair = await generateEd25519Keypair();
      const publicKeyB64 = toBase64(keypair.publicKey);
      const secretKeyB64 = toBase64(keypair.secretKey);
      const fingerprint = (await sha256Hex(publicKeyB64)).slice(0, 16);

      const keyData: KeypairJson = {
        algorithm: "Ed25519",
        publicKey: publicKeyB64,
        secretKey: secretKeyB64,
        createdAt: new Date().toISOString(),
        fingerprint,
      };

      // Ensure directory exists.
      await mkdir(keyDir, { recursive: true });

      if (options.format === "pem") {
        // Write PEM format for interop.
        const pubPem = `-----BEGIN PUBLIC KEY-----\n${publicKeyB64}\n-----END PUBLIC KEY-----\n`;
        const privPem = `-----BEGIN PRIVATE KEY-----\n${secretKeyB64}\n-----END PRIVATE KEY-----\n`;

        const pemPath = keyPath.replace(".json", "");
        await writeFile(`${pemPath}.pub`, pubPem, { mode: 0o644 });
        await writeFile(`${pemPath}.key`, privPem, { mode: 0o600 });

        console.log(chalk.green(`\n  Public key saved to:  ${pemPath}.pub`));
        console.log(chalk.green(`  Private key saved to: ${pemPath}.key`));
      } else {
        // Write JSON format (default).
        await writeFile(keyPath, JSON.stringify(keyData, null, 2), {
          mode: 0o600, // Owner read/write only.
        });

        console.log(chalk.green(`\n  Keypair saved to: ${keyPath}`));
      }

      console.log(chalk.white(`  Public key: ${publicKeyB64}`));
      console.log(chalk.dim(`  Fingerprint: ${fingerprint}`));
      console.log(chalk.yellow("\n  Never share your private key!\n"));
    });
}
