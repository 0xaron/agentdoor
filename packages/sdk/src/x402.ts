/**
 * x402 payment header construction for AgentGate SDK.
 *
 * Builds the X-PAYMENT header value from a wallet configuration,
 * following the x402 V2 protocol specification.
 *
 * The x402 protocol uses HTTP 402 (Payment Required) responses to signal
 * that a request requires payment. The agent pre-attaches an X-PAYMENT
 * header with a signed payment payload to avoid the 402 round-trip.
 */

import { encodeBase64 } from "tweetnacl-util";

/** x402 wallet configuration for the agent. */
export interface X402WalletConfig {
  /** The agent's wallet address (e.g. "0x1234...abcd"). */
  address: string;
  /** The blockchain network (e.g. "base", "solana"). */
  network: string;
  /** The payment currency (e.g. "USDC"). */
  currency: string;
  /** Optional: maximum amount the agent is willing to pay per request. */
  maxAmountPerRequest?: string;
  /** Optional: custom facilitator URL. */
  facilitatorUrl?: string;
  /**
   * Optional: signing function for producing a wallet signature.
   * If provided, the payment header will include a signed commitment.
   * The function receives the serialized payment payload and returns
   * a hex-encoded signature.
   */
  signPayload?: (payload: string) => Promise<string>;
}

/** Context about the request being made (used to build the payment payload). */
export interface RequestContext {
  /** The URL path being requested. */
  path: string;
  /** The HTTP method. */
  method: string;
  /** Optional: specific amount to pay for this request. */
  amount?: string;
}

/** The structured x402 payment payload before encoding. */
export interface X402PaymentPayload {
  /** Protocol version. */
  version: "2.0";
  /** The payer's wallet address. */
  from: string;
  /** The blockchain network. */
  network: string;
  /** The payment currency. */
  currency: string;
  /** ISO-8601 timestamp of when this payload was created. */
  timestamp: string;
  /** The request path this payment is for. */
  resource: string;
  /** The HTTP method this payment is for. */
  method: string;
  /** Maximum amount the agent is willing to pay. */
  maxAmount?: string;
  /** Hex-encoded wallet signature of the payload, if signed. */
  signature?: string;
}

/**
 * Build the X-PAYMENT header value for an authenticated request.
 *
 * The header value is a base64-encoded JSON payload conforming to the
 * x402 V2 specification. If the wallet config includes a `signPayload`
 * function, the payload will be signed for on-chain verification.
 *
 * @param walletConfig - The agent's wallet configuration
 * @param context - Information about the current request
 * @returns The base64-encoded X-PAYMENT header value
 */
export function buildPaymentHeader(
  walletConfig: X402WalletConfig,
  context: RequestContext,
): string {
  const payload: X402PaymentPayload = {
    version: "2.0",
    from: walletConfig.address,
    network: walletConfig.network,
    currency: walletConfig.currency,
    timestamp: new Date().toISOString(),
    resource: context.path,
    method: context.method,
  };

  if (context.amount) {
    payload.maxAmount = context.amount;
  } else if (walletConfig.maxAmountPerRequest) {
    payload.maxAmount = walletConfig.maxAmountPerRequest;
  }

  const encoded = encodePayload(payload);
  return encoded;
}

/**
 * Build the X-PAYMENT header value with an async wallet signature.
 *
 * Use this when the wallet config has a `signPayload` function that
 * produces a cryptographic signature for on-chain payment verification.
 *
 * @param walletConfig - The agent's wallet configuration (must include signPayload)
 * @param context - Information about the current request
 * @returns The base64-encoded X-PAYMENT header value with signature
 */
export async function buildSignedPaymentHeader(
  walletConfig: X402WalletConfig & { signPayload: NonNullable<X402WalletConfig["signPayload"]> },
  context: RequestContext,
): Promise<string> {
  const payload: X402PaymentPayload = {
    version: "2.0",
    from: walletConfig.address,
    network: walletConfig.network,
    currency: walletConfig.currency,
    timestamp: new Date().toISOString(),
    resource: context.path,
    method: context.method,
  };

  if (context.amount) {
    payload.maxAmount = context.amount;
  } else if (walletConfig.maxAmountPerRequest) {
    payload.maxAmount = walletConfig.maxAmountPerRequest;
  }

  // Sign the payload (without the signature field)
  const payloadString = JSON.stringify(payload);
  const signature = await walletConfig.signPayload(payloadString);
  payload.signature = signature;

  return encodePayload(payload);
}

/**
 * Encode a payment payload as a base64 string for the X-PAYMENT header.
 */
function encodePayload(payload: X402PaymentPayload): string {
  const jsonString = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(jsonString);
  return encodeBase64(bytes);
}

/**
 * Decode a base64-encoded X-PAYMENT header value back to a payload object.
 * Useful for debugging and testing.
 */
export function decodePaymentHeader(headerValue: string): X402PaymentPayload {
  // Try standard base64 decoding
  const jsonString = Buffer.from(headerValue, "base64").toString("utf-8");

  try {
    const parsed = JSON.parse(jsonString) as X402PaymentPayload;

    if (parsed.version !== "2.0") {
      throw new X402Error(
        `Unsupported x402 payload version: ${parsed.version} (expected "2.0")`,
      );
    }

    if (!parsed.from || !parsed.network || !parsed.currency) {
      throw new X402Error(
        "Invalid x402 payload: missing required fields (from, network, currency)",
      );
    }

    return parsed;
  } catch (err) {
    if (err instanceof X402Error) {
      throw err;
    }
    throw new X402Error(`Failed to decode x402 payment header: ${String(err)}`);
  }
}

/**
 * Validate that a wallet config has the minimum required fields.
 */
export function validateWalletConfig(config: X402WalletConfig): void {
  if (!config.address || typeof config.address !== "string") {
    throw new X402Error("x402 wallet config: address is required");
  }
  if (!config.network || typeof config.network !== "string") {
    throw new X402Error("x402 wallet config: network is required");
  }
  if (!config.currency || typeof config.currency !== "string") {
    throw new X402Error("x402 wallet config: currency is required");
  }
}

/**
 * Error thrown for x402 payment-related issues.
 */
export class X402Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X402Error";
  }
}
