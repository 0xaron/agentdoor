/**
 * @agentdoor/sdk -- Agent-side SDK for connecting to AgentDoor-enabled services.
 *
 * Usage:
 *   import { AgentDoor } from "@agentdoor/sdk";
 *
 *   const agent = new AgentDoor({ keyPath: "~/.agentdoor/keys.json" });
 *   const session = await agent.connect("https://api.example.com");
 *   const data = await session.get("/weather/forecast", { params: { city: "sf" } });
 *
 * @module @agentdoor/sdk
 */

// -- Main entry point --
export { AgentDoor, AgentDoorError } from "./agent.js";
export type { AgentDoorOptions, AgentDoorErrorCode } from "./agent.js";

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
  AgentDoorDiscoveryDocument,
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
