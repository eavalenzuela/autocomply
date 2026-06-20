// autocomply — small static UI constants for the control matrix.
// The live matrix (controls, scores, crosswalk, evidence) is served from the
// API; only the maturity-column metadata and the owner avatar palette live here.
import type { Owner } from "./types";

export const MATURITY_COLS = [
  { key: "pol", short: "Pol", label: "Policy" },
  { key: "proc", short: "Proc", label: "Process" },
  { key: "impl", short: "Impl", label: "Implemented" },
  { key: "meas", short: "Meas", label: "Measured" },
  { key: "mang", short: "Mang", label: "Managed" },
] as const;

// Avatar colors for control owners (keyed by initials). Owner assignment is not
// yet surfaced on the matrix payload; kept for the Owner column rendering.
export const OWNERS: Record<string, Owner> = {
  RB: { name: "Ren Bao", color: "#5B5FCA" },
  MK: { name: "Maya K.", color: "#C76A3E" },
  AS: { name: "Avi Solov", color: "#3E8C7C" },
  JT: { name: "Jules Tam", color: "#8A5BCA" },
};
