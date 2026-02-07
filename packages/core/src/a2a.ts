/**
 * @agentgate/core - A2A Agent Card Generation
 *
 * Generates /.well-known/agent-card.json from AgentGateConfig.
 * Follows the A2A (Agent-to-Agent) protocol specification from Google,
 * enabling cross-protocol discovery.
 */

import type { ResolvedConfig } from "./config.js";
import type { A2AAgentCard } from "./types.js";

// ---------------------------------------------------------------------------
// Agent Card Generation
// ---------------------------------------------------------------------------

/**
 * Generate an A2A agent card (/.well-known/agent-card.json) from AgentGate config.
 *
 * The A2A agent card format follows Google's Agent-to-Agent protocol,
 * allowing agents that understand A2A to discover this service even if
 * they don't know about AgentGate specifically.
 *
 * @param config - Resolved AgentGate configuration
 * @param serviceUrl - The base URL of the service (e.g. "https://api.weatherco.com")
 * @returns A2AAgentCard document
 */
export function generateA2AAgentCard(
  config: ResolvedConfig,
  serviceUrl: string,
): A2AAgentCard {
  // Map scopes to A2A capabilities
  const capabilities = config.scopes.map((scope) => ({
    id: scope.id,
    description: scope.description,
  }));

  // Determine auth schemes
  const schemes: string[] = [];
  if (config.signing.algorithm === "ed25519") {
    schemes.push("ed25519-challenge");
  }
  if (config.x402) {
    schemes.push("x402-wallet");
  }
  schemes.push("bearer"); // JWT bearer tokens are always supported

  // Build supported protocols list
  const protocols: string[] = ["agentgate"];
  if (config.companion.a2aAgentCard) {
    protocols.push("a2a");
  }
  if (config.companion.mcpServer) {
    protocols.push("mcp");
  }
  if (config.x402) {
    protocols.push("x402");
  }

  const card: A2AAgentCard = {
    schema_version: "1.0",
    name: config.service.name,
    description: config.service.description,
    url: serviceUrl,
    capabilities,
    authentication: {
      schemes,
      credentials: "/agentgate/register",
    },
    protocols,
  };

  // Add provider info if available
  if (config.service.name) {
    card.provider = {
      organization: config.service.name,
      url: config.service.docsUrl,
    };
  }

  return card;
}

/**
 * Serialize an A2A agent card to JSON with consistent formatting.
 *
 * @param card - A2AAgentCard to serialize
 * @returns Pretty-printed JSON string
 */
export function serializeA2AAgentCard(card: A2AAgentCard): string {
  return JSON.stringify(card, null, 2);
}

/**
 * Get recommended HTTP headers for serving the A2A agent card.
 *
 * @returns Headers object for the agent card endpoint response
 */
export function getA2AAgentCardHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=3600",
  };
}

/**
 * Validate an A2A agent card document.
 *
 * @param card - Document to validate
 * @returns Validation result with valid flag and errors
 */
export function validateA2AAgentCard(card: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!card || typeof card !== "object") {
    return { valid: false, errors: ["Agent card must be a non-null object"] };
  }

  const c = card as Record<string, unknown>;

  if (typeof c.name !== "string" || c.name.length === 0) {
    errors.push("Missing or empty 'name'");
  }
  if (typeof c.description !== "string" || c.description.length === 0) {
    errors.push("Missing or empty 'description'");
  }
  if (typeof c.url !== "string") {
    errors.push("Missing or invalid 'url'");
  }
  if (!Array.isArray(c.capabilities)) {
    errors.push("Missing or invalid 'capabilities' (must be an array)");
  }
  if (!c.authentication || typeof c.authentication !== "object") {
    errors.push("Missing or invalid 'authentication'");
  }
  if (!Array.isArray(c.protocols)) {
    errors.push("Missing or invalid 'protocols' (must be an array)");
  }

  return { valid: errors.length === 0, errors };
}
