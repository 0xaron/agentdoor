/**
 * @agentdoor/stripe - Stripe Billing Bridge for AgentDoor
 *
 * Reconciles x402 agent payments as Stripe invoice items.
 * Allows SaaS owners to see all revenue (human + agent) in one Stripe dashboard.
 *
 * P1 Feature: Stripe Billing Bridge
 */

export { StripeBridge } from "./bridge.js";

export type {
  StripeBridgeConfig,
  StripeBridgeCallbacks,
  PaymentRecord,
  StripeCustomerMapping,
  ReconciliationResult,
} from "./bridge.js";
