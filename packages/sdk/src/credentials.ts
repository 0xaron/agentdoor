/**
 * File-based credential caching for AgentDoor SDK.
 *
 * Stores per-service credentials (api_key, token, scopes, expiration)
 * so that agents can skip re-registration on subsequent connections.
 *
 * Credentials are stored in a JSON file alongside the agent's key file,
 * keyed by the normalized service base URL.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/** Credentials stored for a single service. */
export interface ServiceCredentials {
  /** The agent ID assigned by the service. */
  agentId: string;
  /** The API key (e.g. "agk_live_xxx"). */
  apiKey: string;
  /** Short-lived JWT token for bearer auth. */
  token?: string;
  /** ISO-8601 timestamp when the token expires. */
  tokenExpiresAt?: string;
  /** Scopes granted by the service. */
  scopesGranted: string[];
  /** x402 payment config returned by the service. */
  x402?: {
    paymentAddress: string;
    network: string;
    currency: string;
  };
  /** Rate limit returned by the service. */
  rateLimit?: {
    requests: number;
    window: string;
  };
  /** ISO-8601 timestamp when these credentials were stored. */
  storedAt: string;
}

/** The full credentials file: a map of base URL -> credentials. */
interface CredentialsFile {
  version: 1;
  services: Record<string, ServiceCredentials>;
}

/**
 * Default credentials file path: ~/.agentdoor/credentials.json
 */
export const DEFAULT_CREDENTIALS_PATH = "~/.agentdoor/credentials.json";

/**
 * Resolve a file path, expanding `~` to the user's home directory.
 */
function resolvePath(filePath: string): string {
  if (filePath.startsWith("~/") || filePath === "~") {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return path.resolve(filePath);
}

/**
 * Normalize a base URL for use as a consistent cache key.
 */
function normalizeBaseUrl(url: string): string {
  let normalized = url.trim();
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = `https://${normalized}`;
  }
  return normalized.replace(/\/+$/, "");
}

/**
 * Read the credentials file from disk.
 * Returns an empty structure if the file doesn't exist.
 */
function readCredentialsFile(filePath: string): CredentialsFile {
  const resolved = resolvePath(filePath);

  if (!fs.existsSync(resolved)) {
    return { version: 1, services: {} };
  }

  const raw = fs.readFileSync(resolved, "utf-8");
  try {
    const parsed = JSON.parse(raw) as CredentialsFile;

    // Basic structure validation
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.services !== "object"
    ) {
      return { version: 1, services: {} };
    }

    return parsed;
  } catch {
    // If the file is corrupted, start fresh
    return { version: 1, services: {} };
  }
}

/**
 * Write the credentials file to disk.
 * Creates parent directories if needed.
 * File permissions: 0o600 (owner read/write only).
 */
function writeCredentialsFile(
  filePath: string,
  data: CredentialsFile,
): void {
  const resolved = resolvePath(filePath);
  const dir = path.dirname(resolved);

  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(resolved, JSON.stringify(data, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/**
 * Credential store that manages per-service credentials on disk.
 */
export class CredentialStore {
  private readonly filePath: string;

  constructor(filePath: string = DEFAULT_CREDENTIALS_PATH) {
    this.filePath = filePath;
  }

  /**
   * Get cached credentials for a service.
   * Returns null if no credentials are stored for this service.
   */
  get(baseUrl: string): ServiceCredentials | null {
    const key = normalizeBaseUrl(baseUrl);
    const file = readCredentialsFile(this.filePath);
    return file.services[key] ?? null;
  }

  /**
   * Check whether we have a valid (non-expired) token for a service.
   * If no token is present but an API key is, returns true
   * (API keys don't expire in the standard AgentDoor flow).
   */
  hasValidCredentials(baseUrl: string): boolean {
    const creds = this.get(baseUrl);
    if (!creds) {
      return false;
    }
    // API key is always valid if present
    if (creds.apiKey) {
      return true;
    }
    return false;
  }

  /**
   * Check whether the stored JWT token is still valid (not expired).
   */
  hasValidToken(baseUrl: string): boolean {
    const creds = this.get(baseUrl);
    if (!creds || !creds.token || !creds.tokenExpiresAt) {
      return false;
    }

    const expiresAt = new Date(creds.tokenExpiresAt).getTime();
    // Add a 30-second buffer to avoid using tokens that are about to expire
    const bufferMs = 30_000;
    return Date.now() < expiresAt - bufferMs;
  }

  /**
   * Store credentials for a service.
   * Overwrites any existing credentials for the same base URL.
   */
  save(baseUrl: string, credentials: ServiceCredentials): void {
    const key = normalizeBaseUrl(baseUrl);
    const file = readCredentialsFile(this.filePath);

    file.services[key] = {
      ...credentials,
      storedAt: new Date().toISOString(),
    };

    writeCredentialsFile(this.filePath, file);
  }

  /**
   * Update only the token fields for a service (used after token refresh).
   * Throws if no credentials exist for the service.
   */
  updateToken(
    baseUrl: string,
    token: string,
    tokenExpiresAt: string,
  ): void {
    const key = normalizeBaseUrl(baseUrl);
    const file = readCredentialsFile(this.filePath);

    const existing = file.services[key];
    if (!existing) {
      throw new Error(
        `AgentDoor: Cannot update token for ${baseUrl} -- no stored credentials found`,
      );
    }

    existing.token = token;
    existing.tokenExpiresAt = tokenExpiresAt;
    existing.storedAt = new Date().toISOString();

    writeCredentialsFile(this.filePath, file);
  }

  /**
   * Remove stored credentials for a service.
   */
  remove(baseUrl: string): boolean {
    const key = normalizeBaseUrl(baseUrl);
    const file = readCredentialsFile(this.filePath);

    if (!(key in file.services)) {
      return false;
    }

    delete file.services[key];
    writeCredentialsFile(this.filePath, file);
    return true;
  }

  /**
   * List all service base URLs that have stored credentials.
   */
  listServices(): string[] {
    const file = readCredentialsFile(this.filePath);
    return Object.keys(file.services);
  }

  /**
   * Remove all stored credentials.
   */
  clear(): void {
    writeCredentialsFile(this.filePath, { version: 1, services: {} });
  }
}
