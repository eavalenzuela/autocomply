// API client for the autocomply backend (proxied at /api by Vite in dev).
import type { Domain } from "./types";

export interface AssessmentPeriodInfo {
  name: string;
  framework: string;
  frameworkLabel: string;
  tier: string | null;
  start: string;
  end: string;
  days: number;
  status: string;
}
export interface MatrixSummary {
  controlsTotal: number;
  inScopeTotal: number;
  tier: string | null;
  categories: number;
  frameworks: string[];
  mappingLinks: number;
  period: AssessmentPeriodInfo | null;
}
export interface MatrixResponse {
  summary: MatrixSummary;
  domains: Domain[];
}

// Step-up re-auth: the app registers a prompt (a password modal). When a request
// is rejected with {code:"step_up_required"}, we prompt, re-verify, and retry once.
let stepUpPrompt: (() => Promise<string | null>) | null = null;
export function setStepUpPrompt(fn: (() => Promise<string | null>) | null) {
  stepUpPrompt = fn;
}
async function doStepUp(password: string): Promise<void> {
  const r = await fetch("/api/step-up", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || "re-authentication failed");
  }
}

// Core fetch wrapper. On a step-up challenge it prompts once, re-auths, retries.
async function request(path: string, init: RequestInit): Promise<Response> {
  let r = await fetch(path, { credentials: "include", ...init });
  if (r.status === 403) {
    const j = await r
      .clone()
      .json()
      .catch(() => ({}));
    if (j.code === "step_up_required" && stepUpPrompt) {
      const password = await stepUpPrompt();
      if (password == null) throw new Error("Re-authentication cancelled");
      await doStepUp(password);
      r = await fetch(path, { credentials: "include", ...init });
    }
  }
  return r;
}

// Same-origin (Vite proxies /api), so the session cookie rides along; include
// credentials explicitly to be safe.
async function get(path: string) {
  const r = await request(path, {});
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}
async function post(path: string, body?: unknown) {
  const r = await request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || `${path}: HTTP ${r.status}`);
  }
  return r.json().catch(() => ({}));
}

export type Role = "admin" | "compliance_manager" | "control_owner" | "auditor" | "viewer";
export interface CurrentUser { id: number; email: string; name: string; role: Role; authProvider?: string; }

export async function login(email: string, password: string): Promise<CurrentUser> {
  return post("/api/login", { email, password });
}
export async function logout(): Promise<void> {
  await post("/api/logout");
}
export async function fetchAuthProviders(): Promise<string[]> {
  try {
    const r = await fetch("/api/auth/providers");
    if (!r.ok) return [];
    return (await r.json()).providers ?? [];
  } catch {
    return [];
  }
}

export async function fetchMe(): Promise<CurrentUser | null> {
  const r = await fetch("/api/me", { credentials: "include" });
  if (!r.ok) return null;
  const j = await r.json();
  return j.error ? null : j;
}

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  expiresAt: string | null;
  assignments: string[];
}
export async function fetchUsers(): Promise<{ users: AdminUser[] }> {
  return get("/api/users");
}
export async function setUserRole(id: number, role: Role): Promise<void> {
  await post(`/api/users/${id}/role`, { role });
}
export async function assignControl(userId: number, control: string): Promise<void> {
  await post("/api/assign", { userId, control });
}
export async function unassignControl(userId: number, control: string): Promise<void> {
  await post("/api/unassign", { userId, control });
}

export async function fetchMatrix(): Promise<MatrixResponse> {
  return get("/api/matrix");
}

export interface WorklistTask {
  control: string;
  name: string;
  type: string;
  reason: string;
  priority: number;
}
export async function fetchWorklist(): Promise<{ count: number; tasks: WorklistTask[] }> {
  return get("/api/worklist");
}

export interface ControlDetail {
  control: { id: string; name: string; domain: string };
  crosswalk: { code: string; framework: string; relationship: string; confidence: string }[];
  attestations: {
    id: number;
    dimension: string;
    rating: string;
    justification: string | null;
    marker: string | null;
    source: string;
    createdAt: string;
  }[];
  evidence: {
    id: number;
    title: string;
    sourceType: string;
    dimension: string;
    kind: string | null;
    liveUrl: string | null;
    contentHash: string | null;
    drifted: boolean;
    collectedAt: string;
  }[];
}
export async function fetchControl(code: string): Promise<ControlDetail> {
  return get(`/api/control/${encodeURIComponent(code)}`);
}

export async function attest(body: {
  control: string;
  dimension: "pol" | "proc" | "impl" | "meas" | "mang";
  rating: "nc" | "sc" | "pc" | "mc" | "fc";
  justification?: string;
}): Promise<void> {
  await post("/api/attest", body);
}

export interface EvidenceItem {
  id: number;
  controlCode: string;
  dimension: string;
  title: string;
  sourceType: string;
  liveUrl: string | null;
  kind: string | null;
  contentHash: string | null;
  drifted: boolean;
}
export async function fetchEvidence(): Promise<{ count: number; evidence: EvidenceItem[] }> {
  return get("/api/evidence");
}

export interface ExceptionRow {
  id: number;
  controlCode: string;
  dimension: string | null;
  reason: string;
  status: string;
  requestedByName: string | null;
  approvedByName: string | null;
  expiresAt: string | null;
}
export async function fetchExceptions(): Promise<{ count: number; exceptions: ExceptionRow[] }> {
  return get("/api/exceptions");
}
export async function decideException(id: number, decision: "approve" | "reject"): Promise<void> {
  await post(`/api/exception/${id}/decide`, { decision });
}
// File a risk-acceptance request against a control (pending until a different
// admin/compliance manager decides it — SoD is enforced server-side).
export async function requestException(body: { control: string; dimension?: string; reason: string; expiresAt?: string }): Promise<void> {
  await post("/api/exception", body);
}

export interface RequirementRow {
  code: string;
  title: string | null;
  kind: string;
  status: "met" | "partial" | "weak" | "unassessed" | "gap";
  score: number | null;
  mapped: number;
  mappedControls: { control: string; relationship: string; score: number | null }[];
}
export interface RequirementsResponse {
  framework: string;
  total: number;
  summary: { covered: number; gaps: number; met: number; partial: number; weak: number; unassessed: number; readiness: number | null };
  requirements: RequirementRow[];
}
export async function fetchRequirements(framework: "soc2" | "iso27001"): Promise<RequirementsResponse> {
  return get(`/api/requirements?framework=${framework}`);
}

export interface SoaEntry {
  requirementId: number;
  code: string;
  title: string | null;
  theme: string | null;
  new2022: boolean;
  applicable: boolean;
  status: "implemented" | "partial" | "planned" | "na";
  justification: string | null;
  coverage: { status: string; score: number | null; mapped: number } | null;
}
export interface SoaResponse {
  summary: { total: number; applicable: number; excluded: number; documented: number; implemented: number };
  entries: SoaEntry[];
}
export async function fetchSoa(): Promise<SoaResponse> {
  return get("/api/soa");
}
export async function setSoaEntry(reqId: number, body: { applicable?: boolean; status?: string; justification?: string }): Promise<void> {
  await post(`/api/soa/${reqId}`, body);
}

export interface ReportResponse {
  meta: { org: string; framework: string; period: { start: string; end: string; days: number }; generatedAt: string; generatedBy: string };
  readiness: { covered: number; gaps: number; met: number; partial: number; weak: number; unassessed: number; readiness: number | null };
  requirements: RequirementRow[];
  controls: {
    code: string;
    title: string;
    score: number | null;
    crosswalk: string[];
    ratings: { dim: string; rating: string | null; marker: string | null; source: string | null }[];
    evidence: { title: string; kind: string | null; sourceType: string; contentHash: string | null; drifted: boolean }[];
  }[];
  gaps: { code: string; title: string | null; kind: string }[];
  exceptions: { control: string; reason: string; status: string; expiresAt: string | null }[];
}
// `forExport` requests the downloadable artifact — a sensitive action that
// requires a fresh step-up re-auth and is audit-logged server-side.
export async function fetchReport(framework: "soc2" | "iso27001", forExport = false): Promise<ReportResponse> {
  return get(`/api/report?framework=${framework}${forExport ? "&export=1" : ""}`);
}

export interface Connector { name: string; type: string; checks: number; lastRun: string | null; status: string; findings: number; passRate: number | null; coverage: string; }
export interface CatalogExportStatus { frameworks: number; requirements: number; controls: number; satisfies: number; crosswalks: number; lastExport: string | null; }
export async function fetchIntegrations(): Promise<{ connectors: Connector[]; catalog: CatalogExportStatus }> {
  return get("/api/integrations");
}

export interface LibraryControl { code: string; title: string; category: string; objective: string | null; score: number | null; soc2: number; iso27001: number; }
export async function fetchControlsLibrary(): Promise<{ categories: { id: string; title: string }[]; controls: LibraryControl[] }> {
  return get("/api/controls");
}

export interface Period { id: number; name: string; framework: string; tier: string | null; startDate: string; endDate: string; status: string; tscCategories: string[] | null; }
export async function fetchPeriods(): Promise<{ periods: Period[] }> {
  return get("/api/periods");
}
export async function createPeriod(body: { name: string; framework: string; tier?: string; startDate: string; endDate: string; tscCategories?: string[] }): Promise<void> {
  await post("/api/periods", body);
}
export async function setPeriodStatus(id: number, status: string): Promise<void> {
  await post(`/api/periods/${id}/status`, { status });
}

export interface Notification {
  kind: string;
  text: string;
  severity: "info" | "warn" | "bad";
}
export async function fetchNotifications(): Promise<{ count: number; items: Notification[] }> {
  return get("/api/notifications");
}

// ---- audit log (admin / auditor) ----
export interface AuditEntry {
  id: number;
  ts: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: Record<string, unknown> | null;
  actor: string | null;
}
export interface AuditResponse {
  total: number;
  limit: number;
  offset: number;
  entries: AuditEntry[];
}
export async function fetchAudit(opts: { limit?: number; offset?: number; action?: string } = {}): Promise<AuditResponse> {
  const params = new URLSearchParams();
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.offset != null) params.set("offset", String(opts.offset));
  if (opts.action) params.set("action", opts.action);
  const qs = params.toString();
  return get(`/api/audit${qs ? `?${qs}` : ""}`);
}

// Local-account password change; the server revokes the user's other sessions.
export async function changePassword(currentPassword: string, newPassword: string): Promise<{ revokedSessions: number }> {
  return post("/api/me/password", { currentPassword, newPassword });
}
