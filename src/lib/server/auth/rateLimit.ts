/**
 * SAM — In-memory rate limiter (token bucket).
 *
 * Simple, no external dependencies. Shared across all route handlers
 * via the globalThis singleton pattern.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms

  constructor(maxTokens = 10, refillTimeMs = 1000) {
    this.maxTokens = maxTokens;
    this.refillRate = maxTokens / refillTimeMs;
  }

  /** Returns true if the request is allowed (consumes 1 token). */
  consume(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    // Refill
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsed * this.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  /** Clean up stale buckets periodically. */
  prune(maxAgeMs = 600_000) {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > maxAgeMs) {
        this.buckets.delete(key);
      }
    }
  }
}

/* ========================================================================== */
/* Singleton instances                                                         */
/* ========================================================================== */

const globalForSam = globalThis as unknown as {
  __samAuthLimiter?: RateLimiter;
  __samRegisterLimiter?: RateLimiter;
};

/** Auth attempts: 5 per second per IP. Fail closed. */
export function getAuthLimiter(): RateLimiter {
  if (!globalForSam.__samAuthLimiter) {
    globalForSam.__samAuthLimiter = new RateLimiter(5, 1000);
  }
  return globalForSam.__samAuthLimiter;
}

/** Registration: 3 per minute per IP (one-time setup, no need for speed). */
export function getRegisterLimiter(): RateLimiter {
  if (!globalForSam.__samRegisterLimiter) {
    globalForSam.__samRegisterLimiter = new RateLimiter(3, 60_000);
  }
  return globalForSam.__samRegisterLimiter;
}
