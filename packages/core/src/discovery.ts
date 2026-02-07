/**
 * @agentgate/core - Discovery Document Generation
 *
 * Generates the /.well-known/agentgate.json discovery document
 * from an AgentGateConfig. This document tells agents everything
 * they need to know: scopes, pricing, how to register, and payment info.
 */

import type { ResolvedConfig } from "./config.js";
import type { DiscoveryDocument } from "./types.js";
import {
  AGENTGATE_VERSION,
  REGISTER_PATH,
  AUTH_PATH,
  AUTH_METHODS,
  A2A_AGENT_CARD_PATH,
  X402_PROTOCOL_VERSION,
  DEFAULT_X402_FACILITATOR,
  DISCOVERY_CACHE_CONTROL,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Discovery Document Generation
// ---------------------------------------------------------------------------

/**
 * Generate a /.well-known/agentgate.json discovery document from a resolved config.
 *
 * The discovery document follows the convention of /.well-known/openid-configuration
 * and /.well-known/agent-card.json, providing agents with all information needed
 * to register and authenticate.
 *
 * @param config - Resolved AgentGate configuration
 * @returns The complete DiscoveryDocument
 */
export function generateDiscoveryDocument(config: ResolvedConfig): DiscoveryDocument {
  // Build scopes array with pricing from both scope-level and config-level pricing
  const scopesAvailable = config.scopes.map((scope) => ({
    id: scope.id,
    description: scope.description,
    price: scope.price ?? config.pricing[scope.id],
    rate_limit: scope.rateLimit,
  }));

  // Build rate limits section
  const rateLimits = {
    registration: `${config.registrationRateLimit.requests}/${config.registrationRateLimit.window}`,
    default: `${config.rateLimit.requests}/${config.rateLimit.window}`,
  };

  // Build companion protocols section
  const companionProtocols: DiscoveryDocument["companion_protocols"] = {};

  if (config.companion.a2aAgentCard) {
    companionProtocols.a2a_agent_card = A2A_AGENT_CARD_PATH;
  }

  if (config.companion.mcpServer) {
    companionProtocols.mcp_server = "/mcp";
  }

  if (config.x402) {
    companionProtocols.x402_bazaar = true;
  }

  // Build payment section (only if x402 is configured)
  let payment: DiscoveryDocument["payment"];
  if (config.x402) {
    payment = {
      protocol: "x402",
      version: X402_PROTOCOL_VERSION,
      networks: [config.x402.network],
      currency: [config.x402.currency],
      facilitator: config.x402.facilitator ?? DEFAULT_X402_FACILITATOR,
      deferred: false,
    };
  }

  // Determine supported auth methods
  const authMethods: string[] = [];
  if (config.signing.algorithm === "ed25519") {
    authMethods.push("ed25519-challenge");
  }
  if (config.signing.algorithm === "secp256k1" || config.x402) {
    authMethods.push("x402-wallet");
  }
  authMethods.push("jwt"); // JWT is always available after initial auth

  const doc: DiscoveryDocument = {
    agentgate_version: AGENTGATE_VERSION,
    service_name: config.service.name,
    service_description: config.service.description,
    registration_endpoint: REGISTER_PATH,
    auth_endpoint: AUTH_PATH,
    scopes_available: scopesAvailable,
    auth_methods: authMethods,
    rate_limits: rateLimits,
    companion_protocols: companionProtocols,
  };

  // Add optional payment section
  if (payment) {
    doc.payment = payment;
  }

  // Add optional metadata
  if (config.service.docsUrl) {
    doc.docs_url = config.service.docsUrl;
  }

  if (config.service.supportEmail) {
    doc.support_email = config.service.supportEmail;
  }

  return doc;
}

/**
 * Serialize a discovery document to a JSON string with consistent formatting.
 *
 * @param doc - DiscoveryDocument to serialize
 * @returns Pretty-printed JSON string
 */
export function serializeDiscoveryDocument(doc: DiscoveryDocument): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * Get the recommended HTTP headers for serving the discovery document.
 *
 * @returns Headers object for the discovery endpoint response
 */
export function getDiscoveryHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Cache-Control": DISCOVERY_CACHE_CONTROL,
    "X-AgentGate-Version": AGENTGATE_VERSION,
  };
}

/**
 * Validate a discovery document has all required fields.
 * Useful for validating documents fetched from remote services.
 *
 * @param doc - Document to validate
 * @returns Object with valid flag and any error messages
 */
export function validateDiscoveryDocument(doc: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!doc || typeof doc !== "object") {
    return { valid: false, errors: ["Document must be a non-null object"] };
  }

  const d = doc as Record<string, unknown>;

  if (typeof d.agentgate_version !== "string") {
    errors.push("Missing or invalid 'agentgate_version'");
  }
  if (typeof d.service_name !== "string") {
    errors.push("Missing or invalid 'service_name'");
  }
  if (typeof d.registration_endpoint !== "string") {
    errors.push("Missing or invalid 'registration_endpoint'");
  }
  if (typeof d.auth_endpoint !== "string") {
    errors.push("Missing or invalid 'auth_endpoint'");
  }
  if (!Array.isArray(d.scopes_available)) {
    errors.push("Missing or invalid 'scopes_available' (must be an array)");
  } else {
    for (let i = 0; i < d.scopes_available.length; i++) {
      const scope = d.scopes_available[i] as Record<string, unknown>;
      if (!scope || typeof scope.id !== "string") {
        errors.push(`scopes_available[${i}]: missing or invalid 'id'`);
      }
      if (!scope || typeof scope.description !== "string") {
        errors.push(`scopes_available[${i}]: missing or invalid 'description'`);
      }
    }
  }
  if (!Array.isArray(d.auth_methods)) {
    errors.push("Missing or invalid 'auth_methods' (must be an array)");
  }

  return { valid: errors.length === 0, errors };
}
