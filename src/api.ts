// API client for the autocomply backend (proxied at /api by Vite in dev).
import type { Domain } from "./types";

export interface AssessmentPeriodInfo {
  id?: number;
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
  /** Every open window. Overlapping programmes across frameworks are normal. */
  activePeriods?: AssessmentPeriodInfo[];
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

// Nothing handled a 401. A session expires after 12 hours, so the ordinary case
// — leave a tab open overnight, come back, click something — left every request
// failing with "HTTP 401" and no route back to the sign-in screen. The app now
// hears about it once and returns the user to login.
let onSessionLost: (() => void) | null = null;
export function setSessionLostHandler(fn: (() => void) | null) {
  onSessionLost = fn;
}
let sessionLostFired = false;
function noteSessionLost() {
  if (sessionLostFired) return; // one banner, not one per in-flight request
  sessionLostFired = true;
  onSessionLost?.();
}
/** Called after a successful login so a later expiry is reported again. */
export function resetSessionLost() {
  sessionLostFired = false;
}

/** Turn a failed response into something a person can act on. */
async function describe(path: string, r: Response): Promise<string> {
  const j = await r.json().catch(() => ({} as any));
  if (j?.error) return j.error;
  switch (r.status) {
    case 403:
      return "You do not have permission to do that.";
    case 404:
      return "That is no longer there — it may have been removed.";
    case 409:
      return "Someone else changed this first. Reload and try again.";
    case 429:
      return "Too many attempts. Wait a few minutes and try again.";
    case 500:
      return "Something went wrong on the server. It has been logged.";
    default:
      return `That request failed (${r.status}).`;
  }
}

async function get(path: string) {
  const r = await request(path, {});
  if (r.status === 401) {
    noteSessionLost();
    throw new Error("Your session has expired. Please sign in again.");
  }
  if (!r.ok) throw new Error(await describe(path, r));
  return r.json();
}
async function post(path: string, body?: unknown) {
  const r = await request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  // /api/login answering 401 is a wrong password, not an expired session.
  if (r.status === 401 && path !== "/api/login") {
    noteSessionLost();
    throw new Error("Your session has expired. Please sign in again.");
  }
  if (!r.ok) throw new Error(await describe(path, r));
  return r.json().catch(() => ({}));
}

export type Role = "admin" | "compliance_manager" | "control_owner" | "auditor" | "viewer";
export interface CurrentUser { id: number; email: string; name: string; role: Role; authProvider?: string; }

export async function login(email: string, password: string): Promise<CurrentUser> {
  const u = await post("/api/login", { email, password });
  resetSessionLost(); // so a later expiry is reported again
  return u;
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
  deactivatedAt?: string | null;
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
export async function fetchWorklist(): Promise<{ count: number; returned?: number; truncated?: boolean; tasks: WorklistTask[] }> {
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
  requirementId: number;
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
  summary: {
    covered: number;
    gaps: number;
    met: number;
    partial: number;
    weak: number;
    unassessed: number;
    readiness: number | null;
    // Coverage travels with the score so no render site can show one without
    // the other. readiness is computed over every requirement, unassessed
    // counting as 0, so a low number with low coverage is the honest reading.
    assessed: number;
    assessedOf: number;
    coverage: number;
  };
  requirements: RequirementRow[];
}
export async function fetchRequirements(framework: string): Promise<RequirementsResponse> {
  return get(`/api/requirements?framework=${framework}`);
}

export interface SoaEntry {
  requirementId: number;
  code: string;
  title: string | null;
  theme: string | null;
  new2022: boolean;
  /** null = nobody has decided; the UI must render that as undecided, not as "no" */
  applicable: boolean | null;
  status: "implemented" | "partial" | "planned" | "na";
  justification: string | null;
  coverage: { status: string; score: number | null; mapped: number } | null;
}
export interface SoaResponse {
  summary: { total: number; applicable: number; excluded: number; undecided: number; documented: number; implemented: number };
  entries: SoaEntry[];
}
export async function fetchSoa(): Promise<SoaResponse> {
  return get("/api/soa");
}
export async function setSoaEntry(reqId: number, body: { applicable?: boolean; status?: string; justification?: string }): Promise<void> {
  await post(`/api/soa/${reqId}`, body);
}

export interface ReportResponse {
  meta: {
    org: string;
    framework: string;
    period: { start: string; end: string; days: number };
    generatedAt: string;
    generatedBy: string;
    /** Whether the figures reproduce (frozen at close) or move with the data. */
    basis?: {
      kind: "frozen" | "partially-frozen" | "live" | "no-period";
      asOf: string | null;
      note?: string;
      requirements?: number;
      mappings?: number;
      controlsInScope?: number | null;
    };
    /** How much of the posture was attested inside the window vs carried in. */
    windowCoverage?: { withinWindow: number; carriedIn: number; total: number };
    reopened?: { at: string | null; count: number; reason: string | null };
  };
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
export async function fetchReport(framework: string, forExport = false): Promise<ReportResponse> {
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

export interface Period {
  id: number; name: string; framework: string; tier: string | null;
  startDate: string; endDate: string; status: string; tscCategories: string[] | null;
  closedAt?: string | null;
  reopenedAt?: string | null;
  reopenReason?: string | null;
  reopenCount?: number;
}
export async function fetchPeriods(): Promise<{ periods: Period[] }> {
  return get("/api/periods");
}
export async function createPeriod(body: { name: string; framework: string; tier?: string; startDate: string; endDate: string; tscCategories?: string[] }): Promise<void> {
  await post("/api/periods", body);
}
/** `reason` is required by the server when reopening a closed period. */
export async function setPeriodStatus(id: number, status: string, reason?: string): Promise<void> {
  await post(`/api/periods/${id}/status`, reason ? { status, reason } : { status });
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

/* ── Evidence ingress ──────────────────────────────────────────────────────
   Attaching evidence existed only as an API until now: the schema, the read
   paths and the snapshot table were all there, with no way for a person to put
   anything in. */

export interface AttachedEvidence {
  evidence: { id: number; controlCode: string; dimension: string; title: string; contentHash: string | null };
  snapshot: { id: number; contentHash: string; bytes: number; fetchedAt: string };
}

export async function attachEvidence(body: {
  control: string;
  dimension: "pol" | "proc" | "impl" | "meas" | "mang";
  title: string;
  kind?: string;
  url?: string;
  content?: string;
}): Promise<AttachedEvidence> {
  return post("/api/evidence", body);
}

export async function fetchSnapshots(evidenceId: number): Promise<{
  count: number;
  snapshots: { id: number; contentHash: string; bytes: number; sourceUrl: string | null; fetchedAt: string }[];
}> {
  return get(`/api/evidence/${evidenceId}/snapshots`);
}

/* ── User lifecycle ───────────────────────────────────────────────────────── */

export async function createUser(body: {
  email: string;
  name: string;
  role?: string;
  expiresAt?: string;
}): Promise<{ user: { id: number; email: string; name: string; role: string }; inviteToken: string; expiresInHours: number }> {
  return post("/api/users", body);
}

export async function reissueInvite(userId: number): Promise<{ inviteToken: string; expiresInHours: number }> {
  return post(`/api/users/${userId}/invite`);
}

export async function setUserActive(userId: number, active: boolean): Promise<void> {
  await post(`/api/users/${userId}/active`, { active });
}

export async function acceptInvite(token: string, password: string): Promise<void> {
  await post("/api/invite/accept", { token, password });
}

/* ── Crosswalk writes ─────────────────────────────────────────────────────── */

export async function createMapping(body: {
  control: string;
  requirementId: number;
  relationship: "equivalent" | "superset" | "subset" | "partial" | "related";
  confidence: "high" | "medium" | "low";
  note?: string;
}): Promise<void> {
  await post("/api/mappings", body);
}

export async function deleteMapping(id: number): Promise<void> {
  const r = await request(`/api/mappings/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await describe(`/api/mappings/${id}`, r));
}

/* ── Framework catalogs ────────────────────────────────────────────────────
   Which catalogs are loaded, and which this organisation has adopted. Loading
   is a build concern; enablement is a runtime decision an admin makes. */

export interface FrameworkInfo {
  id: string;
  name: string;
  version: string | null;
  enabled: boolean;
  licence: string | null;
  sourceUrl: string | null;
  requirements: number;
}

export async function fetchFrameworks(): Promise<{ frameworks: FrameworkInfo[] }> {
  return get("/api/frameworks");
}

export async function setFrameworkEnabled(id: string, enabled: boolean): Promise<void> {
  await post(`/api/frameworks/${id}/enabled`, { enabled });
}
