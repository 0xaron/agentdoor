/**
 * @agentdoor/core - Webhook Events System
 *
 * Provides an event emitter for agent lifecycle events and
 * optional HTTP webhook delivery for external integrations.
 *
 * P1 Feature: Webhook Events
 * Events: agent.registered, agent.authenticated, agent.payment_failed,
 *         agent.rate_limited, agent.flagged, agent.suspended,
 *         agent.spending_cap_warning, agent.spending_cap_exceeded
 */

// ---------------------------------------------------------------------------
// Event Types
// ---------------------------------------------------------------------------

/** All possible webhook event types. */
export type WebhookEventType =
  | "agent.registered"
  | "agent.authenticated"
  | "agent.payment_failed"
  | "agent.rate_limited"
  | "agent.flagged"
  | "agent.suspended"
  | "agent.spending_cap_warning"
  | "agent.spending_cap_exceeded";

/** Payload for a webhook event. */
export interface WebhookEvent<T = Record<string, unknown>> {
  /** Unique event ID */
  id: string;
  /** Event type */
  type: WebhookEventType;
  /** When the event occurred (ISO 8601) */
  timestamp: string;
  /** Event payload data */
  data: T;
}

/** Agent registration event data. */
export interface AgentRegisteredData {
  agent_id: string;
  public_key: string;
  scopes_granted: string[];
  x402_wallet?: string;
  metadata: Record<string, string>;
}

/** Agent authentication event data. */
export interface AgentAuthenticatedData {
  agent_id: string;
  method: "api_key" | "jwt" | "challenge";
  ip?: string;
}

/** Payment failure event data. */
export interface AgentPaymentFailedData {
  agent_id: string;
  amount: string;
  currency: string;
  reason: string;
}

/** Rate limit event data. */
export interface AgentRateLimitedData {
  agent_id: string;
  limit: number;
  window: string;
  retry_after_seconds: number;
}

/** Agent flagged event data. */
export interface AgentFlaggedData {
  agent_id: string;
  reason: string;
  reputation_score: number;
}

/** Spending cap event data. */
export interface AgentSpendingCapData {
  agent_id: string;
  current_spend: number;
  cap_amount: number;
  cap_period: "daily" | "monthly";
  cap_type: "soft" | "hard";
}

// ---------------------------------------------------------------------------
// Webhook Configuration
// ---------------------------------------------------------------------------

/** Configuration for a single webhook endpoint. */
export interface WebhookEndpointConfig {
  /** URL to deliver webhook events to */
  url: string;
  /** Event types to subscribe to. If empty/undefined, subscribes to all events. */
  events?: WebhookEventType[];
  /** Optional secret for HMAC-SHA256 signature verification */
  secret?: string;
  /** Custom headers to include in webhook requests */
  headers?: Record<string, string>;
  /** Maximum retry attempts for failed deliveries. Default: 3 */
  maxRetries?: number;
  /** Timeout in milliseconds. Default: 10000 */
  timeoutMs?: number;
}

/** Configuration for the webhook system. */
export interface WebhooksConfig {
  /** Webhook endpoints to deliver events to */
  endpoints?: WebhookEndpointConfig[];
  /** Whether webhooks are enabled. Default: true if endpoints are configured. */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Event Listener Type
// ---------------------------------------------------------------------------

/** Callback function for event listeners. */
export type WebhookEventListener = (event: WebhookEvent) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Webhook Delivery Result
// ---------------------------------------------------------------------------

/** Result of a webhook delivery attempt. */
export interface WebhookDeliveryResult {
  /** Endpoint URL */
  url: string;
  /** Whether delivery succeeded */
  success: boolean;
  /** HTTP status code (if applicable) */
  statusCode?: number;
  /** Error message (if failed) */
  error?: string;
  /** Number of attempts made */
  attempts: number;
}

// ---------------------------------------------------------------------------
// WebhookEmitter Class
// ---------------------------------------------------------------------------

/**
 * Event emitter and HTTP webhook delivery system for AgentDoor.
 *
 * Supports:
 * - In-process event listeners (synchronous callbacks)
 * - HTTP webhook delivery to external endpoints
 * - HMAC-SHA256 signature verification
 * - Retry logic with exponential backoff
 *
 * Usage:
 * ```ts
 * const emitter = new WebhookEmitter({
 *   endpoints: [{ url: "https://hooks.example.com/agentdoor", secret: "whsec_..." }]
 * });
 *
 * emitter.on("agent.registered", (event) => {
 *   console.log("Agent registered:", event.data.agent_id);
 * });
 *
 * await emitter.emit("agent.registered", { agent_id: "ag_xxx", ... });
 * ```
 */
export class WebhookEmitter {
  private listeners: Map<string, Set<WebhookEventListener>> = new Map();
  private endpoints: WebhookEndpointConfig[];
  private enabled: boolean;
  private eventCounter: number = 0;

  constructor(config?: WebhooksConfig) {
    this.endpoints = config?.endpoints ?? [];
    this.enabled = config?.enabled ?? this.endpoints.length > 0;
  }

  /**
   * Register an event listener for a specific event type.
   *
   * @param eventType - The event type to listen for, or "*" for all events
   * @param listener - Callback function
   */
  on(eventType: WebhookEventType | "*", listener: WebhookEventListener): void {
    const key = eventType;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(listener);
  }

  /**
   * Remove an event listener.
   *
   * @param eventType - The event type
   * @param listener - The listener function to remove
   */
  off(eventType: WebhookEventType | "*", listener: WebhookEventListener): void {
    const set = this.listeners.get(eventType);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(eventType);
      }
    }
  }

  /**
   * Emit an event. Notifies all in-process listeners and
   * delivers to configured HTTP webhook endpoints.
   *
   * @param type - Event type
   * @param data - Event payload data
   * @returns Array of webhook delivery results (empty if no HTTP endpoints)
   */
  async emit<T extends Record<string, unknown>>(
    type: WebhookEventType,
    data: T,
  ): Promise<WebhookDeliveryResult[]> {
    const event: WebhookEvent<T> = {
      id: `evt_${Date.now()}_${++this.eventCounter}`,
      type,
      timestamp: new Date().toISOString(),
      data,
    };

    // Notify in-process listeners
    await this.notifyListeners(event);

    // Deliver to HTTP endpoints
    if (!this.enabled || this.endpoints.length === 0) {
      return [];
    }

    const results: WebhookDeliveryResult[] = [];
    const deliveryPromises = this.endpoints
      .filter((ep) => !ep.events || ep.events.length === 0 || ep.events.includes(type))
      .map((ep) => this.deliverToEndpoint(ep, event));

    const settled = await Promise.allSettled(deliveryPromises);
    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        results.push({
          url: "unknown",
          success: false,
          error: result.reason?.message ?? "Delivery failed",
          attempts: 0,
        });
      }
    }

    return results;
  }

  /**
   * Get the number of registered listeners for a given event type.
   */
  listenerCount(eventType?: WebhookEventType | "*"): number {
    if (eventType) {
      return this.listeners.get(eventType)?.size ?? 0;
    }
    let count = 0;
    for (const set of this.listeners.values()) {
      count += set.size;
    }
    return count;
  }

  /**
   * Remove all listeners and endpoints.
   */
  clear(): void {
    this.listeners.clear();
    this.endpoints = [];
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async notifyListeners(event: WebhookEvent): Promise<void> {
    // Notify specific listeners
    const specific = this.listeners.get(event.type);
    if (specific) {
      for (const listener of specific) {
        try {
          await Promise.resolve(listener(event));
        } catch (err) {
          console.error(`[agentdoor] Webhook listener error for ${event.type}:`, err);
        }
      }
    }

    // Notify wildcard listeners
    const wildcard = this.listeners.get("*");
    if (wildcard) {
      for (const listener of wildcard) {
        try {
          await Promise.resolve(listener(event));
        } catch (err) {
          console.error(`[agentdoor] Webhook wildcard listener error:`, err);
        }
      }
    }
  }

  private async deliverToEndpoint(
    endpoint: WebhookEndpointConfig,
    event: WebhookEvent,
  ): Promise<WebhookDeliveryResult> {
    const maxRetries = endpoint.maxRetries ?? 3;
    const timeoutMs = endpoint.timeoutMs ?? 10_000;
    const payload = JSON.stringify(event);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "User-Agent": "AgentDoor-Webhooks/1.0",
          "X-AgentDoor-Event": event.type,
          "X-AgentDoor-Event-Id": event.id,
          "X-AgentDoor-Timestamp": event.timestamp,
          ...endpoint.headers,
        };

        // Add HMAC signature if secret is configured
        if (endpoint.secret) {
          const signature = await this.computeHmac(payload, endpoint.secret);
          headers["X-AgentDoor-Signature"] = `sha256=${signature}`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(endpoint.url, {
            method: "POST",
            headers,
            body: payload,
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (response.ok) {
            return {
              url: endpoint.url,
              success: true,
              statusCode: response.status,
              attempts: attempt,
            };
          }

          // Non-retryable status codes
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            return {
              url: endpoint.url,
              success: false,
              statusCode: response.status,
              error: `HTTP ${response.status}`,
              attempts: attempt,
            };
          }

          // Retryable: 429 or 5xx
          if (attempt < maxRetries) {
            await this.backoff(attempt);
          }
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        if (attempt >= maxRetries) {
          return {
            url: endpoint.url,
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
            attempts: attempt,
          };
        }
        await this.backoff(attempt);
      }
    }

    return {
      url: endpoint.url,
      success: false,
      error: "Max retries exceeded",
      attempts: maxRetries,
    };
  }

  private async computeHmac(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private backoff(attempt: number): Promise<void> {
    const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10_000);
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
