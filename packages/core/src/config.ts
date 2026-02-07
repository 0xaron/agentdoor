/**
 * @agentgate/core - Configuration Validation
 *
 * Zod schemas for validating AgentGateConfig.
 * Provides strict runtime validation with helpful error messages.
 */

import { z } from "zod";
import { InvalidConfigError } from "./errors.js";
import {
  DEFAULT_RATE_LIMIT,
  DEFAULT_REGISTRATION_RATE_LIMIT,
  DEFAULT_CHALLENGE_EXPIRY_SECONDS,
  DEFAULT_JWT_EXPIRY,
  DEFAULT_SIGNING_ALGORITHM,
  DEFAULT_SERVICE_NAME,
  DEFAULT_SERVICE_DESCRIPTION,
} from "./constants.js";
import type { AgentGateConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

/** Schema for a scope definition. */
export const ScopeDefinitionSchema = z.object({
  id: z
    .string()
    .min(1, "Scope ID must not be empty")
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_.]*$/,
      "Scope ID must start with a letter and contain only letters, digits, underscores, and dots",
    ),
  description: z.string().min(1, "Scope description must not be empty"),
  price: z.string().optional(),
  rateLimit: z.string().optional(),
});

/** Schema for rate limit configuration. */
export const RateLimitConfigSchema = z.object({
  requests: z.number().int().positive("Rate limit requests must be a positive integer"),
  window: z
    .string()
    .regex(
      /^\d+[smhd]$/,
      "Rate limit window must be a number followed by s (seconds), m (minutes), h (hours), or d (days)",
    ),
});

/** Schema for x402 payment configuration. */
export const X402ConfigSchema = z.object({
  network: z.string().min(1, "x402 network must not be empty"),
  currency: z.string().min(1, "x402 currency must not be empty"),
  facilitator: z.string().url("x402 facilitator must be a valid URL").optional(),
  paymentAddress: z.string().min(1, "x402 payment address must not be empty"),
});

/** Schema for storage configuration. */
export const StorageConfigSchema = z.object({
  driver: z.enum(["memory", "sqlite", "postgres", "redis"]),
  url: z.string().optional(),
  options: z.record(z.unknown()).optional(),
});

/** Schema for JWT configuration. */
export const JwtConfigSchema = z.object({
  secret: z.string().min(16, "JWT secret must be at least 16 characters").optional(),
  expiresIn: z
    .string()
    .regex(
      /^\d+[smhd]$/,
      "JWT expiresIn must be a number followed by s, m, h, or d",
    )
    .optional(),
});

/** Schema for signing configuration. */
export const SigningConfigSchema = z.object({
  algorithm: z.enum(["ed25519", "secp256k1"]),
});

/** Schema for companion protocol configuration. */
export const CompanionConfigSchema = z.object({
  a2aAgentCard: z.boolean().optional(),
  mcpServer: z.boolean().optional(),
  oauthCompat: z.boolean().optional(),
});

/** Schema for service metadata. */
export const ServiceConfigSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  docsUrl: z.string().url("docs URL must be a valid URL").optional(),
  supportEmail: z.string().email("support email must be a valid email").optional(),
});

/** Full schema for AgentGateConfig. */
export const AgentGateConfigSchema = z.object({
  scopes: z
    .array(ScopeDefinitionSchema)
    .min(1, "At least one scope must be defined"),
  pricing: z.record(z.string()).optional(),
  rateLimit: RateLimitConfigSchema.optional(),
  x402: X402ConfigSchema.optional(),
  storage: StorageConfigSchema.optional(),
  signing: SigningConfigSchema.optional(),
  jwt: JwtConfigSchema.optional(),
  companion: CompanionConfigSchema.optional(),
  service: ServiceConfigSchema.optional(),
  registrationRateLimit: RateLimitConfigSchema.optional(),
  challengeExpirySeconds: z
    .number()
    .int()
    .positive("Challenge expiry must be a positive integer")
    .optional(),
  mode: z.enum(["live", "test"]).optional(),
  // Callbacks cannot be validated by zod, handled separately
  onAgentRegistered: z.function().optional(),
  onAgentAuthenticated: z.function().optional(),
});

// ---------------------------------------------------------------------------
// Resolved Config (with all defaults applied)
// ---------------------------------------------------------------------------

/** AgentGateConfig with all defaults resolved. No optional fields. */
export interface ResolvedConfig {
  scopes: Array<{
    id: string;
    description: string;
    price?: string;
    rateLimit?: string;
  }>;
  pricing: Record<string, string>;
  rateLimit: { requests: number; window: string };
  x402?: {
    network: string;
    currency: string;
    facilitator?: string;
    paymentAddress: string;
  };
  storage: { driver: "memory" | "sqlite" | "postgres" | "redis"; url?: string; options?: Record<string, unknown> };
  signing: { algorithm: "ed25519" | "secp256k1" };
  jwt: { secret: string; expiresIn: string };
  companion: { a2aAgentCard: boolean; mcpServer: boolean; oauthCompat: boolean };
  service: { name: string; description: string; docsUrl?: string; supportEmail?: string };
  registrationRateLimit: { requests: number; window: string };
  challengeExpirySeconds: number;
  mode: "live" | "test";
  onAgentRegistered?: (agent: unknown) => void | Promise<void>;
  onAgentAuthenticated?: (agent: unknown) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Validation & Resolution
// ---------------------------------------------------------------------------

/**
 * Validate an AgentGateConfig object against the Zod schema.
 * Throws InvalidConfigError if validation fails.
 */
export function validateConfig(config: unknown): AgentGateConfig {
  const result = AgentGateConfigSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new InvalidConfigError(
      `Configuration validation failed:\n  - ${issues.join("\n  - ")}`,
      { issues: result.error.issues },
    );
  }
  return result.data as AgentGateConfig;
}

/**
 * Generate a cryptographically random JWT secret.
 * Uses the Web Crypto API (available in Node 18+, Deno, Bun, edge runtimes).
 */
function generateJwtSecret(): string {
  const array = new Uint8Array(32);
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(array);
  } else {
    // Fallback for rare environments without Web Crypto
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate and resolve an AgentGateConfig, applying all default values.
 * Returns a ResolvedConfig with no optional fields (except x402).
 */
export function resolveConfig(config: AgentGateConfig): ResolvedConfig {
  // Validate first
  validateConfig(config);

  // Build pricing map from both top-level pricing and per-scope prices
  const pricing: Record<string, string> = { ...config.pricing };
  for (const scope of config.scopes) {
    if (scope.price && !pricing[scope.id]) {
      pricing[scope.id] = scope.price;
    }
  }

  // Generate JWT secret if not provided
  const jwtSecret = config.jwt?.secret ?? generateJwtSecret();

  return {
    scopes: config.scopes,
    pricing,
    rateLimit: config.rateLimit ?? { ...DEFAULT_RATE_LIMIT },
    x402: config.x402,
    storage: config.storage ?? { driver: "memory" },
    signing: config.signing ?? { algorithm: DEFAULT_SIGNING_ALGORITHM },
    jwt: {
      secret: jwtSecret,
      expiresIn: config.jwt?.expiresIn ?? DEFAULT_JWT_EXPIRY,
    },
    companion: {
      a2aAgentCard: config.companion?.a2aAgentCard ?? true,
      mcpServer: config.companion?.mcpServer ?? false,
      oauthCompat: config.companion?.oauthCompat ?? false,
    },
    service: {
      name: config.service?.name ?? DEFAULT_SERVICE_NAME,
      description: config.service?.description ?? DEFAULT_SERVICE_DESCRIPTION,
      docsUrl: config.service?.docsUrl,
      supportEmail: config.service?.supportEmail,
    },
    registrationRateLimit: config.registrationRateLimit ?? { ...DEFAULT_REGISTRATION_RATE_LIMIT },
    challengeExpirySeconds: config.challengeExpirySeconds ?? DEFAULT_CHALLENGE_EXPIRY_SECONDS,
    mode: config.mode ?? "live",
    onAgentRegistered: config.onAgentRegistered as ResolvedConfig["onAgentRegistered"],
    onAgentAuthenticated: config.onAgentAuthenticated as ResolvedConfig["onAgentAuthenticated"],
  };
}
