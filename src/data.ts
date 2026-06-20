// autocomply — small static UI constants for the control matrix.
// The live matrix (controls, scores, crosswalk, evidence, owners) is served from
// the API; only the maturity-column metadata lives here.

export const MATURITY_COLS = [
  { key: "pol", short: "Pol", label: "Policy" },
  { key: "proc", short: "Proc", label: "Process" },
  { key: "impl", short: "Impl", label: "Implemented" },
  { key: "meas", short: "Meas", label: "Measured" },
  { key: "mang", short: "Mang", label: "Managed" },
] as const;

// Deterministic avatar color from an owner's name (replaces the old hardcoded palette
// now that owners come from real control_assignments).
export function ownerColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `oklch(0.55 0.12 ${h})`;
}
