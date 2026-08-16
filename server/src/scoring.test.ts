// Pure unit tests for the maturity scoring engine — no database required.
// Run: `npm run test:unit` (or with the DB suite via `npm test`).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  controlScore,
  assessedOnlyScore,
  controlCoverage,
  ratingToGrade,
  DIMENSIONS,
  DIM_WEIGHT,
  RATING_PCT,
} from "./scoring";

test("controlScore: null when nothing is rated", () => {
  // A control nobody has looked at is *unassessed*, not zero. Callers report it
  // as its own state; collapsing it to 0 would be as wrong as omitting it.
  assert.equal(controlScore({}), null);
});

test("controlScore: all fully-compliant is 100, all non-compliant is 0", () => {
  assert.equal(controlScore({ pol: "fc", proc: "fc", impl: "fc", meas: "fc", mang: "fc" }), 100);
  assert.equal(controlScore({ pol: "nc", proc: "nc", impl: "nc", meas: "nc", mang: "nc" }), 0);
});

test("controlScore: an unrated dimension counts as NC and does not shrink the denominator", () => {
  // This is the defect these tests previously locked in: they asserted 50 and 75
  // here, because the denominator was the rated weight alone. Under that rule a
  // control rated only on Implemented scored the same as one rated across all
  // five, so the number rose as assessment shrank. DESIGN.md settles it the
  // other way — insufficient evidence is a finding, not a pass.
  assert.equal(controlScore({ impl: "pc" }), 20); // 0.4 * 50 / 1.0
  assert.equal(controlScore({ meas: "mc" }), 8); // 0.1 * 75 / 1.0 = 7.5 -> 8
});

test("controlScore: partial coverage never equals full coverage", () => {
  // The regression that matters. One `fc` dimension must not read like five.
  const partial = controlScore({ impl: "fc" });
  const full = controlScore({ pol: "fc", proc: "fc", impl: "fc", meas: "fc", mang: "fc" });
  assert.equal(partial, 40); // 0.4 * 100 / 1.0
  assert.equal(full, 100);
  assert.ok(partial! < full!, "a partially assessed control must score below a fully assessed one");
});

test("controlScore: assessing less can never raise the score", () => {
  // Monotonicity: dropping a rating must not increase the number. Under the old
  // rule, removing a weak dimension raised it.
  const both = controlScore({ impl: "fc", pol: "nc" })!;
  const implOnly = controlScore({ impl: "fc" })!;
  assert.equal(both, 40); // (0.4*100 + 0.15*0) / 1.0
  assert.equal(implOnly, 40); // dropping an NC changes nothing — it contributed 0 either way
  assert.ok(implOnly <= both, "removing a rating must not raise the score");

  const withPol = controlScore({ impl: "nc", pol: "fc" })!;
  const polOnly = controlScore({ pol: "fc" })!;
  assert.equal(withPol, 15); // (0.15*100 + 0.4*0) / 1.0
  assert.ok(polOnly <= withPol);
});

test("controlScore: weights still bias toward Implemented (PRISMA lineage)", () => {
  // impl carries 0.4 and pol 0.15, so the same rating on impl outweighs pol.
  assert.ok(controlScore({ impl: "fc" })! > controlScore({ pol: "fc" })!);
});

test("controlScore: matches the manual weighted mean over the full dimension set", () => {
  const ratings = { pol: "mc", proc: "pc", impl: "fc", meas: "sc", mang: "mc" } as const;
  let num = 0;
  for (const d of DIMENSIONS) num += DIM_WEIGHT[d] * RATING_PCT[ratings[d]];
  const den = DIMENSIONS.reduce((a, d) => a + DIM_WEIGHT[d], 0);
  assert.equal(controlScore(ratings), Math.round(num / den));
});

test("assessedOnlyScore: reports posture over what was rated, for display beside coverage", () => {
  // The old controlScore semantics, kept deliberately and named honestly.
  assert.equal(assessedOnlyScore({ impl: "pc" }), 50);
  assert.equal(assessedOnlyScore({ meas: "mc" }), 75);
  assert.equal(assessedOnlyScore({ impl: "fc", pol: "nc" }), 73);
  assert.equal(assessedOnlyScore({}), null);
});

test("controlCoverage: reports rated dimensions and their weight share", () => {
  assert.deepEqual(controlCoverage({}), { rated: 0, total: 5, weight: 0 });
  const one = controlCoverage({ impl: "fc" });
  assert.equal(one.rated, 1);
  assert.equal(one.total, 5);
  assert.ok(Math.abs(one.weight - 0.4) < 1e-9);
  const all = controlCoverage({ pol: "fc", proc: "fc", impl: "fc", meas: "fc", mang: "fc" });
  assert.equal(all.rated, 5);
  assert.ok(Math.abs(all.weight - 1) < 1e-9);
});

test("ratingToGrade: maps ratings to glyph grades 1..5 and passes null through", () => {
  assert.equal(ratingToGrade("nc"), 1);
  assert.equal(ratingToGrade("fc"), 5);
  assert.equal(ratingToGrade(null), null);
  assert.equal(ratingToGrade(undefined), null);
});
