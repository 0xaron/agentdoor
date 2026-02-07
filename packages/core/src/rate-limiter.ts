/**
 * @agentgate/core - Token Bucket Rate Limiter
 *
 * In-memory token bucket implementation with per-agent limits.
 * Configurable window size and request counts.
 */

import type { RateLimitConfig, RateLimitResult } from "./types.js";
import { DEFAULT_RATE_LIMIT } from "./constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Internal state for a single rate limit bucket. */
interface TokenBucket {
  /** Current number of available tokens */
  tokens: number;
  /** Maximum number of tokens (bucket capacity) */
  maxTokens: number;
  /** Tokens added per millisecond */
  refillRate: number;
  /** Last time the bucket was refilled */
  lastRefill: number;
}

// ---------------------------------------------------------------------------
// Window Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a rate limit window string into milliseconds.
 * Supports: "1s", "30s", "1m", "5m", "1h", "24h", "1d"
 *
 * @param window - Window duration string
 * @returns Duration in milliseconds
 */
export function parseWindow(window: string): number {
  const match = window.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(
      `Invalid rate limit window format: "${window}". ` +
        'Expected format like "1h", "30m", "100s", "1d".',
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown time unit: ${unit}`);
  }
}

// ---------------------------------------------------------------------------
// RateLimiter Class
// ---------------------------------------------------------------------------

/**
 * In-memory token bucket rate limiter.
 *
 * Each agent (or IP, or any string key) gets its own token bucket.
 * Tokens are refilled continuously based on the configured window and limit.
 *
 * Usage:
 * ```ts
 * const limiter = new RateLimiter();
 * const result = limiter.check("agent_123", { requests: 100, window: "1h" });
 * if (!result.allowed) {
 *   // Return 429 with result.retryAfter
 * }
 * ```
 */
export class RateLimiter {
  /** Map of bucket keys to their token bucket state */
  private buckets: Map<string, TokenBucket> = new Map();

  /** Default rate limit config applied when none is specified */
  private defaultConfig: RateLimitConfig;

  /** Interval handle for periodic cleanup */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Create a new RateLimiter instance.
   *
   * @param defaultConfig - Default rate limit applied when check() is called without config
   * @param cleanupIntervalMs - How often to clean expired buckets (default: 60s)
   */
  constructor(
    defaultConfig: RateLimitConfig = DEFAULT_RATE_LIMIT,
    cleanupIntervalMs: number = 60_000,
  ) {
    this.defaultConfig = defaultConfig;

    // Periodically clean up stale buckets to prevent memory leaks
    if (cleanupIntervalMs > 0) {
      this.cleanupInterval = setInterval(() => {
        this.cleanup();
      }, cleanupIntervalMs);

      // Allow the process to exit even if the interval is running
      if (typeof this.cleanupInterval === "object" && "unref" in this.cleanupInterval) {
        this.cleanupInterval.unref();
      }
    }
  }

  /**
   * Check if a request from the given key is allowed under the rate limit.
   * Consumes one token if allowed.
   *
   * @param key - Unique identifier (agent ID, IP address, etc.)
   * @param config - Rate limit configuration (uses default if not provided)
   * @returns RateLimitResult indicating if the request is allowed
   */
  check(key: string, config?: RateLimitConfig): RateLimitResult {
    const effectiveConfig = config ?? this.defaultConfig;
    const windowMs = parseWindow(effectiveConfig.window);
    const maxTokens = effectiveConfig.requests;
    const refillRate = maxTokens / windowMs; // tokens per millisecond

    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      // First request: create a new full bucket
      bucket = {
        tokens: maxTokens,
        maxTokens,
        refillRate,
        lastRefill: now,
      };
      this.buckets.set(key, bucket);
    } else {
      // Update bucket config if it changed
      bucket.maxTokens = maxTokens;
      bucket.refillRate = refillRate;

      // Refill tokens based on elapsed time
      const elapsed = now - bucket.lastRefill;
      const tokensToAdd = elapsed * refillRate;
      bucket.tokens = Math.min(maxTokens, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }

    // Check if there are enough tokens
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      const resetAt = now + windowMs;

      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        limit: maxTokens,
        resetAt,
      };
    }

    // Rate limited: calculate when the next token will be available
    const timeUntilToken = Math.ceil((1 - bucket.tokens) / refillRate);
    const resetAt = now + windowMs;

    return {
      allowed: false,
      remaining: 0,
      limit: maxTokens,
      resetAt,
      retryAfter: timeUntilToken,
    };
  }

  /**
   * Consume multiple tokens at once (for batch or weighted requests).
   *
   * @param key - Unique identifier
   * @param tokens - Number of tokens to consume
   * @param config - Rate limit configuration
   * @returns RateLimitResult
   */
  consume(key: string, tokens: number, config?: RateLimitConfig): RateLimitResult {
    const effectiveConfig = config ?? this.defaultConfig;
    const windowMs = parseWindow(effectiveConfig.window);
    const maxTokens = effectiveConfig.requests;
    const refillRate = maxTokens / windowMs;

    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = {
        tokens: maxTokens,
        maxTokens,
        refillRate,
        lastRefill: now,
      };
      this.buckets.set(key, bucket);
    } else {
      bucket.maxTokens = maxTokens;
      bucket.refillRate = refillRate;
      const elapsed = now - bucket.lastRefill;
      const tokensToAdd = elapsed * refillRate;
      bucket.tokens = Math.min(maxTokens, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        limit: maxTokens,
        resetAt: now + windowMs,
      };
    }

    const deficit = tokens - bucket.tokens;
    const timeUntilTokens = Math.ceil(deficit / refillRate);

    return {
      allowed: false,
      remaining: 0,
      limit: maxTokens,
      resetAt: now + windowMs,
      retryAfter: timeUntilTokens,
    };
  }

  /**
   * Get the current state of a rate limit bucket without consuming tokens.
   *
   * @param key - Unique identifier
   * @param config - Rate limit configuration
   * @returns Current remaining tokens and limit info, or null if no bucket exists
   */
  peek(key: string, config?: RateLimitConfig): RateLimitResult | null {
    const bucket = this.buckets.get(key);
    if (!bucket) {
      return null;
    }

    const effectiveConfig = config ?? this.defaultConfig;
    const windowMs = parseWindow(effectiveConfig.window);
    const now = Date.now();

    // Calculate current tokens without modifying state
    const elapsed = now - bucket.lastRefill;
    const currentTokens = Math.min(
      bucket.maxTokens,
      bucket.tokens + elapsed * bucket.refillRate,
    );

    return {
      allowed: currentTokens >= 1,
      remaining: Math.floor(currentTokens),
      limit: bucket.maxTokens,
      resetAt: now + windowMs,
    };
  }

  /**
   * Reset the rate limit bucket for a given key.
   *
   * @param key - Unique identifier to reset
   */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /**
   * Remove all rate limit buckets.
   */
  resetAll(): void {
    this.buckets.clear();
  }

  /**
   * Clean up stale buckets that have been fully refilled.
   * Called periodically to prevent memory leaks from agents that
   * made one request and never returned.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      const elapsed = now - bucket.lastRefill;
      const currentTokens = bucket.tokens + elapsed * bucket.refillRate;
      // If the bucket is fully refilled and has been idle for > 2x the window,
      // remove it to free memory
      if (currentTokens >= bucket.maxTokens) {
        const windowMs = bucket.maxTokens / bucket.refillRate;
        if (elapsed > windowMs * 2) {
          this.buckets.delete(key);
        }
      }
    }
  }

  /**
   * Stop the periodic cleanup interval.
   * Call this when shutting down to prevent dangling timers.
   */
  destroy(): void {
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.buckets.clear();
  }

  /**
   * Get the number of active rate limit buckets (for monitoring).
   */
  get size(): number {
    return this.buckets.size;
  }
}
