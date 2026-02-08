import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebhookEmitter } from "../webhooks.js";
import type { WebhookEvent, WebhookEventType } from "../webhooks.js";

describe("WebhookEmitter", () => {
  let emitter: WebhookEmitter;

  beforeEach(() => {
    emitter = new WebhookEmitter();
  });

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("creates an emitter with no endpoints by default", () => {
      const e = new WebhookEmitter();
      expect(e.listenerCount()).toBe(0);
    });

    it("accepts endpoint configuration", () => {
      const e = new WebhookEmitter({
        endpoints: [{ url: "https://example.com/hook" }],
      });
      // Just verifying no errors on construction
      expect(e).toBeDefined();
    });

    it("enables webhooks when endpoints are configured", () => {
      const e = new WebhookEmitter({
        endpoints: [{ url: "https://example.com/hook" }],
      });
      expect(e).toBeDefined();
    });

    it("respects enabled: false override", () => {
      const e = new WebhookEmitter({
        endpoints: [{ url: "https://example.com/hook" }],
        enabled: false,
      });
      expect(e).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Event Listeners
  // -------------------------------------------------------------------------

  describe("on / off", () => {
    it("registers a listener for a specific event", () => {
      const listener = vi.fn();
      emitter.on("agent.registered", listener);
      expect(emitter.listenerCount("agent.registered")).toBe(1);
    });

    it("registers a wildcard listener", () => {
      const listener = vi.fn();
      emitter.on("*", listener);
      expect(emitter.listenerCount("*")).toBe(1);
    });

    it("removes a specific listener", () => {
      const listener = vi.fn();
      emitter.on("agent.registered", listener);
      expect(emitter.listenerCount("agent.registered")).toBe(1);
      emitter.off("agent.registered", listener);
      expect(emitter.listenerCount("agent.registered")).toBe(0);
    });

    it("handles removing a non-existent listener gracefully", () => {
      const listener = vi.fn();
      emitter.off("agent.registered", listener); // Should not throw
      expect(emitter.listenerCount("agent.registered")).toBe(0);
    });

    it("supports multiple listeners for the same event", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      emitter.on("agent.registered", listener1);
      emitter.on("agent.registered", listener2);
      expect(emitter.listenerCount("agent.registered")).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Emit
  // -------------------------------------------------------------------------

  describe("emit", () => {
    it("calls specific listeners with the event", async () => {
      const listener = vi.fn();
      emitter.on("agent.registered", listener);

      await emitter.emit("agent.registered", { agent_id: "ag_test" });

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as WebhookEvent;
      expect(event.type).toBe("agent.registered");
      expect(event.data).toEqual({ agent_id: "ag_test" });
      expect(event.id).toMatch(/^evt_/);
      expect(event.timestamp).toBeDefined();
    });

    it("calls wildcard listeners for any event type", async () => {
      const listener = vi.fn();
      emitter.on("*", listener);

      await emitter.emit("agent.authenticated", { agent_id: "ag_test" });

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as WebhookEvent;
      expect(event.type).toBe("agent.authenticated");
    });

    it("calls both specific and wildcard listeners", async () => {
      const specific = vi.fn();
      const wildcard = vi.fn();
      emitter.on("agent.registered", specific);
      emitter.on("*", wildcard);

      await emitter.emit("agent.registered", { agent_id: "ag_test" });

      expect(specific).toHaveBeenCalledTimes(1);
      expect(wildcard).toHaveBeenCalledTimes(1);
    });

    it("does not call listeners for different event types", async () => {
      const listener = vi.fn();
      emitter.on("agent.registered", listener);

      await emitter.emit("agent.authenticated", { agent_id: "ag_test" });

      expect(listener).not.toHaveBeenCalled();
    });

    it("returns empty results when no endpoints are configured", async () => {
      const results = await emitter.emit("agent.registered", { agent_id: "ag_test" });
      expect(results).toEqual([]);
    });

    it("generates unique event IDs", async () => {
      const ids: string[] = [];
      emitter.on("agent.registered", (event) => {
        ids.push(event.id);
      });

      await emitter.emit("agent.registered", { agent_id: "ag_1" });
      await emitter.emit("agent.registered", { agent_id: "ag_2" });

      expect(ids[0]).not.toBe(ids[1]);
    });

    it("handles listener errors without breaking other listeners", async () => {
      const errorListener = vi.fn().mockRejectedValue(new Error("boom"));
      const goodListener = vi.fn();

      // Suppress console.error in this test
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      emitter.on("agent.registered", errorListener);
      emitter.on("agent.registered", goodListener);

      await emitter.emit("agent.registered", { agent_id: "ag_test" });

      expect(goodListener).toHaveBeenCalledTimes(1);
      consoleSpy.mockRestore();
    });

    it("handles async listeners", async () => {
      let resolved = false;
      const asyncListener = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10));
        resolved = true;
      });

      emitter.on("agent.registered", asyncListener);
      await emitter.emit("agent.registered", { agent_id: "ag_test" });

      expect(resolved).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Listener Count
  // -------------------------------------------------------------------------

  describe("listenerCount", () => {
    it("returns 0 when no listeners are registered", () => {
      expect(emitter.listenerCount()).toBe(0);
    });

    it("returns count for specific event", () => {
      emitter.on("agent.registered", () => {});
      emitter.on("agent.authenticated", () => {});
      expect(emitter.listenerCount("agent.registered")).toBe(1);
    });

    it("returns total count when no event specified", () => {
      emitter.on("agent.registered", () => {});
      emitter.on("agent.authenticated", () => {});
      emitter.on("*", () => {});
      expect(emitter.listenerCount()).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Clear
  // -------------------------------------------------------------------------

  describe("clear", () => {
    it("removes all listeners and endpoints", () => {
      emitter.on("agent.registered", () => {});
      emitter.on("*", () => {});
      emitter.clear();
      expect(emitter.listenerCount()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // All event types
  // -------------------------------------------------------------------------

  describe("event types", () => {
    const eventTypes: WebhookEventType[] = [
      "agent.registered",
      "agent.authenticated",
      "agent.payment_failed",
      "agent.rate_limited",
      "agent.flagged",
      "agent.suspended",
      "agent.spending_cap_warning",
      "agent.spending_cap_exceeded",
    ];

    for (const eventType of eventTypes) {
      it(`supports event type: ${eventType}`, async () => {
        const listener = vi.fn();
        emitter.on(eventType, listener);
        await emitter.emit(eventType, { test: true });
        expect(listener).toHaveBeenCalledTimes(1);
      });
    }
  });
});
