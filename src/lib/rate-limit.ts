/**
 * In-memory fixed-window rate limiter for the public API. Keyed by API key id.
 *
 * NOTE: process-local — counters reset on restart and are per-instance. That is
 * acceptable for the single-VM deploy (Phase 12); a distributed limiter (Redis /
 * Postgres) can replace this behind the same interface if we scale out.
 */

export interface RateDecision {
  ok: boolean
  remaining: number
  /** Unix ms when the current window resets. */
  resetAt: number
}

interface Bucket {
  count: number
  windowStart: number
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>()

  constructor(
    private limit: number,
    private windowMs: number,
    private now: () => number = () => Date.now(),
  ) {}

  check(key: string): RateDecision {
    const t = this.now()
    let b = this.buckets.get(key)
    if (!b || t - b.windowStart >= this.windowMs) {
      b = { count: 0, windowStart: t }
      this.buckets.set(key, b)
    }
    const resetAt = b.windowStart + this.windowMs
    if (b.count >= this.limit) {
      return { ok: false, remaining: 0, resetAt }
    }
    b.count++
    return { ok: true, remaining: this.limit - b.count, resetAt }
  }

  /** Drop stale buckets (optional housekeeping). */
  sweep(): void {
    const t = this.now()
    for (const [k, b] of this.buckets) {
      if (t - b.windowStart >= this.windowMs) this.buckets.delete(k)
    }
  }
}
