// autocomply mock data — HITRUST r2 maturity model.
// Swappable later for the source-agnostic data loader (data/*.yaml).
import type {
  Cell,
  Control,
  Domain,
  DrawerDetail,
  Header,
  Kpi,
  MaturityGrade,
  Owner,
} from "./types";

export const MATURITY_LABELS = ["N/A", "Policy", "Process", "Implemented", "Measured", "Managed"];
export const MATURITY_SHORT = ["NA", "Pol", "Proc", "Impl", "Meas", "Mang"];

export const MATURITY_COLS = [
  { key: "pol", short: "Pol", label: "Policy" },
  { key: "proc", short: "Proc", label: "Process" },
  { key: "impl", short: "Impl", label: "Implemented" },
  { key: "meas", short: "Meas", label: "Measured" },
  { key: "mang", short: "Mang", label: "Managed" },
] as const;

type Grades = { pol: MaturityGrade; proc: MaturityGrade; impl: MaturityGrade; meas: MaturityGrade; mang: MaturityGrade };
type Markers = Partial<Record<Cell["dim"], Cell["marker"]>>;

function cells({ pol, proc, impl, meas, mang }: Grades, markers: Markers = {}): Cell[] {
  return [
    { dim: "pol", grade: pol, marker: markers.pol || null },
    { dim: "proc", grade: proc, marker: markers.proc || null },
    { dim: "impl", grade: impl, marker: markers.impl || null },
    { dim: "meas", grade: meas, marker: markers.meas || null },
    { dim: "mang", grade: mang, marker: markers.mang || null },
  ];
}

export const DOMAINS: Domain[] = [
  {
    id: "D11",
    name: "Access Control",
    score: 68,
    gate: 2.8,
    gateFail: true,
    owner: "RB",
    open: true,
    controls: [
      {
        id: "01.a",
        name: "Access Control Policy",
        score: 72,
        evidence: { age: "4d", tag: null, label: null },
        crosswalk: ["CC6.1", "A.5.15"],
        docs: 3,
        cells: cells({ pol: 1, proc: 1, impl: 3, meas: 2, mang: 1 }, { impl: "aws" }),
        owner: "RB",
        lastChange: "2026-05-18",
        status: "pc",
      },
      {
        id: "01.b",
        name: "User Registration",
        score: 55,
        evidence: { age: "6d", tag: "drift", label: "drift" },
        crosswalk: ["CC6.2"],
        docs: 2,
        cells: cells({ pol: 1, proc: 1, impl: 3, meas: 1, mang: 1 }, { impl: "drift" }),
        owner: "MK",
        lastChange: "2026-05-14",
        status: "sc",
      },
      {
        id: "01.q",
        name: "User Identification & Auth",
        score: 78,
        evidence: { age: "2d", tag: null, label: null },
        crosswalk: ["CC6.1", "A.8.5"],
        docs: 5,
        cells: cells({ pol: 1, proc: 1, impl: 3, meas: 2, mang: 2 }, { impl: "aws" }),
        owner: "RB",
        lastChange: "2026-05-20",
        status: "mc",
      },
      {
        id: "01.r",
        name: "Password Management System",
        score: 61,
        evidence: { age: "1d", tag: "cov", label: "cov 80/90" },
        crosswalk: ["CC6.1", "A.5.17"],
        docs: 4,
        cells: cells({ pol: 1, proc: 1, impl: 3, meas: 1, mang: 1 }, { impl: "gap" }),
        owner: "MK",
        lastChange: "2026-05-21",
        status: "nc",
        flag: "coverage-as-nc",
      },
    ],
  },
  {
    id: "D12",
    name: "Audit Logging & Monitoring",
    score: 74,
    gate: 3.1,
    gateFail: false,
    owner: "AS",
    open: true,
    controls: [
      {
        id: "09.aa",
        name: "Audit Logging",
        score: 83,
        evidence: { age: "1d", tag: null, label: null },
        crosswalk: ["CC7.2", "A.8.15"],
        docs: 6,
        cells: cells({ pol: 1, proc: 1, impl: 3, meas: 2, mang: 2 }),
        owner: "AS",
        lastChange: "2026-05-21",
        status: "fc",
      },
      {
        id: "09.ac",
        name: "Protection of Log Information",
        score: 48,
        evidence: { age: null, tag: "review", label: "needs review" },
        crosswalk: ["CC7.2", "A.8.15"],
        docs: 2,
        cells: cells({ pol: 2, proc: 2, impl: 3, meas: 1, mang: 1 }, { impl: "aws" }),
        owner: "AS",
        lastChange: "2026-05-10",
        status: "sc",
      },
      {
        id: "09.af",
        name: "Clock Synchronization",
        score: 100,
        evidence: { age: "1d", tag: "auto", label: "auto" },
        crosswalk: ["CC7.2", "A.8.17"],
        docs: 1,
        cells: cells({ pol: 0, proc: 0, impl: 3, meas: 0, mang: 0 }, { impl: "aws" }),
        owner: "AS",
        lastChange: "2026-05-21",
        status: "fc",
        implOnly: true,
      },
    ],
  },
  {
    id: "D06",
    name: "Configuration Management",
    score: 39,
    gate: 2.1,
    gateFail: true,
    owner: "MK",
    open: false,
    controls: Array.from({ length: 12 }, (_, i): Control => ({
      id: `06.${String.fromCharCode(97 + i)}`,
      name: `Configuration control ${i + 1}`,
      score: 30 + Math.floor(Math.random() * 50),
      evidence: { age: `${i + 1}d`, tag: null, label: null },
      crosswalk: ["CC8.1"],
      docs: 1,
      cells: cells({ pol: 1, proc: 1, impl: 2, meas: 1, mang: 0 }),
      owner: "MK",
      lastChange: "2026-05-15",
      status: "sc",
    })),
  },
  {
    id: "D18",
    name: "Physical & Environmental",
    score: 88,
    gate: 3.6,
    gateFail: false,
    owner: "JT",
    open: false,
    controls: Array.from({ length: 9 }, (_, i): Control => ({
      id: `08.${String.fromCharCode(97 + i)}`,
      name: `Physical control ${i + 1}`,
      score: 70 + Math.floor(Math.random() * 28),
      evidence: { age: `${i + 2}d`, tag: null, label: null },
      crosswalk: ["A.7.1"],
      docs: 2,
      cells: cells({ pol: 2, proc: 2, impl: 3, meas: 2, mang: 2 }),
      owner: "JT",
      lastChange: "2026-05-12",
      status: "mc",
    })),
  },
  { id: "D03", name: "Risk Management", score: 64, gate: 2.7, gateFail: true, owner: "RB", open: false, controlCount: 8, controls: [] },
  { id: "D07", name: "Vulnerability Management", score: 71, gate: 3.0, gateFail: false, owner: "AS", open: false, controlCount: 11, controls: [] },
  { id: "D09", name: "Transmission Protection", score: 82, gate: 3.4, gateFail: false, owner: "AS", open: false, controlCount: 7, controls: [] },
  { id: "D14", name: "Third Party Assurance", score: 58, gate: 2.5, gateFail: true, owner: "JT", open: false, controlCount: 6, controls: [] },
  { id: "D19", name: "Mobile Device Security", score: 76, gate: 3.2, gateFail: false, owner: "MK", open: false, controlCount: 5, controls: [] },
];

export const OWNERS: Record<string, Owner> = {
  RB: { name: "Ren Bao", color: "#5B5FCA" },
  MK: { name: "Maya K.", color: "#C76A3E" },
  AS: { name: "Avi Solov", color: "#3E8C7C" },
  JT: { name: "Jules Tam", color: "#8A5BCA" },
};

export const KPI: Kpi = {
  overall: 71,
  prevOverall: 67,
  gatesFailing: 4,
  controlsTotal: 156,
  controlsAtRisk: 23,
  stale: 11,
  unmapped: 5,
  evidenceFreshness: 4.2,
};

export const HEADER: Header = {
  org: "autocomply",
  framework: "HITRUST r2",
  period: { start: "2026-02-20", end: "2026-05-21", days: 90 },
};

export const DRAWER_DETAIL: Record<string, DrawerDetail> = {
  "01.r": {
    title: "Password Management System",
    id: "01.r",
    domain: "D11 · Access Control",
    description:
      "Establish controls to ensure passwords are managed in a way that maintains the confidentiality and integrity of authentication data.",
    crosswalk: ["CC6.1", "A.5.17", "NIST 800-53 IA-5"],
    rationale:
      "Scored NC due to coverage gap (80/90 days). Live config is FC but missing 10 days of successful collection within the period.",
    evidence: [
      { name: "okta-policy-export.json", source: "Okta · auto", status: "fresh", age: "1d", grade: "ok" },
      { name: "password_policy_2026.pdf", source: "Confluence", status: "stale 14d", age: "14d", grade: "warn" },
      { name: "evidence-collector logs", source: "AWS Config", status: "80/90 days", age: "1d", grade: "bad" },
      { name: "DLP scan results", source: "Prisma", status: "fresh", age: "2d", grade: "ok" },
    ],
    timeline: [
      { date: "May 21", body: "Coverage check flagged 80/90 → control re-scored NC", meta: "auto · evidence-collector", grade: "bad" },
      { date: "May 18", body: "Password policy updated in Confluence", meta: "Maya K.", grade: "ok" },
      { date: "May 11", body: "Okta config change detected", meta: "auto · drift-monitor", grade: "warn" },
      { date: "Apr 30", body: "Last successful attestation", meta: "Ren Bao", grade: "ok" },
    ],
    aws: { service: "AWS IAM + Okta", mapping: "iam:password-policy → 01.r.Impl", confidence: 0.92 },
  },
};
