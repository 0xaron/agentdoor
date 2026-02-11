/**
 * @agentgate/sdk -- Agent-side SDK for connecting to AgentGate-enabled services.
 *
 * Usage:
 *   import { AgentGate } from "@agentgate/sdk";
 *
 *   const agent = new AgentGate({ keyPath: "~/.agentgate/keys.json" });
 *   const session = await agent.connect("https://api.example.com");
 *   const data = await session.get("/weather/forecast", { params: { city: "sf" } });
 *
 * @module @agentgate/sdk
 */

// -- Main entry point --
export { AgentGate, AgentGateError } from "./agent.js";
export type { AgentGateOptions, AgentGateErrorCode } from "./agent.js";

// -- Session --
export { Session, SessionError } from "./session.js";
export type {
  SessionConfig,
  SessionResponse,
  RequestOptions,
  TokenRefresher,
} from "./session.js";

// -- Keystore --
export {
  generateKeypair,
  loadKeypair,
  saveKeypair,
  loadOrCreateKeypair,
  signMessage,
  verifySignature,
  DEFAULT_KEY_PATH,
} from "./keystore.js";
export type { Keypair, StoredKeypair } from "./keystore.js";

// -- Discovery --
export { discover, clearDiscoveryCache, discoveryCacheSize, DiscoveryError } from "./discovery.js";
export type {
  AgentGateDiscoveryDocument,
  DiscoveryScope,
  DiscoveryPayment,
  DiscoveryRateLimits,
  DiscoveryCompanionProtocols,
  DiscoverOptions,
} from "./discovery.js";

// -- Credentials --
export { CredentialStore, DEFAULT_CREDENTIALS_PATH } from "./credentials.js";
export type { ServiceCredentials } from "./credentials.js";

// -- x402 Payments --
export {
  buildPaymentHeader,
  buildSignedPaymentHeader,
  decodePaymentHeader,
  validateWalletConfig,
  X402Error,
} from "./x402.js";
export type {
  X402WalletConfig,
  X402PaymentPayload,
  RequestContext,
} from "./x402.js";
