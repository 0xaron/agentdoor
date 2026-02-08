/**
 * @agentgate/stripe - Stripe Billing Bridge
 *
 * Maps x402 agent payments to Stripe invoice items.
 * Each agent gets a Stripe customer record, and each x402 payment
 * becomes a Stripe invoice line item for unified billing visibility.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the Stripe billing bridge. */
export interface StripeBridgeConfig {
  /** Stripe API secret key */
  stripeSecretKey: string;
  /** Whether to auto-create Stripe customers for agents. Default: true */
  autoCreateCustomers?: boolean;
  /** Default currency for Stripe items (e.g., "usd"). Default: "usd" */
  defaultCurrency?: string;
  /** Metadata to add to all Stripe customers/invoices */
  metadata?: Record<string, string>;
  /** Optional callbacks for bridge events */
  callbacks?: StripeBridgeCallbacks;
}

/** Callbacks for Stripe bridge events. */
export interface StripeBridgeCallbacks {
  /** Called when a new Stripe customer is created for an agent */
  onCustomerCreated?: (agentId: string, stripeCustomerId: string) => void | Promise<void>;
  /** Called when an invoice item is created */
  onInvoiceItemCreated?: (agentId: string, amount: number, currency: string) => void | Promise<void>;
  /** Called when reconciliation fails */
  onReconciliationError?: (agentId: string, error: Error) => void | Promise<void>;
}

/** A record of an x402 payment to be reconciled. */
export interface PaymentRecord {
  /** Agent ID */
  agentId: string;
  /** Payment amount (in smallest currency unit for Stripe, e.g., cents) */
  amount: number;
  /** Currency code (e.g., "usd", "usdc") */
  currency: string;
  /** Scope/endpoint that was accessed */
  scope?: string;
  /** x402 transaction hash (for reference) */
  x402TxHash?: string;
  /** Timestamp of the payment */
  timestamp: Date;
  /** Additional metadata */
  metadata?: Record<string, string>;
}

/** Mapping between an AgentGate agent and a Stripe customer. */
export interface StripeCustomerMapping {
  /** AgentGate agent ID */
  agentId: string;
  /** Stripe customer ID */
  stripeCustomerId: string;
  /** When this mapping was created */
  createdAt: Date;
}

/** Result of a payment reconciliation attempt. */
export interface ReconciliationResult {
  /** Whether reconciliation succeeded */
  success: boolean;
  /** Stripe invoice item ID (if created) */
  invoiceItemId?: string;
  /** Stripe customer ID */
  stripeCustomerId?: string;
  /** Error message (if failed) */
  error?: string;
}

// ---------------------------------------------------------------------------
// StripeBridge Class
// ---------------------------------------------------------------------------

/**
 * Stripe billing bridge for AgentGate.
 *
 * Maps x402 agent payments to Stripe invoice items so SaaS owners
 * can see all revenue (human + agent) in their existing Stripe dashboard.
 *
 * Usage:
 * ```ts
 * const bridge = new StripeBridge({
 *   stripeSecretKey: process.env.STRIPE_SECRET_KEY!,
 * });
 *
 * // When an agent makes an x402 payment:
 * await bridge.reconcilePayment({
 *   agentId: "ag_xxx",
 *   amount: 100, // cents
 *   currency: "usd",
 *   scope: "data.read",
 * });
 * ```
 *
 * Note: This class uses a pluggable Stripe client interface to support
 * testing without the actual Stripe SDK. In production, pass the real
 * Stripe instance.
 */
export class StripeBridge {
  private config: Required<Pick<StripeBridgeConfig, "autoCreateCustomers" | "defaultCurrency">> & StripeBridgeConfig;
  private customerMappings: Map<string, StripeCustomerMapping> = new Map();
  private stripeClient: StripeClientInterface | null = null;

  constructor(config: StripeBridgeConfig) {
    this.config = {
      ...config,
      autoCreateCustomers: config.autoCreateCustomers ?? true,
      defaultCurrency: config.defaultCurrency ?? "usd",
    };
  }

  /**
   * Set the Stripe client instance. This allows injecting a mock
   * for testing or the real Stripe SDK for production.
   */
  setStripeClient(client: StripeClientInterface): void {
    this.stripeClient = client;
  }

  /**
   * Reconcile an x402 payment as a Stripe invoice item.
   *
   * @param payment - Payment record to reconcile
   * @returns Reconciliation result
   */
  async reconcilePayment(payment: PaymentRecord): Promise<ReconciliationResult> {
    try {
      if (!this.stripeClient) {
        return {
          success: false,
          error: "Stripe client not configured. Call setStripeClient() first.",
        };
      }

      // Get or create the Stripe customer for this agent
      let mapping = this.customerMappings.get(payment.agentId);

      if (!mapping && this.config.autoCreateCustomers) {
        const customer = await this.stripeClient.createCustomer({
          name: `AgentGate Agent: ${payment.agentId}`,
          metadata: {
            agentgate_agent_id: payment.agentId,
            source: "agentgate",
            ...this.config.metadata,
          },
        });

        mapping = {
          agentId: payment.agentId,
          stripeCustomerId: customer.id,
          createdAt: new Date(),
        };
        this.customerMappings.set(payment.agentId, mapping);

        if (this.config.callbacks?.onCustomerCreated) {
          await Promise.resolve(
            this.config.callbacks.onCustomerCreated(payment.agentId, customer.id),
          );
        }
      }

      if (!mapping) {
        return {
          success: false,
          error: `No Stripe customer found for agent ${payment.agentId}. Enable autoCreateCustomers or map manually.`,
        };
      }

      // Create the invoice item
      const invoiceItem = await this.stripeClient.createInvoiceItem({
        customer: mapping.stripeCustomerId,
        amount: payment.amount,
        currency: payment.currency || this.config.defaultCurrency,
        description: `AgentGate x402 payment${payment.scope ? ` - ${payment.scope}` : ""}`,
        metadata: {
          agentgate_agent_id: payment.agentId,
          x402_tx_hash: payment.x402TxHash ?? "",
          scope: payment.scope ?? "",
          ...payment.metadata,
        },
      });

      if (this.config.callbacks?.onInvoiceItemCreated) {
        await Promise.resolve(
          this.config.callbacks.onInvoiceItemCreated(
            payment.agentId,
            payment.amount,
            payment.currency,
          ),
        );
      }

      return {
        success: true,
        invoiceItemId: invoiceItem.id,
        stripeCustomerId: mapping.stripeCustomerId,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (this.config.callbacks?.onReconciliationError) {
        await Promise.resolve(
          this.config.callbacks.onReconciliationError(payment.agentId, error),
        );
      }

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Manually map an agent to a Stripe customer.
   *
   * @param agentId - AgentGate agent ID
   * @param stripeCustomerId - Stripe customer ID
   */
  mapCustomer(agentId: string, stripeCustomerId: string): void {
    this.customerMappings.set(agentId, {
      agentId,
      stripeCustomerId,
      createdAt: new Date(),
    });
  }

  /**
   * Get the Stripe customer mapping for an agent.
   *
   * @param agentId - AgentGate agent ID
   * @returns Mapping or undefined if not mapped
   */
  getCustomerMapping(agentId: string): StripeCustomerMapping | undefined {
    return this.customerMappings.get(agentId);
  }

  /**
   * Get all customer mappings.
   */
  getAllMappings(): StripeCustomerMapping[] {
    return Array.from(this.customerMappings.values());
  }

  /**
   * Clear all customer mappings.
   */
  clearMappings(): void {
    this.customerMappings.clear();
  }
}

// ---------------------------------------------------------------------------
// Stripe Client Interface (for testing without real Stripe SDK)
// ---------------------------------------------------------------------------

/** Minimal Stripe customer object. */
export interface StripeCustomer {
  id: string;
  name?: string;
  metadata?: Record<string, string>;
}

/** Minimal Stripe invoice item object. */
export interface StripeInvoiceItem {
  id: string;
  customer: string;
  amount: number;
  currency: string;
  description?: string;
  metadata?: Record<string, string>;
}

/** Interface for the Stripe client operations we need. */
export interface StripeClientInterface {
  createCustomer(params: {
    name: string;
    metadata?: Record<string, string>;
  }): Promise<StripeCustomer>;

  createInvoiceItem(params: {
    customer: string;
    amount: number;
    currency: string;
    description?: string;
    metadata?: Record<string, string>;
  }): Promise<StripeInvoiceItem>;
}
