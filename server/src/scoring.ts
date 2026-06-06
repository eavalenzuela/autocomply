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
 * Normalized weighted score over the dimensions that actually have a rating.
 * Returns null when nothing is rated (unrated control).
 */
export function controlScore(ratings: Partial<Record<Dimension, Rating>>): number | null {
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

export function ratingToGrade(r: Rating | null | undefined): number | null {
  return r ? RATING_GRADE[r] : null;
}
