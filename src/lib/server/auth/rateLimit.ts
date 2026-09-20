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

  /** Bucket count, for the health endpoint and tests. */
  size(): number {
    return this.buckets.size;
  }

  /**
   * Start the sweep that makes `prune()` actually happen.
   *
   * Until 2026-09-20 `prune()` existed and was called from precisely nowhere
   * (SAM_ui_Audit_2026-09-20 finding 12), so every distinct key this limiter
   * ever saw stayed in the Map for the lifetime of the process. On a tailnet
   * with a handful of stable addresses that is a slow leak; on the upload
   * limiter, which is keyed per credential, and on anything keyed by a
   * client-supplied header, it is an unbounded one.
   *
   * `unref` so a pending sweep can never hold the process open at shutdown.
   */
  startSweep(intervalMs = 600_000): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.prune(), intervalMs);
    this.sweepTimer.unref();
  }

  private sweepTimer: ReturnType<typeof setInterval> | null = null;
}

/* ========================================================================== */
/* Singleton instances                                                         */
/* ========================================================================== */

const globalForSam = globalThis as unknown as {
  __samAuthLimiter?: RateLimiter;
  __samRegisterLimiter?: RateLimiter;
  __samUploadLimiter?: RateLimiter;
};

/** Auth attempts: 5 per second per IP. Fail closed. */
export function getAuthLimiter(): RateLimiter {
  if (!globalForSam.__samAuthLimiter) {
    globalForSam.__samAuthLimiter = new RateLimiter(5, 1000);
    globalForSam.__samAuthLimiter.startSweep();
  }
  return globalForSam.__samAuthLimiter;
}

/** Registration: 3 per minute per IP (one-time setup, no need for speed). */
export function getRegisterLimiter(): RateLimiter {
  if (!globalForSam.__samRegisterLimiter) {
    globalForSam.__samRegisterLimiter = new RateLimiter(3, 60_000);
    globalForSam.__samRegisterLimiter.startSweep();
  }
  return globalForSam.__samRegisterLimiter;
}

/**
 * Uploads: 10 per minute per credential. Keyed on the credential rather than
 * the IP because every device here reaches the box over the tailnet, where IPs
 * are few and shared. This is a disk guard, not a security control — the
 * step-up check is the security control.
 */
export function getUploadLimiter(): RateLimiter {
  if (!globalForSam.__samUploadLimiter) {
    globalForSam.__samUploadLimiter = new RateLimiter(10, 60_000);
    globalForSam.__samUploadLimiter.startSweep();
  }
  return globalForSam.__samUploadLimiter;
}
