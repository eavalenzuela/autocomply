// Data contract for the HITRUST r2 control matrix.
// Mirrors the design handoff; maps onto the autocomply entity model
// (MaturityCell, Control, AssessmentDomain, Attestation, Mapping).

/** 0 = N/A, 1 Policy, 2 Process, 3 Implemented, 4 Measured, 5 Managed */
export type MaturityGrade = 0 | 1 | 2 | 3 | 4 | 5;

/** aws = AWS-fed/suggested/unconfirmed, drift = doc drifted, gap = coverage gap → NC */
export type Marker = "aws" | "drift" | "gap" | null;

/** Derived display chip for a control's overall rating. */
export type Status = "fc" | "mc" | "pc" | "sc" | "nc";

export type GlyphStyle = "pie" | "bars" | "blocks";

export interface Cell {
  dim: "pol" | "proc" | "impl" | "meas" | "mang";
  /** null = unrated (no attestation yet) */
  grade: MaturityGrade | null;
  marker: Marker;
}

export interface Evidence {
  age: string | null;
  tag: "drift" | "cov" | "review" | "auto" | null;
  label: string | null;
}

export interface Control {
  id: string;
  name: string;
  score: number | null;
  evidence: Evidence;
  crosswalk: string[];
  docs: number;
  cells: Cell[];
  owner: string | null;
  lastChange?: string;
  status?: Status;
  /** marks the coverage-as-NC scoring case */
  flag?: string;
  /** e1/i1 control — only the Implemented dimension is assessed */
  implOnly?: boolean;
}

export interface Domain {
  id: string;
  name: string;
  score: number | null;
  gate: number | null;
  gateFail: boolean;
  owner: string | null;
  open: boolean;
  controls: Control[];
  /** for collapsed/not-yet-loaded domains */
  controlCount?: number;
  hidden?: boolean;
}

export interface Owner {
  name: string;
  color: string;
}

export interface Kpi {
  overall: number;
  prevOverall: number;
  gatesFailing: number;
  controlsTotal: number;
  controlsAtRisk: number;
  stale: number;
  unmapped: number;
  evidenceFreshness: number;
}

export interface Header {
  org: string;
  framework: string;
  period: { start: string; end: string; days: number };
}

export interface EvidenceDetail {
  name: string;
  source: string;
  status: string;
  age: string;
  grade: "ok" | "warn" | "bad";
}

export interface TimelineEntry {
  date: string;
  body: string;
  meta: string;
  grade: "ok" | "warn" | "bad";
}

export interface DrawerDetail {
  title: string;
  id: string;
  domain: string;
  description: string;
  crosswalk: string[];
  rationale: string;
  evidence: EvidenceDetail[];
  timeline: TimelineEntry[];
  aws: { service: string; mapping: string; confidence: number };
}

export interface Tweaks {
  theme: "light" | "dark";
  density: "comfortable" | "dense";
  glyphStyle: GlyphStyle;
  showOwners: boolean;
  accent: "indigo" | "rust" | "pine" | "graphite";
}
