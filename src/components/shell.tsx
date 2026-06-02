// Global nav shell + stub/worklist pages. The control matrix is the live page;
// other IA sections are stubs until their roadmap phase.
import { useEffect, useState } from "react";
import type { Domain } from "../types";
import {
  fetchWorklist,
  fetchEvidence,
  fetchExceptions,
  fetchNotifications,
  fetchRequirements,
  fetchMatrix,
  fetchUsers,
  fetchReport,
  fetchIntegrations,
  fetchControlsLibrary,
  fetchPeriods,
  createPeriod,
  setPeriodStatus,
  setUserRole,
  assignControl,
  unassignControl,
  decideException,
  type ReportResponse,
  type Connector,
  type LibraryControl,
  type Period,
  type WorklistTask,
  type EvidenceItem,
  type ExceptionRow,
  type Notification,
  type RequirementsResponse,
  type MatrixSummary,
  type AdminUser,
  type Role,
} from "../api";

const ROLES: Role[] = ["admin", "compliance_manager", "control_owner", "auditor", "viewer"];

export interface NavItem {
  key: string;
  label: string;
  group?: string;
  live?: boolean;
  phase?: string;
}

export const NAV: NavItem[] = [
  { key: "dashboard", label: "Dashboard", live: true },
  { key: "matrix", label: "Control Matrix", group: "Programs", live: true },
  { key: "requirements", label: "Requirements + gaps", group: "Programs", live: true },
  { key: "periods", label: "Assessment periods", group: "Programs", live: true },
  { key: "worklist", label: "Worklist", live: true },
  { key: "evidence", label: "Evidence", live: true },
  { key: "controls", label: "Controls (CCF)", live: true },
  { key: "risks", label: "Risks & Exceptions", live: true },
  { key: "integrations", label: "Integrations", live: true },
  { key: "reports", label: "Reports", live: true },
  { key: "admin", label: "Admin", live: true },
];

export function Sidebar({ active, onNav }: { active: string; onNav: (k: string) => void }) {
  let lastGroup: string | undefined;
  return (
    <nav className="sidebar">
      {NAV.map((item) => {
        const showGroup = item.group && item.group !== lastGroup;
        lastGroup = item.group;
        return (
          <div key={item.key}>
            {showGroup && <div className="nav-group">{item.group}</div>}
            <button
              className={`nav-item ${active === item.key ? "active" : ""} ${item.group ? "indented" : ""}`}
              onClick={() => onNav(item.key)}
            >
              <span>{item.label}</span>
              {!item.live && <span className="nav-phase">{item.phase}</span>}
            </button>
          </div>
        );
      })}
    </nav>
  );
}

export function StubPage({ title, phase }: { title: string; phase?: string }) {
  return (
    <div className="stub-page">
      <div className="stub-card">
        <div className="stub-title">{title}</div>
        <div className="stub-sub">
          Not built yet — scheduled for <strong>{phase}</strong> in the roadmap.
        </div>
        <div className="stub-note">The control matrix and worklist are live against the API.</div>
      </div>
    </div>
  );
}

export function Alerts() {
  const [items, setItems] = useState<Notification[]>([]);
  useEffect(() => {
    fetchNotifications().then((d) => setItems(d.items)).catch(() => {});
  }, []);
  if (items.length === 0) return null;
  return (
    <div className="alerts">
      <div className="section-label" style={{ marginBottom: 6 }}>Alerts ({items.length})</div>
      {items.map((n, i) => (
        <div key={i} className={`alert sev-${n.severity}`}>
          <span className="alert-kind">{n.kind}</span>
          <span>{n.text}</span>
        </div>
      ))}
    </div>
  );
}

export function WorklistPage() {
  const [data, setData] = useState<{ count: number; tasks: WorklistTask[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetchWorklist().then(setData).catch((e) => setErr(String(e.message ?? e)));
  }, []);
  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Steering wheel</span>
        <h1 className="h1">
          Worklist <span className="frame">{data ? `· ${data.count} tasks` : ""}</span>
        </h1>
      </div>
      <Alerts />
      {err && <div className="api-banner error">{err}</div>}
      <div className="worklist">
        {data?.tasks.map((t) => (
          <div key={`${t.control}-${t.type}`} className="wl-row">
            <span className={`wl-prio p${Math.round(t.priority / 10)}`}>{t.priority}</span>
            <span className="wl-ctrl">{t.control}</span>
            <span className="wl-name">{t.name}</span>
            <span className="wl-reason">{t.reason}</span>
            <span className="wl-type">{t.type}</span>
          </div>
        ))}
        {data && data.tasks.length === 0 && <div className="stub-sub" style={{ padding: 20 }}>Nothing outstanding.</div>}
      </div>
    </div>
  );
}

export function EvidencePage() {
  const [data, setData] = useState<{ count: number; evidence: EvidenceItem[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetchEvidence().then(setData).catch((e) => setErr(String(e.message ?? e)));
  }, []);
  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Immutable, hashed, linked</span>
        <h1 className="h1">
          Evidence <span className="frame">{data ? `· ${data.count} items` : ""}</span>
        </h1>
      </div>
      {err && <div className="api-banner error">{err}</div>}
      <div className="worklist">
        {data?.evidence.map((e) => (
          <div key={e.id} className="ev-row">
            <span className="wl-ctrl">{e.controlCode}</span>
            <span className="ev-dim">{e.dimension}</span>
            <span className="wl-name">{e.title}</span>
            <span className="ev-src">{e.kind ?? e.sourceType}</span>
            <span className="ev-hash" title={e.contentHash ?? ""}>{e.contentHash?.slice(0, 10) ?? "—"}</span>
            {e.drifted ? <span className="tag drift">drift</span> : <span className="ev-ok">✓ current</span>}
          </div>
        ))}
        {data && data.evidence.length === 0 && <div className="stub-sub" style={{ padding: 20 }}>No evidence yet. Run <code>npm run db:docs</code>.</div>}
      </div>
    </div>
  );
}

export function ExceptionsPage({ role }: { role: string }) {
  const canDecide = role === "admin" || role === "compliance_manager";
  const [data, setData] = useState<{ count: number; exceptions: ExceptionRow[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => fetchExceptions().then(setData).catch((e) => setErr(String(e.message ?? e)));
  useEffect(() => {
    load();
  }, []);
  async function decide(id: number, decision: "approve" | "reject") {
    setErr(null);
    try {
      await decideException(id, decision);
      await load();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }
  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Risk acceptance · separation of duties</span>
        <h1 className="h1">
          Risks &amp; Exceptions <span className="frame">{data ? `· ${data.count}` : ""}</span>
        </h1>
      </div>
      {err && <div className="api-banner error">{err}</div>}
      <div className="worklist">
        {data?.exceptions.map((e) => (
          <div key={e.id} className="exc-row">
            <span className="wl-ctrl">{e.controlCode}</span>
            <span className={`exc-status s-${e.status}`}>{e.status}</span>
            <span className="wl-name">{e.reason}</span>
            <span className="exc-meta">
              req: {e.requestedByName ?? "—"}
              {e.approvedByName ? ` · appr: ${e.approvedByName}` : ""}
              {e.expiresAt ? ` · exp ${e.expiresAt.slice(0, 10)}` : ""}
            </span>
            {e.status === "pending" && canDecide ? (
              <span className="exc-actions">
                <button className="btn" onClick={() => decide(e.id, "approve")}>Approve</button>
                <button className="btn ghost" onClick={() => decide(e.id, "reject")}>Reject</button>
              </span>
            ) : (
              <span />
            )}
          </div>
        ))}
        {data && data.exceptions.length === 0 && <div className="stub-sub" style={{ padding: 20 }}>No exceptions.</div>}
      </div>
      <div className="stub-note" style={{ marginTop: 12, textAlign: "left" }}>
        SoD enforced: the requester cannot approve their own exception (the API returns 403). As the dev user is the
        Compliance Manager, approving the seeded owner-requested exceptions works; a self-requested one would be blocked.
      </div>
    </div>
  );
}

export function RequirementsPage() {
  const [fw, setFw] = useState<"soc2" | "iso27001">("soc2");
  const [data, setData] = useState<RequirementsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [gapsOnly, setGapsOnly] = useState(false);
  useEffect(() => {
    setData(null);
    fetchRequirements(fw).then(setData).catch((e) => setErr(String(e.message ?? e)));
  }, [fw]);
  const rows = (data?.requirements ?? []).filter((r) => !gapsOnly || r.status === "gap");
  const s = data?.summary;
  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Reverse roll-up · crosswalk gap report</span>
        <h1 className="h1">
          Requirements <span className="frame">+ gaps</span>
        </h1>
      </div>
      <div className="req-toolbar">
        <div className="seg">
          <button className={fw === "soc2" ? "on" : ""} onClick={() => setFw("soc2")}>SOC 2</button>
          <button className={fw === "iso27001" ? "on" : ""} onClick={() => setFw("iso27001")}>ISO 27001</button>
        </div>
        <button className={`chip ${gapsOnly ? "active" : ""}`} onClick={() => setGapsOnly((g) => !g)}>
          gaps only {s ? <span className="count">{s.gaps}</span> : null}
        </button>
      </div>
      {err && <div className="api-banner error">{err}</div>}
      {s && (
        <div className="kpi-strip" style={{ marginBottom: 16 }}>
          <div className="kpi"><span className="kpi-label">Readiness</span><span className="kpi-value">{s.readiness ?? "—"}<span className="unit">%</span></span><span className="kpi-delta">assessed reqs</span></div>
          <div className="kpi"><span className="kpi-label">Covered</span><span className="kpi-value">{s.covered}<span className="unit">/{data!.total}</span></span><span className="kpi-delta">have ≥1 control</span></div>
          <div className="kpi"><span className="kpi-label">Gaps</span><span className="kpi-value">{s.gaps}</span><span className="kpi-delta">no CCF coverage</span></div>
          <div className="kpi"><span className="kpi-label">Status</span><span className="kpi-value" style={{ fontSize: 14 }}>{s.met}✓ {s.partial}◐ {s.unassessed}○</span><span className="kpi-delta">met · partial · unassessed</span></div>
        </div>
      )}
      <div className="worklist">
        {rows.map((r) => (
          <div key={r.code} className={`req-row ${r.status === "gap" ? "is-gap" : ""}`}>
            <span className="wl-ctrl">{r.code}</span>
            <span className={`req-status st-${r.status}`}>{r.status}</span>
            <span className="wl-name">{r.title}</span>
            <span className="req-score">{r.score == null ? "—" : `${r.score}%`}</span>
            <span className="req-mapped">{r.status === "gap" ? "no controls" : `${r.mapped} control${r.mapped === 1 ? "" : "s"}`}</span>
          </div>
        ))}
        {data && rows.length === 0 && <div className="stub-sub" style={{ padding: 20 }}>None.</div>}
      </div>
    </div>
  );
}

export function DashboardPage({ onNav }: { onNav: (k: string) => void }) {
  const [summary, setSummary] = useState<MatrixSummary | null>(null);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [soc2, setSoc2] = useState<RequirementsResponse | null>(null);
  const [iso, setIso] = useState<RequirementsResponse | null>(null);
  useEffect(() => {
    fetchMatrix().then((r) => { setSummary(r.summary); setDomains(r.domains); }).catch(() => {});
    fetchRequirements("soc2").then(setSoc2).catch(() => {});
    fetchRequirements("iso27001").then(setIso).catch(() => {});
  }, []);
  const scored = domains.filter((d) => d.score != null);
  const gatesFailing = domains.filter((d) => d.gateFail);
  const fwCard = (label: string, key: string, d: RequirementsResponse | null) => (
    <button className="dash-fw" onClick={() => onNav("requirements")}>
      <div className="dash-fw-name">{label}</div>
      <div className="dash-fw-readiness">{d?.summary.readiness ?? "—"}<span className="unit">%</span></div>
      <div className="dash-fw-meta">{d ? `${d.summary.covered}/${d.total} covered · ${d.summary.gaps} gaps` : "…"}</div>
    </button>
  );
  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Organization posture</span>
        <h1 className="h1">Dashboard</h1>
      </div>
      <div className="kpi-strip" style={{ marginBottom: 16 }}>
        <div className="kpi"><span className="kpi-label">Controls</span><span className="kpi-value">{summary?.controlsTotal ?? "—"}</span><span className="kpi-delta">{summary?.categories ?? "—"} categories</span></div>
        <div className="kpi"><span className="kpi-label">Domains scored</span><span className="kpi-value">{scored.length}<span className="unit">/{domains.length || "—"}</span></span><span className="kpi-delta">{gatesFailing.length} gates failing</span></div>
        <div className="kpi"><span className="kpi-label">Crosswalk</span><span className="kpi-value">{summary?.mappingLinks ?? "—"}</span><span className="kpi-delta">links</span></div>
        <div className="kpi"><span className="kpi-label">Frameworks</span><span className="kpi-value">{(summary?.frameworks ?? []).length || "—"}</span><span className="kpi-delta">SOC 2 · ISO 27001</span></div>
      </div>
      <div className="dash-grid">
        <div className="dash-panel">
          <div className="section-label">Framework readiness</div>
          <div className="dash-fws">
            {fwCard("SOC 2", "soc2", soc2)}
            {fwCard("ISO 27001", "iso27001", iso)}
          </div>
        </div>
        <div className="dash-panel">
          <div className="section-label">Gate-failing domains</div>
          {gatesFailing.length === 0 ? (
            <div className="stub-sub" style={{ padding: "8px 0" }}>No domains failing the certification gate (of those scored).</div>
          ) : (
            gatesFailing.map((d) => (
              <button key={d.id} className="dash-gate" onClick={() => onNav("matrix")}>
                <span className="wl-ctrl">{d.id}</span>
                <span className="wl-name">{d.name}</span>
                <span className="dash-gate-badge">▲ {d.gate?.toFixed(1)}</span>
              </button>
            ))
          )}
        </div>
        <div className="dash-panel">
          <Alerts />
        </div>
      </div>
    </div>
  );
}

export function AdminPage({ me }: { me: { role: string } }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<number | null>(null);
  const [addCode, setAddCode] = useState("");
  const load = () => fetchUsers().then((d) => setUsers(d.users)).catch((e) => setErr(String(e.message ?? e)));
  useEffect(() => {
    load();
  }, []);
  const isAdmin = me.role === "admin";
  async function changeRole(id: number, role: Role) {
    setErr(null);
    try {
      await setUserRole(id, role);
      await load();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }
  async function addAssign(userId: number) {
    if (!addCode.trim()) return;
    setErr(null);
    try {
      await assignControl(userId, addCode.trim());
      setAddCode("");
      setAddFor(null);
      await load();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }
  async function removeAssign(userId: number, code: string) {
    try {
      await unassignControl(userId, code);
      await load();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }
  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Users · roles · assignment scoping</span>
        <h1 className="h1">
          Admin <span className="frame">· Users</span>
        </h1>
      </div>
      {err && <div className="api-banner error">{err}</div>}
      <div className="worklist">
        {users.map((u) => (
          <div key={u.id} className="adm-row">
            <div className="adm-id">
              <div className="adm-name">{u.name}{u.expiresAt ? <span className="adm-exp"> · expires {u.expiresAt.slice(0, 10)}</span> : null}</div>
              <div className="adm-email">{u.email}</div>
            </div>
            <select className="adm-role" value={u.role} disabled={!isAdmin} onChange={(e) => changeRole(u.id, e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <div className="adm-assigns">
              {u.role === "control_owner" ? (
                <>
                  {u.assignments.map((c) => (
                    <span key={c} className="xwalk adm-assign">
                      {c}
                      <button className="adm-x" onClick={() => removeAssign(u.id, c)} title="unassign">×</button>
                    </span>
                  ))}
                  {addFor === u.id ? (
                    <span className="adm-add">
                      <input className="adm-add-input" placeholder="01.a" value={addCode} onChange={(e) => setAddCode(e.target.value)} autoFocus
                        onKeyDown={(e) => e.key === "Enter" && addAssign(u.id)} />
                      <button className="btn" onClick={() => addAssign(u.id)}>add</button>
                    </span>
                  ) : (
                    <button className="adm-add-btn" onClick={() => { setAddFor(u.id); setAddCode(""); }}>+ assign control</button>
                  )}
                </>
              ) : (
                <span className="adm-na">— scoping applies to Control Owners —</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="stub-note" style={{ marginTop: 12, textAlign: "left" }}>
        Roles are editable by Admin only. Control Owners can attest only their assigned controls (the API enforces it).
        SSO/SCIM (auto-provisioning + IdP group→role) is the Phase-3 remainder; this is the local-account foundation.
      </div>
    </div>
  );
}

const RATING_LABEL: Record<string, string> = { fc: "Fully", mc: "Mostly", pc: "Partially", sc: "Somewhat", nc: "Non-compliant" };

export function ReportsPage() {
  const [fw, setFw] = useState<"soc2" | "iso27001">("soc2");
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function generate() {
    setBusy(true); setErr(null);
    try { setReport(await fetchReport(fw)); }
    catch (e: any) { setErr(String(e.message ?? e)); }
    finally { setBusy(false); }
  }
  async function downloadJson() {
    setErr(null);
    try {
      // Re-fetch as an export — a sensitive action requiring step-up re-auth.
      const pkg = await fetchReport(fw, true);
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `autocomply-${fw}-evidence-package.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }
  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Auditor evidence package</span>
        <h1 className="h1">Reports</h1>
      </div>
      <div className="req-toolbar no-print">
        <div className="seg">
          <button className={fw === "soc2" ? "on" : ""} onClick={() => setFw("soc2")}>SOC 2</button>
          <button className={fw === "iso27001" ? "on" : ""} onClick={() => setFw("iso27001")}>ISO 27001</button>
        </div>
        <button className="btn primary" disabled={busy} onClick={generate}>{busy ? "Generating…" : "Generate report"}</button>
        {report && <button className="btn" onClick={downloadJson}>Download JSON</button>}
        {report && <button className="btn" onClick={() => window.print()}>Print / PDF</button>}
      </div>
      {err && <div className="api-banner error">{err}</div>}
      {!report && !err && <div className="stub-sub">Choose a framework and generate the evidence package.</div>}
      {report && (
        <div className="report-doc">
          <div className="report-head">
            <div className="report-title">{report.meta.framework} — Evidence Package</div>
            <div className="report-meta">
              {report.meta.org} · period {report.meta.period.start} → {report.meta.period.end} ({report.meta.period.days}d) ·
              generated {new Date(report.meta.generatedAt).toLocaleString()} by {report.meta.generatedBy}
            </div>
          </div>

          <div className="report-section">
            <div className="section-label">Readiness summary</div>
            <div className="report-summary">
              <div><b>{report.readiness.readiness ?? "—"}%</b> readiness</div>
              <div><b>{report.readiness.covered}</b> covered</div>
              <div><b>{report.readiness.gaps}</b> gaps</div>
              <div>{report.readiness.met} met · {report.readiness.partial} partial · {report.readiness.unassessed} unassessed</div>
            </div>
          </div>

          <div className="report-section">
            <div className="section-label">Requirement coverage ({report.requirements.length})</div>
            <table className="report-table">
              <thead><tr><th>Code</th><th>Requirement</th><th>Status</th><th>Score</th><th>Controls</th></tr></thead>
              <tbody>
                {report.requirements.map((r) => (
                  <tr key={r.code} className={r.status === "gap" ? "is-gap" : ""}>
                    <td className="mono">{r.code}</td><td>{r.title}</td>
                    <td><span className={`req-status st-${r.status}`}>{r.status}</span></td>
                    <td className="mono">{r.score == null ? "—" : `${r.score}%`}</td>
                    <td className="mono">{r.mapped || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.gaps.length > 0 && (
            <div className="report-section">
              <div className="section-label">Coverage gaps ({report.gaps.length}) — no CCF control maps here</div>
              <div className="report-gaps">{report.gaps.map((g) => <span key={g.code} className="xwalk">{g.code}</span>)}</div>
            </div>
          )}

          <div className="report-section">
            <div className="section-label">Control evidence ({report.controls.length})</div>
            <table className="report-table">
              <thead><tr><th>Control</th><th>Pol</th><th>Proc</th><th>Impl</th><th>Meas</th><th>Mang</th><th>Score</th><th>Evidence</th></tr></thead>
              <tbody>
                {report.controls.map((c) => (
                  <tr key={c.code}>
                    <td><span className="mono">{c.code}</span> {c.title}</td>
                    {c.ratings.map((r) => <td key={r.dim} className="mono" title={r.marker ?? ""}>{r.rating ? r.rating.toUpperCase() : "·"}</td>)}
                    <td className="mono">{c.score == null ? "—" : `${c.score}%`}</td>
                    <td className="report-ev">{c.evidence.length ? c.evidence.map((e, i) => <span key={i} className="report-ev-item" title={e.contentHash ?? ""}>{e.kind ?? e.sourceType}{e.drifted ? " ⚠" : ""}</span>) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.exceptions.length > 0 && (
            <div className="report-section">
              <div className="section-label">Exceptions / risk acceptances ({report.exceptions.length})</div>
              <table className="report-table">
                <thead><tr><th>Control</th><th>Status</th><th>Reason</th><th>Expires</th></tr></thead>
                <tbody>
                  {report.exceptions.map((e, i) => (
                    <tr key={i}><td className="mono">{e.control}</td><td>{e.status}</td><td>{e.reason}</td><td className="mono">{e.expiresAt?.slice(0, 10) ?? "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="report-foot">Generated by autocomply · ratings: {Object.entries(RATING_LABEL).map(([k, v]) => `${k.toUpperCase()}=${v}`).join(" · ")}</div>
        </div>
      )}
    </div>
  );
}

export function IntegrationsPage() {
  const [conns, setConns] = useState<Connector[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetchIntegrations().then((d) => setConns(d.connectors)).catch((e) => setErr(String(e.message ?? e)));
  }, []);
  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Connectors · collector health</span>
        <h1 className="h1">Integrations</h1>
      </div>
      {err && <div className="api-banner error">{err}</div>}
      <div className="conn-grid">
        {conns.map((c) => (
          <div key={c.name} className="conn-card">
            <div className="conn-top">
              <span className="conn-name">{c.name}</span>
              <span className={`conn-status cs-${c.status}`}>{c.status}</span>
            </div>
            <div className="conn-stats">
              <div><b>{c.checks}</b><span>checks</span></div>
              <div><b>{c.passRate ?? "—"}%</b><span>pass</span></div>
              <div><b>{c.findings}</b><span>findings</span></div>
            </div>
            <div className="conn-foot">{c.coverage}{c.lastRun ? ` · last ${new Date(c.lastRun).toLocaleDateString()}` : ""}</div>
          </div>
        ))}
      </div>
      <div className="stub-note" style={{ marginTop: 14, textAlign: "left" }}>
        AWS connectors use assume-role (no stored keys) in production; here they're the simulated collector
        (<code>npm run db:collect</code>). Status reflects CheckRun completeness; document sources flag drift.
      </div>
    </div>
  );
}

export function ControlsPage() {
  const [data, setData] = useState<{ categories: { id: string; title: string }[]; controls: LibraryControl[] } | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetchControlsLibrary().then(setData).catch((e) => setErr(String(e.message ?? e)));
  }, []);
  const filtered = (data?.controls ?? []).filter((c) => !q || c.code.includes(q) || c.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">CCF · 156 controls → 14 categories → 49 objectives</span>
        <h1 className="h1">Controls <span className="frame">{data ? `· ${data.controls.length}` : ""}</span></h1>
      </div>
      <div className="req-toolbar">
        <div className="search" style={{ width: 280 }}>
          <input placeholder="Filter by code or title…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {err && <div className="api-banner error">{err}</div>}
      <div className="worklist">
        {filtered.map((c) => (
          <div key={c.code} className="lib-row">
            <span className="wl-ctrl">{c.code}</span>
            <span className="wl-name">{c.title}</span>
            <span className="lib-obj">{c.objective}</span>
            <span className="lib-xw">SOC2 {c.soc2} · ISO {c.iso27001}</span>
            <span className="req-score">{c.score == null ? "—" : `${c.score}%`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const TSC_CATS = ["security", "availability", "confidentiality", "processing_integrity", "privacy"];

export function PeriodsPage({ role }: { role: string }) {
  const canEdit = role === "admin" || role === "compliance_manager";
  const [periods, setPeriods] = useState<Period[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", framework: "soc2", startDate: "2026-01-01", endDate: "2026-06-30", tsc: ["security"] as string[] });
  const load = () => fetchPeriods().then((d) => setPeriods(d.periods)).catch((e) => setErr(String(e.message ?? e)));
  useEffect(() => {
    load();
  }, []);
  async function create() {
    setErr(null);
    try {
      await createPeriod({ name: form.name || `${form.framework} period`, framework: form.framework, startDate: form.startDate, endDate: form.endDate, tscCategories: form.framework === "soc2" ? form.tsc : undefined });
      setShowNew(false);
      await load();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }
  async function cycle(p: Period) {
    const next = p.status === "planning" ? "active" : p.status === "active" ? "closed" : "planning";
    try {
      await setPeriodStatus(p.id, next);
      await load();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }
  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Scope · lifecycle</span>
        <h1 className="h1">Assessment periods</h1>
      </div>
      {canEdit && (
        <div className="req-toolbar">
          <button className="btn primary" onClick={() => setShowNew((v) => !v)}>{showNew ? "Cancel" : "+ New period"}</button>
        </div>
      )}
      {showNew && (
        <div className="period-form">
          <input className="login-input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="adm-role" value={form.framework} onChange={(e) => setForm({ ...form, framework: e.target.value })}>
            <option value="soc2">SOC 2</option><option value="iso27001">ISO 27001</option><option value="hitrust">HITRUST r2</option>
          </select>
          <input className="login-input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          <input className="login-input" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          {form.framework === "soc2" && (
            <div className="tsc-pick">
              {TSC_CATS.map((t) => (
                <label key={t} className={`tsc-chip ${form.tsc.includes(t) ? "on" : ""} ${t === "security" ? "locked" : ""}`}>
                  <input type="checkbox" checked={form.tsc.includes(t) || t === "security"} disabled={t === "security"}
                    onChange={(e) => setForm({ ...form, tsc: e.target.checked ? [...form.tsc, t] : form.tsc.filter((x) => x !== t) })} />
                  {t.replace("_", " ")}
                </label>
              ))}
            </div>
          )}
          <button className="btn primary" onClick={create}>Create</button>
        </div>
      )}
      {err && <div className="api-banner error">{err}</div>}
      <div className="worklist">
        {periods.map((p) => (
          <div key={p.id} className="period-row">
            <span className="wl-name">{p.name}</span>
            <span className="period-fw">{p.framework}{p.tier ? ` · ${p.tier}` : ""}</span>
            <span className="period-dates">{p.startDate.slice(0, 10)} → {p.endDate.slice(0, 10)}</span>
            <span className="period-tsc">{p.tscCategories ? p.tscCategories.map((c) => c[0].toUpperCase()).join("") : ""}</span>
            <button className={`exc-status s-${p.status === "active" ? "approved" : p.status === "closed" ? "rejected" : "pending"}`} disabled={!canEdit} onClick={() => cycle(p)} title={canEdit ? "click to cycle status" : ""}>
              {p.status}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
