// Pure unit tests for the auth rate limiter — no database, no timers (the clock
// is injected). Run: `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "./ratelimit";

const T0 = 1_000_000; // arbitrary fixed epoch

test("allows up to the limit, then blocks within the window", () => {
  const rl = new RateLimiter(3, 60_000);
  assert.equal(rl.allow("ip1", T0), true);
  assert.equal(rl.allow("ip1", T0 + 1), true);
  assert.equal(rl.allow("ip1", T0 + 2), true);
  assert.equal(rl.allow("ip1", T0 + 3), false); // 4th attempt inside the window
});

test("keys are independent", () => {
  const rl = new RateLimiter(1, 60_000);
  assert.equal(rl.allow("ip1", T0), true);
  assert.equal(rl.allow("ip1", T0), false);
  assert.equal(rl.allow("ip2", T0), true); // a different client is unaffected
});

test("the window resets after it elapses", () => {
  const rl = new RateLimiter(2, 60_000);
  rl.allow("ip1", T0);
  rl.allow("ip1", T0);
  assert.equal(rl.allow("ip1", T0 + 30_000), false); // still inside
  assert.equal(rl.allow("ip1", T0 + 60_001), true); // window over — fresh bucket
});

test("prune drops only expired buckets", () => {
  const rl = new RateLimiter(5, 60_000);
  rl.allow("old", T0);
  rl.allow("fresh", T0 + 50_000);
  assert.equal(rl.size, 2);
  const removed = rl.prune(T0 + 61_000); // "old" reset at T0+60_000, "fresh" at T0+110_000
  assert.equal(removed, 1);
  assert.equal(rl.size, 1);
  assert.equal(rl.allow("fresh", T0 + 61_000), true); // survivor keeps counting
});

test("exceeding maxKeys triggers a prune instead of unbounded growth", () => {
  const rl = new RateLimiter(5, 60_000, 10);
  for (let i = 0; i < 11; i++) rl.allow(`ip${i}`, T0 + i);
  assert.ok(rl.size <= 11);
  // All 11 windows have elapsed; the next call must sweep them out.
  rl.allow("late", T0 + 120_000);
  assert.equal(rl.size, 1);
});
