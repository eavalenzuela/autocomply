// Maturity scoring helpers. Simplified "current posture" scoring for P0/P1 —
// the full per-domain-gate / statement-level r2 scoring is Phase 4.
export type Dimension = "pol" | "proc" | "impl" | "meas" | "mang";
export type Rating = "nc" | "sc" | "pc" | "mc" | "fc";

export const DIMENSIONS: Dimension[] = ["pol", "proc", "impl", "meas", "mang"];

// PRISMA maturity-level weights (NIST IR 7358 lineage; Implemented heaviest).
export const DIM_WEIGHT: Record<Dimension, number> = {
  pol: 0.15,
  proc: 0.2,
  impl: 0.4,
  meas: 0.1,
  mang: 0.15,
};

export const RATING_PCT: Record<Rating, number> = { nc: 0, sc: 25, pc: 50, mc: 75, fc: 100 };

// Glyph fill grade 1..5 (0 = N/A, null = unrated). fc=5 (full) … nc=1.
export const RATING_GRADE: Record<Rating, number> = { nc: 1, sc: 2, pc: 3, mc: 4, fc: 5 };

/**
 * Fraction of a control's weight that has actually been rated (0..1), and the
 * raw dimension counts behind it. Callers render this so a coverage gap stays
 * visibly distinct from a genuine NC, per DESIGN.md's indeterminate-as-NC rule.
 */
export function controlCoverage(ratings: Partial<Record<Dimension, Rating>>): {
  rated: number;
  total: number;
  weight: number;
} {
  let weight = 0;
  let rated = 0;
  for (const d of DIMENSIONS) {
    if (!ratings[d]) continue;
    rated++;
    weight += DIM_WEIGHT[d];
  }
  return { rated, total: DIMENSIONS.length, weight };
}

/**
 * Weighted score over ALL five dimensions — an unrated dimension contributes 0,
 * it does not shrink the denominator.
 *
 * This previously divided only by the rated weight, so a control rated `fc` on
 * Implemented alone scored 100: identical to one rated `fc` across all five
 * dimensions. The number rose as assessment shrank. DESIGN.md settles this the
 * other way ("insufficient evidence is a finding, not a pass" — coverage
 * handling = indeterminate-as-NC), which is what this implements.
 *
 * Still returns null when nothing at all is rated: a control nobody has looked
 * at is *unassessed*, which callers must report as its own state rather than
 * as a hard zero.
 */
export function controlScore(ratings: Partial<Record<Dimension, Rating>>): number | null {
  const { weight } = controlCoverage(ratings);
  if (weight === 0) return null;
  let num = 0;
  for (const d of DIMENSIONS) {
    const r = ratings[d];
    if (!r) continue; // unrated => contributes 0 to the numerator
    num += DIM_WEIGHT[d] * RATING_PCT[r];
  }
  // Denominator is the full dimension weight (1.0), not just the rated part.
  const den = DIMENSIONS.reduce((a, d) => a + DIM_WEIGHT[d], 0);
  return Math.round(num / den);
}

/**
 * Score over only the dimensions that were rated — what `controlScore` used to
 * return. Kept so the UI can show "of what was assessed, this is the posture"
 * beside the coverage-adjusted number, never instead of it.
 */
export function assessedOnlyScore(ratings: Partial<Record<Dimension, Rating>>): number | null {
  let num = 0;
  let den = 0;
  for (const d of DIMENSIONS) {
    const r = ratings[d];
    if (!r) continue;
    num += DIM_WEIGHT[d] * RATING_PCT[r];
    den += DIM_WEIGHT[d];
  }
  if (den === 0) return null;
  return Math.round(num / den);
}

/**
 * Coverage below this fraction of a control's weight makes the score
 * indeterminate: reported, but flagged rather than presented as a posture.
 * DESIGN.md calls for this to be configurable.
 */
export const COVERAGE_FLOOR = Number(process.env.COVERAGE_FLOOR ?? 0.5);

export function ratingToGrade(r: Rating | null | undefined): number | null {
  return r ? RATING_GRADE[r] : null;
}
