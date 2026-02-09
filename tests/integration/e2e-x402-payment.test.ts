/**
 * Integration / E2E tests for the x402 payment flow.
 *
 * Tests the x402 payment protocol integration:
 * - Discovery document includes payment info when x402 is configured
 * - Registration with x402_wallet is supported
 * - Verify response includes x402 payment details
 * - x402 wallet is persisted in the agent record
 *
 * Uses a mocked facilitator (no real blockchain interactions).
 */

import { describe, it, expect } from "vitest";
import express from "express";
import * as http from "node:http";
import { agentgate } from "@agentgate/express";
import {
  MemoryStore,
  generateKeypair,
  signChallenge,
} from "@agentgate/core";

// ---------------------------------------------------------------------------
// HTTP request helper
// ---------------------------------------------------------------------------

async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      const bodyStr = body ? JSON.stringify(body) : undefined;
      const reqHeaders: Record<string, string> = { ...headers };
      if (bodyStr) {
        reqHeaders["Content-Type"] = "application/json";
        reqHeaders["Content-Length"] = Buffer.byteLength(bodyStr).toString();
      }

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: addr.port,
          path,
          method,
          headers: reqHeaders,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            server.close();
            let parsed: any;
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = data;
            }
            resolve({ status: res.statusCode!, body: parsed, headers: res.headers });
          });
        },
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  });
}

// ---------------------------------------------------------------------------
// Shared config
// ---------------------------------------------------------------------------

const TEST_SCOPES = [
  { id: "data.read", description: "Read data", price: "$0.001/req" },
  { id: "data.write", description: "Write data", price: "$0.01/req" },
];

const X402_CONFIG = {
  network: "base" as const,
  currency: "USDC" as const,
  paymentAddress: "0x1234567890abcdef1234567890abcdef12345678",
  facilitator: "https://x402.example.com/facilitator",
};

function createApp(withX402 = true) {
  const store = new MemoryStore();
  const app = express();
  app.use(
    agentgate({
      scopes: TEST_SCOPES,
      store,
      service: { name: "x402 Payment Test API", description: "E2E payment test" },
      ...(withX402 ? { x402: X402_CONFIG } : {}),
    }),
  );
  app.get("/api/data", (req, res) => {
    res.json({ isAgent: req.isAgent, agent: req.agent ?? null, ok: true });
  });
  return { app, store };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("AgentGate E2E: x402 Payment Flow", () => {
  it("discovery document includes payment section when x402 is configured", async () => {
    const { app } = createApp(true);

    const res = await request(app, "GET", "/.well-known/agentgate.json");
    expect(res.status).toBe(200);
    expect(res.body.payment).toBeDefined();
    expect(res.body.payment.protocol).toBe("x402");
    expect(res.body.payment.version).toBe("2.0");
    expect(res.body.payment.networks).toEqual(["base"]);
    expect(res.body.payment.currency).toEqual(["USDC"]);
    expect(res.body.payment.facilitator).toBe("https://x402.example.com/facilitator");
  });

  it("discovery document omits payment section when x402 is not configured", async () => {
    const { app } = createApp(false);

    const res = await request(app, "GET", "/.well-known/agentgate.json");
    expect(res.status).toBe(200);
    expect(res.body.payment).toBeUndefined();
  });

  it("registration accepts x402_wallet field", async () => {
    const { app } = createApp(true);
    const keypair = generateKeypair();

    const res = await request(app, "POST", "/agentgate/register", {
      public_key: keypair.publicKey,
      scopes_requested: ["data.read"],
      x402_wallet: "0xAgentWallet1234567890abcdef1234567890ab",
      metadata: { framework: "vitest" },
    });

    expect(res.status).toBe(201);
    expect(res.body.agent_id).toMatch(/^ag_/);
    expect(res.body.challenge).toBeDefined();
  });

  it("verify response includes x402 payment details when configured", async () => {
    const { app } = createApp(true);
    const keypair = generateKeypair();

    // Register
    const regRes = await request(app, "POST", "/agentgate/register", {
      public_key: keypair.publicKey,
      scopes_requested: ["data.read"],
      x402_wallet: "0xAgentWallet1234567890abcdef1234567890ab",
      metadata: { framework: "vitest" },
    });
    expect(regRes.status).toBe(201);

    // Verify
    const { agent_id, challenge } = regRes.body;
    const signature = signChallenge(challenge.message, keypair.secretKey);
    const verifyRes = await request(app, "POST", "/agentgate/register/verify", {
      agent_id,
      signature,
    });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.x402).toBeDefined();
    expect(verifyRes.body.x402.payment_address).toBe(X402_CONFIG.paymentAddress);
    expect(verifyRes.body.x402.network).toBe("base");
    expect(verifyRes.body.x402.currency).toBe("USDC");
  });

  it("verify response omits x402 when not configured", async () => {
    const { app } = createApp(false);
    const keypair = generateKeypair();

    const regRes = await request(app, "POST", "/agentgate/register", {
      public_key: keypair.publicKey,
      scopes_requested: ["data.read"],
    });

    const { agent_id, challenge } = regRes.body;
    const signature = signChallenge(challenge.message, keypair.secretKey);
    const verifyRes = await request(app, "POST", "/agentgate/register/verify", {
      agent_id,
      signature,
    });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.x402).toBeUndefined();
  });

  it("x402_wallet is persisted in the agent store", async () => {
    const { app, store } = createApp(true);
    const keypair = generateKeypair();
    const walletAddress = "0xAgentWallet1234567890abcdef1234567890ab";

    // Register with wallet
    const regRes = await request(app, "POST", "/agentgate/register", {
      public_key: keypair.publicKey,
      scopes_requested: ["data.read"],
      x402_wallet: walletAddress,
    });
    const { agent_id, challenge } = regRes.body;

    // Verify
    const signature = signChallenge(challenge.message, keypair.secretKey);
    await request(app, "POST", "/agentgate/register/verify", {
      agent_id,
      signature,
    });

    // Check persistence
    const stored = await store.getAgent(agent_id);
    expect(stored).toBeDefined();
    expect(stored!.x402Wallet).toBe(walletAddress);
  });

  it("scopes with pricing are shown in discovery", async () => {
    const { app } = createApp(true);

    const res = await request(app, "GET", "/.well-known/agentgate.json");
    expect(res.status).toBe(200);

    const scopes = res.body.scopes_available;
    const dataRead = scopes.find((s: any) => s.id === "data.read");
    const dataWrite = scopes.find((s: any) => s.id === "data.write");

    expect(dataRead.price).toBe("$0.001/req");
    expect(dataWrite.price).toBe("$0.01/req");
  });

  it("agent can authenticate after x402 registration", async () => {
    const { app } = createApp(true);
    const keypair = generateKeypair();

    // Register with wallet
    const regRes = await request(app, "POST", "/agentgate/register", {
      public_key: keypair.publicKey,
      scopes_requested: ["data.read"],
      x402_wallet: "0xAgentWallet1234567890abcdef1234567890ab",
    });
    const { agent_id, challenge } = regRes.body;
    const signature = signChallenge(challenge.message, keypair.secretKey);
    const verifyRes = await request(app, "POST", "/agentgate/register/verify", {
      agent_id,
      signature,
    });

    // Use the API key to access protected resource
    const apiRes = await request(app, "GET", "/api/data", undefined, {
      Authorization: `Bearer ${verifyRes.body.api_key}`,
    });
    expect(apiRes.status).toBe(200);
    expect(apiRes.body.isAgent).toBe(true);
    expect(apiRes.body.agent.id).toBe(agent_id);
  });
});
