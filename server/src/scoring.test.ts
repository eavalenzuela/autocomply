// Pure unit tests for the maturity scoring engine — no database required.
// Run: `npm run test:unit` (or with the DB suite via `npm test`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { controlScore, ratingToGrade, DIMENSIONS, DIM_WEIGHT, RATING_PCT } from "./scoring";

test("controlScore: null when nothing is rated", () => {
  assert.equal(controlScore({}), null);
});

test("controlScore: all fully-compliant is 100, all non-compliant is 0", () => {
  assert.equal(controlScore({ pol: "fc", proc: "fc", impl: "fc", meas: "fc", mang: "fc" }), 100);
  assert.equal(controlScore({ pol: "nc", proc: "nc", impl: "nc", meas: "nc", mang: "nc" }), 0);
});

test("controlScore: a single rated dimension normalizes to that rating's percentage", () => {
  // Normalized weighting: with only one dimension rated, its weight cancels out.
  assert.equal(controlScore({ impl: "pc" }), 50);
  assert.equal(controlScore({ meas: "mc" }), 75);
});

test("controlScore: weights bias toward Implemented (PRISMA lineage)", () => {
  // impl fc + pol nc: (0.4*100 + 0.15*0) / 0.55 ≈ 73 — impl dominates.
  assert.equal(controlScore({ impl: "fc", pol: "nc" }), 73);
  // The reverse split leans the other way: (0.15*100 + 0.4*0) / 0.55 ≈ 27.
  assert.equal(controlScore({ impl: "nc", pol: "fc" }), 27);
});

test("controlScore: matches the manual weighted mean over all dimensions", () => {
  const ratings = { pol: "mc", proc: "pc", impl: "fc", meas: "sc", mang: "mc" } as const;
  let num = 0;
  let den = 0;
  for (const d of DIMENSIONS) {
    num += DIM_WEIGHT[d] * RATING_PCT[ratings[d]];
    den += DIM_WEIGHT[d];
  }
  assert.equal(controlScore(ratings), Math.round(num / den));
});

test("ratingToGrade: maps ratings to glyph grades 1..5 and passes null through", () => {
  assert.equal(ratingToGrade("nc"), 1);
  assert.equal(ratingToGrade("fc"), 5);
  assert.equal(ratingToGrade(null), null);
  assert.equal(ratingToGrade(undefined), null);
});
