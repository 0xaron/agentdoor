import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextAuthCompanion } from "../companion.js";
import type { NextAuthProviderResult, NextAuthAgentUser } from "../companion.js";
import type { Agent } from "@agentgate/core";

/** Creates a mock Agent for testing. */
function createMockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "ag_test_1",
    publicKey: "base64_pub_key",
    scopesGranted: ["data.read"],
    apiKeyHash: "hash_abc",
    rateLimit: { windowMs: 60000, maxRequests: 100 },
    reputation: 80,
    metadata: { name: "TestAgent", framework: "langchain" },
    status: "active",
    createdAt: new Date("2025-01-01"),
    lastAuthAt: new Date("2025-01-01"),
    totalRequests: 0,
    totalX402Paid: 0,
    ...overrides,
  };
}

describe("NextAuthCompanion", () => {
  let companion: NextAuthCompanion;

  beforeEach(() => {
    companion = new NextAuthCompanion();
  });

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("creates a companion with default config", () => {
      const c = new NextAuthCompanion();
      expect(c).toBeDefined();
    });

    it("creates a companion with custom config", () => {
      const c = new NextAuthCompanion({
        agentSessionType: "bot",
        sessionCallback: () => ({ custom: true }),
      });
      expect(c).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // createProvider
  // -------------------------------------------------------------------------

  describe("createProvider", () => {
    it("returns a provider with correct structure", () => {
      const provider = companion.createProvider();

      expect(provider.id).toBe("agentgate");
      expect(provider.name).toBe("AgentGate Agent");
      expect(provider.type).toBe("credentials");
      expect(provider.credentials).toHaveProperty("agentId");
      expect(provider.credentials).toHaveProperty("apiKey");
      expect(typeof provider.authorize).toBe("function");
    });

    it("authorize returns agent user for a registered agent", async () => {
      const agent = createMockAgent();
      companion.registerAgent(agent);

      const provider = companion.createProvider();
      const user = await provider.authorize({ agentId: "ag_test_1", apiKey: "key123" });

      expect(user).not.toBeNull();
      expect(user!.id).toBe("ag_test_1");
      expect(user!.type).toBe("agent");
      expect(user!.agentId).toBe("ag_test_1");
      expect(user!.scopes).toEqual(["data.read"]);
      expect(user!.publicKey).toBe("base64_pub_key");
    });

    it("authorize returns null for an unregistered agent", async () => {
      const provider = companion.createProvider();
      const user = await provider.authorize({ agentId: "ag_unknown", apiKey: "key123" });

      expect(user).toBeNull();
    });

    it("authorize returns null when agentId is missing", async () => {
      const provider = companion.createProvider();
      const user = await provider.authorize({ apiKey: "key123" });

      expect(user).toBeNull();
    });

    it("authorize returns null for suspended agents", async () => {
      const agent = createMockAgent({ status: "suspended" });
      companion.registerAgent(agent);

      const provider = companion.createProvider();
      const user = await provider.authorize({ agentId: "ag_test_1", apiKey: "key123" });

      expect(user).toBeNull();
    });

    it("authorize returns null for banned agents", async () => {
      const agent = createMockAgent({ status: "banned" });
      companion.registerAgent(agent);

      const provider = companion.createProvider();
      const user = await provider.authorize({ agentId: "ag_test_1", apiKey: "key123" });

      expect(user).toBeNull();
    });

    it("authorize uses agent metadata name when available", async () => {
      const agent = createMockAgent({ metadata: { name: "CustomBot", framework: "langchain" } });
      companion.registerAgent(agent);

      const provider = companion.createProvider();
      const user = await provider.authorize({ agentId: "ag_test_1", apiKey: "key123" });

      expect(user!.name).toBe("CustomBot");
    });

    it("authorize generates fallback name when metadata has no name", async () => {
      const agent = createMockAgent({ metadata: { framework: "langchain" } });
      companion.registerAgent(agent);

      const provider = companion.createProvider();
      const user = await provider.authorize({ agentId: "ag_test_1", apiKey: "key123" });

      expect(user!.name).toBe("Agent ag_test_1");
    });

    it("authorize creates synthetic email from agent ID", async () => {
      const agent = createMockAgent();
      companion.registerAgent(agent);

      const provider = companion.createProvider();
      const user = await provider.authorize({ agentId: "ag_test_1", apiKey: "key123" });

      expect(user!.email).toBe("ag_test_1@agentgate.local");
    });
  });

  // -------------------------------------------------------------------------
  // sessionCallback
  // -------------------------------------------------------------------------

  describe("sessionCallback", () => {
    it("enriches session with agent data when token is agent type", () => {
      const session = { user: { name: "test" } };
      const token = { type: "agent", agentId: "ag_test_1", scopes: ["data.read"] };

      const result = companion.sessionCallback({ session, token });

      expect(result.type).toBe("agent");
      expect(result.agentId).toBe("ag_test_1");
      expect(result.scopes).toEqual(["data.read"]);
    });

    it("uses custom session type when configured", () => {
      const customCompanion = new NextAuthCompanion({ agentSessionType: "bot" });
      const session = { user: { name: "test" } };
      const token = { type: "agent", agentId: "ag_test_1", scopes: ["data.read"] };

      const result = customCompanion.sessionCallback({ session, token });

      expect(result.type).toBe("bot");
    });

    it("does not modify session when token is not agent type", () => {
      const session = { user: { name: "human" } };
      const token = { type: "user", sub: "user123" };

      const result = companion.sessionCallback({ session, token });

      expect(result.type).toBeUndefined();
      expect(result.agentId).toBeUndefined();
    });

    it("preserves existing session properties", () => {
      const session = { user: { name: "test" }, expires: "2025-12-31" };
      const token = { type: "agent", agentId: "ag_test_1", scopes: [] };

      const result = companion.sessionCallback({ session, token });

      expect(result.expires).toBe("2025-12-31");
      expect(result.user.name).toBe("test");
    });
  });

  // -------------------------------------------------------------------------
  // registerAgent
  // -------------------------------------------------------------------------

  describe("registerAgent", () => {
    it("registers an agent that can then be authorized", async () => {
      const agent = createMockAgent();
      companion.registerAgent(agent);

      const provider = companion.createProvider();
      const user = await provider.authorize({ agentId: "ag_test_1", apiKey: "key" });
      expect(user).not.toBeNull();
    });

    it("overwrites a previously registered agent", async () => {
      const agent1 = createMockAgent({ scopesGranted: ["data.read"] });
      companion.registerAgent(agent1);

      const agent2 = createMockAgent({ scopesGranted: ["data.read", "data.write"] });
      companion.registerAgent(agent2);

      const provider = companion.createProvider();
      const user = await provider.authorize({ agentId: "ag_test_1", apiKey: "key" });
      expect(user!.scopes).toEqual(["data.read", "data.write"]);
    });
  });

  // -------------------------------------------------------------------------
  // getAgentSession
  // -------------------------------------------------------------------------

  describe("getAgentSession", () => {
    it("returns a session for a registered agent", () => {
      const agent = createMockAgent();
      companion.registerAgent(agent);

      const session = companion.getAgentSession("ag_test_1");

      expect(session).not.toBeNull();
      expect(session!.type).toBe("agent");
      expect(session!.agentId).toBe("ag_test_1");
      expect(session!.scopes).toEqual(["data.read"]);
      expect(session!.user.type).toBe("agent");
      expect(session!.user.publicKey).toBe("base64_pub_key");
    });

    it("returns null for an unregistered agent", () => {
      const session = companion.getAgentSession("ag_nonexistent");
      expect(session).toBeNull();
    });

    it("returns correct scopes from the registered agent", () => {
      const agent = createMockAgent({ scopesGranted: ["data.read", "data.write", "admin"] });
      companion.registerAgent(agent);

      const session = companion.getAgentSession("ag_test_1");
      expect(session!.scopes).toEqual(["data.read", "data.write", "admin"]);
    });

    it("uses agent metadata name in session user", () => {
      const agent = createMockAgent({ metadata: { name: "SuperBot", framework: "langchain" } });
      companion.registerAgent(agent);

      const session = companion.getAgentSession("ag_test_1");
      expect(session!.user.name).toBe("SuperBot");
    });
  });
});
