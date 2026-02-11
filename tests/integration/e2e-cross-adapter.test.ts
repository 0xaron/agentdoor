/**
 * Integration / E2E tests for cross-adapter compatibility.
 *
 * Verifies that the AgentDoor protocol is adapter-agnostic by testing:
 * 1. Shared MemoryStore: agents registered on one adapter are visible from another
 * 2. Discovery documents: both adapters produce structurally compatible documents
 * 3. Agent data portability: agent records stored by one adapter can be read by another
 *
 * Note: API key authentication across adapters requires the same hashing
 * function. Currently Express uses hashApiKey (hex-encoded truncated SHA-512)
 * and Hono uses its own sha256 (base64-encoded Web Crypto SHA-256). This means
 * API key auth is adapter-specific, but all other protocol aspects are shared.
 */

import { describe, it, expect } from "vitest";
import express from "express";
import * as http from "node:http";
import { Hono } from "hono";
import { agentdoor as agentdoorExpress } from "@agentdoor/express";
import { agentdoor as agentdoorHono } from "@agentdoor/hono";
import type { AgentDoorVariables } from "@agentdoor/hono";
import {
  MemoryStore,
  generateKeypair,
  signChallenge,
} from "@agentdoor/core";

// ---------------------------------------------------------------------------
// Test helper: HTTP requests to Express
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
  { id: "data.read", description: "Read data" },
  { id: "data.write", description: "Write data" },
];

// ===========================================================================
// Tests
// ===========================================================================

describe("AgentDoor E2E: Cross-Adapter Compatibility", () => {
  it("agent registered on Express is visible in shared store used by Hono", async () => {
    const store = new MemoryStore();

    // --- Express App ---
    const expressApp = express();
    expressApp.use(
      agentdoorExpress({
        scopes: TEST_SCOPES,
        store,
        service: { name: "Cross-Adapter Test" },
      }),
    );

    // --- Hono App (same store) ---
    const honoApp = new Hono<{ Variables: AgentDoorVariables }>();
    agentdoorHono(honoApp, {
      scopes: TEST_SCOPES,
      store,
      service: { name: "Cross-Adapter Test" },
    });

    // 1. Register on Express
    const keypair = generateKeypair();
    const regRes = await request(expressApp, "POST", "/agentdoor/register", {
      public_key: keypair.publicKey,
      scopes_requested: ["data.read", "data.write"],
      metadata: { framework: "vitest" },
    });
    expect(regRes.status).toBe(201);
    const { agent_id, challenge } = regRes.body;

    // 2. Verify on Express
    const signature = signChallenge(challenge.message, keypair.secretKey);
    const verifyRes = await request(expressApp, "POST", "/agentdoor/register/verify", {
      agent_id,
      signature,
    });
    expect(verifyRes.status).toBe(200);

    // 3. Agent is visible in the shared store
    const storedAgent = await store.getAgent(agent_id);
    expect(storedAgent).toBeDefined();
    expect(storedAgent!.publicKey).toBe(keypair.publicKey);
    expect(storedAgent!.scopesGranted).toEqual(["data.read", "data.write"]);
    expect(storedAgent!.status).toBe("active");

    // 4. Agent can be looked up by public key from the shared store
    const byPK = await store.getAgentByPublicKey(keypair.publicKey);
    expect(byPK).toBeDefined();
    expect(byPK!.id).toBe(agent_id);

    // 5. Hono's registration endpoint returns 409 for duplicate public key
    //    (proving it can see the agent registered by Express in the shared store)
    const honoRegRes = await honoApp.request("/agentdoor/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        public_key: keypair.publicKey,
        scopes_requested: ["data.read"],
        metadata: { framework: "vitest" },
      }),
    });
    expect(honoRegRes.status).toBe(409);
  });

  it("agent registered on Hono is visible in shared store used by Express", async () => {
    const store = new MemoryStore();

    // --- Express App ---
    const expressApp = express();
    expressApp.use(
      agentdoorExpress({
        scopes: TEST_SCOPES,
        store,
        service: { name: "Cross-Adapter Test" },
      }),
    );

    // --- Hono App ---
    const honoApp = new Hono<{ Variables: AgentDoorVariables }>();
    agentdoorHono(honoApp, {
      scopes: TEST_SCOPES,
      store,
      service: { name: "Cross-Adapter Test" },
    });

    // 1. Register on Hono
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const pubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const publicKeyB64 = btoa(String.fromCharCode(...new Uint8Array(pubRaw)));

    const regRes = await honoApp.request("/agentdoor/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        public_key: publicKeyB64,
        scopes_requested: ["data.read"],
        metadata: { framework: "vitest" },
      }),
    });
    expect(regRes.status).toBe(201);
    const regBody = await regRes.json();

    // 2. Verify on Hono
    const sigBytes = await crypto.subtle.sign(
      "Ed25519",
      keyPair.privateKey,
      new TextEncoder().encode(regBody.challenge.message),
    );
    const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
    const verifyRes = await honoApp.request("/agentdoor/register/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: regBody.agent_id,
        signature: signatureB64,
      }),
    });
    expect(verifyRes.status).toBe(200);

    // 3. Agent is visible in the shared store (Express can see it)
    const storedAgent = await store.getAgent(regBody.agent_id);
    expect(storedAgent).toBeDefined();
    expect(storedAgent!.publicKey).toBe(publicKeyB64);
    expect(storedAgent!.scopesGranted).toEqual(["data.read"]);

    // 4. Express registration rejects duplicate public key
    //    (proving Express sees the Hono-registered agent via shared store)
    const expressRegRes = await request(expressApp, "POST", "/agentdoor/register", {
      public_key: publicKeyB64,
      scopes_requested: ["data.read"],
    });
    expect(expressRegRes.status).toBe(409);
  });

  it("discovery documents share core structure across adapters with same config", async () => {
    const store = new MemoryStore();
    const config = {
      scopes: TEST_SCOPES,
      store,
      service: { name: "Consistency Test", description: "Same config" },
      rateLimit: { requests: 500, window: "1h" as const },
    };

    // Express
    const expressApp = express();
    expressApp.use(agentdoorExpress(config));
    const expressDiscovery = await request(expressApp, "GET", "/.well-known/agentdoor.json");

    // Hono
    const honoApp = new Hono<{ Variables: AgentDoorVariables }>();
    agentdoorHono(honoApp, config);
    const honoDiscovery = await honoApp.request("/.well-known/agentdoor.json");
    const honoBody = await honoDiscovery.json();

    // Core protocol fields should be identical
    expect(expressDiscovery.body.agentdoor_version).toBe(honoBody.agentdoor_version);
    expect(expressDiscovery.body.service_name).toBe(honoBody.service_name);
    expect(expressDiscovery.body.service_description).toBe(honoBody.service_description);
    expect(expressDiscovery.body.scopes_available).toEqual(honoBody.scopes_available);
    expect(expressDiscovery.body.registration_endpoint).toBe(honoBody.registration_endpoint);
    expect(expressDiscovery.body.auth_endpoint).toBe(honoBody.auth_endpoint);
    // Rate limits may have minor formatting differences ("10/hour" vs "10/1h")
    // but default rate limit should match
    expect(expressDiscovery.body.rate_limits.default).toBe(honoBody.rate_limits.default);

    // Both should include ed25519-challenge
    expect(expressDiscovery.body.auth_methods).toContain("ed25519-challenge");
    expect(honoBody.auth_methods).toContain("ed25519-challenge");

    // Both should include jwt
    expect(expressDiscovery.body.auth_methods).toContain("jwt");
    expect(honoBody.auth_methods).toContain("jwt");
  });
});
