import { describe, it, expect } from "vitest";
import {
  buildPaymentHeader,
  buildSignedPaymentHeader,
  decodePaymentHeader,
  validateWalletConfig,
  X402Error,
} from "../x402.js";
import type { X402WalletConfig, RequestContext, X402PaymentPayload } from "../x402.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWalletConfig(
  overrides: Partial<X402WalletConfig> = {},
): X402WalletConfig {
  return {
    address: "0x1234567890abcdef1234567890abcdef12345678",
    network: "base",
    currency: "USDC",
    ...overrides,
  };
}

function makeRequestContext(
  overrides: Partial<RequestContext> = {},
): RequestContext {
  return {
    path: "/api/weather/forecast",
    method: "GET",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildPaymentHeader
// ---------------------------------------------------------------------------

describe("buildPaymentHeader", () => {
  it("returns a base64-encoded string", () => {
    const header = buildPaymentHeader(makeWalletConfig(), makeRequestContext());
    expect(typeof header).toBe("string");
    // Should be valid base64
    expect(() => Buffer.from(header, "base64")).not.toThrow();
  });

  it("encodes the correct payload fields", () => {
    const wallet = makeWalletConfig();
    const context = makeRequestContext();
    const header = buildPaymentHeader(wallet, context);
    const decoded = decodePaymentHeader(header);

    expect(decoded.version).toBe("2.0");
    expect(decoded.from).toBe(wallet.address);
    expect(decoded.network).toBe("base");
    expect(decoded.currency).toBe("USDC");
    expect(decoded.resource).toBe("/api/weather/forecast");
    expect(decoded.method).toBe("GET");
  });

  it("includes timestamp in ISO-8601 format", () => {
    const header = buildPaymentHeader(makeWalletConfig(), makeRequestContext());
    const decoded = decodePaymentHeader(header);
    const parsed = Date.parse(decoded.timestamp);
    expect(Number.isNaN(parsed)).toBe(false);
  });

  it("sets maxAmount from context.amount", () => {
    const header = buildPaymentHeader(
      makeWalletConfig(),
      makeRequestContext({ amount: "0.50" }),
    );
    const decoded = decodePaymentHeader(header);
    expect(decoded.maxAmount).toBe("0.50");
  });

  it("sets maxAmount from wallet maxAmountPerRequest when context.amount is not set", () => {
    const header = buildPaymentHeader(
      makeWalletConfig({ maxAmountPerRequest: "1.00" }),
      makeRequestContext(),
    );
    const decoded = decodePaymentHeader(header);
    expect(decoded.maxAmount).toBe("1.00");
  });

  it("prefers context.amount over wallet maxAmountPerRequest", () => {
    const header = buildPaymentHeader(
      makeWalletConfig({ maxAmountPerRequest: "1.00" }),
      makeRequestContext({ amount: "0.25" }),
    );
    const decoded = decodePaymentHeader(header);
    expect(decoded.maxAmount).toBe("0.25");
  });

  it("omits maxAmount when neither is set", () => {
    const header = buildPaymentHeader(makeWalletConfig(), makeRequestContext());
    const decoded = decodePaymentHeader(header);
    expect(decoded.maxAmount).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildSignedPaymentHeader
// ---------------------------------------------------------------------------

describe("buildSignedPaymentHeader", () => {
  it("includes signature in the payload", async () => {
    const wallet = makeWalletConfig({
      signPayload: async (payload: string) => "0xfakesignature123",
    });

    const header = await buildSignedPaymentHeader(
      wallet as X402WalletConfig & { signPayload: NonNullable<X402WalletConfig["signPayload"]> },
      makeRequestContext(),
    );
    const decoded = decodePaymentHeader(header);

    expect(decoded.signature).toBe("0xfakesignature123");
  });

  it("passes the unsigned payload to signPayload", async () => {
    let receivedPayload: string | undefined;

    const wallet = makeWalletConfig({
      signPayload: async (payload: string) => {
        receivedPayload = payload;
        return "0xsig";
      },
    });

    await buildSignedPaymentHeader(
      wallet as X402WalletConfig & { signPayload: NonNullable<X402WalletConfig["signPayload"]> },
      makeRequestContext(),
    );

    expect(receivedPayload).toBeDefined();
    const parsed = JSON.parse(receivedPayload!) as X402PaymentPayload;
    expect(parsed.version).toBe("2.0");
    // The payload passed to sign should NOT contain the signature field
    expect(parsed.signature).toBeUndefined();
  });

  it("includes maxAmount in signed payload", async () => {
    const wallet = makeWalletConfig({
      maxAmountPerRequest: "5.00",
      signPayload: async () => "0xsig",
    });

    const header = await buildSignedPaymentHeader(
      wallet as X402WalletConfig & { signPayload: NonNullable<X402WalletConfig["signPayload"]> },
      makeRequestContext(),
    );
    const decoded = decodePaymentHeader(header);

    expect(decoded.maxAmount).toBe("5.00");
  });
});

// ---------------------------------------------------------------------------
// decodePaymentHeader
// ---------------------------------------------------------------------------

describe("decodePaymentHeader", () => {
  it("round-trips with buildPaymentHeader", () => {
    const wallet = makeWalletConfig();
    const context = makeRequestContext();
    const header = buildPaymentHeader(wallet, context);
    const decoded = decodePaymentHeader(header);

    expect(decoded.version).toBe("2.0");
    expect(decoded.from).toBe(wallet.address);
    expect(decoded.network).toBe(wallet.network);
    expect(decoded.currency).toBe(wallet.currency);
    expect(decoded.resource).toBe(context.path);
    expect(decoded.method).toBe(context.method);
  });

  it("throws on invalid base64", () => {
    expect(() => decodePaymentHeader("not-valid-base64!!!")).toThrow(X402Error);
  });

  it("throws on non-JSON content", () => {
    const encoded = Buffer.from("not json").toString("base64");
    expect(() => decodePaymentHeader(encoded)).toThrow(X402Error);
  });

  it("throws on wrong version", () => {
    const payload = {
      version: "1.0",
      from: "0x123",
      network: "base",
      currency: "USDC",
      timestamp: new Date().toISOString(),
      resource: "/test",
      method: "GET",
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
    expect(() => decodePaymentHeader(encoded)).toThrow("version");
  });

  it("throws on missing required fields", () => {
    const payload = {
      version: "2.0",
      // missing from, network, currency
      timestamp: new Date().toISOString(),
      resource: "/test",
      method: "GET",
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
    expect(() => decodePaymentHeader(encoded)).toThrow("missing required fields");
  });
});

// ---------------------------------------------------------------------------
// validateWalletConfig
// ---------------------------------------------------------------------------

describe("validateWalletConfig", () => {
  it("accepts a valid wallet config", () => {
    expect(() =>
      validateWalletConfig(makeWalletConfig()),
    ).not.toThrow();
  });

  it("throws on missing address", () => {
    expect(() =>
      validateWalletConfig({ address: "", network: "base", currency: "USDC" }),
    ).toThrow(X402Error);
  });

  it("throws on non-string address", () => {
    expect(() =>
      validateWalletConfig({
        address: 123 as unknown as string,
        network: "base",
        currency: "USDC",
      }),
    ).toThrow(X402Error);
  });

  it("throws on missing network", () => {
    expect(() =>
      validateWalletConfig({ address: "0x123", network: "", currency: "USDC" }),
    ).toThrow(X402Error);
  });

  it("throws on missing currency", () => {
    expect(() =>
      validateWalletConfig({ address: "0x123", network: "base", currency: "" }),
    ).toThrow(X402Error);
  });
});

// ---------------------------------------------------------------------------
// X402Error
// ---------------------------------------------------------------------------

describe("X402Error", () => {
  it("is an instance of Error", () => {
    const err = new X402Error("test");
    expect(err).toBeInstanceOf(Error);
  });

  it("has name X402Error", () => {
    const err = new X402Error("test");
    expect(err.name).toBe("X402Error");
  });

  it("preserves the message", () => {
    const err = new X402Error("payment failed");
    expect(err.message).toBe("payment failed");
  });
});
