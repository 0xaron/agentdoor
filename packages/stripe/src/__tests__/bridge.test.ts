import { describe, it, expect, vi, beforeEach } from "vitest";
import { StripeBridge } from "../bridge.js";
import type { StripeClientInterface, StripeCustomer, StripeInvoiceItem } from "../bridge.js";

/** Creates a mock Stripe client for testing. */
function createMockStripeClient(): StripeClientInterface {
  let customerCounter = 0;
  let invoiceItemCounter = 0;

  return {
    createCustomer: vi.fn().mockImplementation(async (params) => {
      customerCounter++;
      return {
        id: `cus_test_${customerCounter}`,
        name: params.name,
        metadata: params.metadata,
      } satisfies StripeCustomer;
    }),
    createInvoiceItem: vi.fn().mockImplementation(async (params) => {
      invoiceItemCounter++;
      return {
        id: `ii_test_${invoiceItemCounter}`,
        customer: params.customer,
        amount: params.amount,
        currency: params.currency,
        description: params.description,
        metadata: params.metadata,
      } satisfies StripeInvoiceItem;
    }),
  };
}

describe("StripeBridge", () => {
  let bridge: StripeBridge;
  let mockClient: StripeClientInterface;

  beforeEach(() => {
    bridge = new StripeBridge({ stripeSecretKey: "sk_test_xxx" });
    mockClient = createMockStripeClient();
    bridge.setStripeClient(mockClient);
  });

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("creates a bridge with default config", () => {
      const b = new StripeBridge({ stripeSecretKey: "sk_test" });
      expect(b).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // reconcilePayment
  // -------------------------------------------------------------------------

  describe("reconcilePayment", () => {
    it("creates a customer and invoice item for a new agent", async () => {
      const result = await bridge.reconcilePayment({
        agentId: "ag_test_1",
        amount: 100,
        currency: "usd",
        scope: "data.read",
        timestamp: new Date(),
      });

      expect(result.success).toBe(true);
      expect(result.stripeCustomerId).toBe("cus_test_1");
      expect(result.invoiceItemId).toBe("ii_test_1");
      expect(mockClient.createCustomer).toHaveBeenCalledTimes(1);
      expect(mockClient.createInvoiceItem).toHaveBeenCalledTimes(1);
    });

    it("reuses existing customer for the same agent", async () => {
      await bridge.reconcilePayment({
        agentId: "ag_test_1",
        amount: 100,
        currency: "usd",
        timestamp: new Date(),
      });

      await bridge.reconcilePayment({
        agentId: "ag_test_1",
        amount: 50,
        currency: "usd",
        timestamp: new Date(),
      });

      // Customer should only be created once
      expect(mockClient.createCustomer).toHaveBeenCalledTimes(1);
      // But two invoice items
      expect(mockClient.createInvoiceItem).toHaveBeenCalledTimes(2);
    });

    it("includes x402 tx hash in metadata", async () => {
      await bridge.reconcilePayment({
        agentId: "ag_test_1",
        amount: 100,
        currency: "usd",
        x402TxHash: "0xabc123",
        timestamp: new Date(),
      });

      expect(mockClient.createInvoiceItem).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            x402_tx_hash: "0xabc123",
          }),
        }),
      );
    });

    it("includes scope in invoice item description", async () => {
      await bridge.reconcilePayment({
        agentId: "ag_test_1",
        amount: 100,
        currency: "usd",
        scope: "data.write",
        timestamp: new Date(),
      });

      expect(mockClient.createInvoiceItem).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining("data.write"),
        }),
      );
    });

    it("fails gracefully without a Stripe client", async () => {
      const noClient = new StripeBridge({ stripeSecretKey: "sk_test" });
      const result = await noClient.reconcilePayment({
        agentId: "ag_test_1",
        amount: 100,
        currency: "usd",
        timestamp: new Date(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Stripe client not configured");
    });

    it("fails when auto-create is disabled and no mapping exists", async () => {
      const noAuto = new StripeBridge({
        stripeSecretKey: "sk_test",
        autoCreateCustomers: false,
      });
      noAuto.setStripeClient(mockClient);

      const result = await noAuto.reconcilePayment({
        agentId: "ag_test_1",
        amount: 100,
        currency: "usd",
        timestamp: new Date(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("No Stripe customer found");
    });

    it("handles Stripe API errors gracefully", async () => {
      const errorClient: StripeClientInterface = {
        createCustomer: vi.fn().mockRejectedValue(new Error("Stripe API error")),
        createInvoiceItem: vi.fn(),
      };
      bridge.setStripeClient(errorClient);

      const result = await bridge.reconcilePayment({
        agentId: "ag_test_1",
        amount: 100,
        currency: "usd",
        timestamp: new Date(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Stripe API error");
    });

    it("calls onCustomerCreated callback", async () => {
      const onCustomerCreated = vi.fn();
      const b = new StripeBridge({
        stripeSecretKey: "sk_test",
        callbacks: { onCustomerCreated },
      });
      b.setStripeClient(mockClient);

      await b.reconcilePayment({
        agentId: "ag_test_1",
        amount: 100,
        currency: "usd",
        timestamp: new Date(),
      });

      expect(onCustomerCreated).toHaveBeenCalledWith("ag_test_1", "cus_test_1");
    });

    it("calls onInvoiceItemCreated callback", async () => {
      const onInvoiceItemCreated = vi.fn();
      const b = new StripeBridge({
        stripeSecretKey: "sk_test",
        callbacks: { onInvoiceItemCreated },
      });
      b.setStripeClient(mockClient);

      await b.reconcilePayment({
        agentId: "ag_test_1",
        amount: 100,
        currency: "usd",
        timestamp: new Date(),
      });

      expect(onInvoiceItemCreated).toHaveBeenCalledWith("ag_test_1", 100, "usd");
    });

    it("calls onReconciliationError callback on failure", async () => {
      const onReconciliationError = vi.fn();
      const b = new StripeBridge({
        stripeSecretKey: "sk_test",
        callbacks: { onReconciliationError },
      });
      const errorClient: StripeClientInterface = {
        createCustomer: vi.fn().mockRejectedValue(new Error("fail")),
        createInvoiceItem: vi.fn(),
      };
      b.setStripeClient(errorClient);

      await b.reconcilePayment({
        agentId: "ag_test_1",
        amount: 100,
        currency: "usd",
        timestamp: new Date(),
      });

      expect(onReconciliationError).toHaveBeenCalledWith("ag_test_1", expect.any(Error));
    });
  });

  // -------------------------------------------------------------------------
  // Customer Mapping
  // -------------------------------------------------------------------------

  describe("mapCustomer / getCustomerMapping", () => {
    it("manually maps an agent to a Stripe customer", () => {
      bridge.mapCustomer("ag_test_1", "cus_existing");
      const mapping = bridge.getCustomerMapping("ag_test_1");
      expect(mapping).toBeDefined();
      expect(mapping!.stripeCustomerId).toBe("cus_existing");
    });

    it("returns undefined for unmapped agent", () => {
      expect(bridge.getCustomerMapping("ag_none")).toBeUndefined();
    });

    it("uses manual mapping instead of creating a new customer", async () => {
      bridge.mapCustomer("ag_test_1", "cus_manual");

      await bridge.reconcilePayment({
        agentId: "ag_test_1",
        amount: 100,
        currency: "usd",
        timestamp: new Date(),
      });

      expect(mockClient.createCustomer).not.toHaveBeenCalled();
      expect(mockClient.createInvoiceItem).toHaveBeenCalledWith(
        expect.objectContaining({ customer: "cus_manual" }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // getAllMappings / clearMappings
  // -------------------------------------------------------------------------

  describe("getAllMappings / clearMappings", () => {
    it("returns all mappings", async () => {
      await bridge.reconcilePayment({ agentId: "ag_1", amount: 10, currency: "usd", timestamp: new Date() });
      await bridge.reconcilePayment({ agentId: "ag_2", amount: 20, currency: "usd", timestamp: new Date() });

      const mappings = bridge.getAllMappings();
      expect(mappings).toHaveLength(2);
    });

    it("clears all mappings", async () => {
      await bridge.reconcilePayment({ agentId: "ag_1", amount: 10, currency: "usd", timestamp: new Date() });
      bridge.clearMappings();
      expect(bridge.getAllMappings()).toHaveLength(0);
    });
  });
});
