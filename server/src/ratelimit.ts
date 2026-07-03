// Minimal in-memory rate limiter (per key) — dependency-free brute-force throttle
// for the auth endpoints. Single-process; a multi-node deploy would back this with
// a shared store.
//
// Unlike the previous inline Map, expired buckets are pruned so the map can't grow
// unboundedly with one entry per client IP ever seen: a sweep runs opportunistically
// every PRUNE_EVERY calls and immediately whenever the map exceeds `maxKeys`.
// Pure in-memory + injectable clock, so it's unit-testable without timers.

const PRUNE_EVERY = 1024;

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private calls = 0;

  constructor(
    private limit: number,
    private windowMs: number,
    private maxKeys = 10_000,
  ) {}

  /** True if the caller identified by `key` is within the limit (and counts the hit). */
  allow(key: string, now = Date.now()): boolean {
    if (++this.calls >= PRUNE_EVERY || this.buckets.size > this.maxKeys) {
      this.calls = 0;
      this.prune(now);
    }
    const b = this.buckets.get(key);
    if (!b || now > b.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (b.count >= this.limit) return false;
    b.count++;
    return true;
  }

  /** Drop every bucket whose window has already ended. Returns how many were removed. */
  prune(now = Date.now()): number {
    let removed = 0;
    for (const [key, b] of this.buckets) {
      if (now > b.resetAt) {
        this.buckets.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Live bucket count (for tests / introspection). */
  get size(): number {
    return this.buckets.size;
  }
}
