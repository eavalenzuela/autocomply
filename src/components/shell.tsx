// Global nav shell + the IA section pages. Every nav section is live against the API.
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
  fetchSoa,
  setSoaEntry,
  fetchAudit,
  type AuditResponse,
  type SoaEntry,
  type SoaResponse,
  type ReportResponse,
  type Connector,
  type CatalogExportStatus,
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
  createUser,
  reissueInvite,
  setUserActive,
  createMapping,
  deleteMapping,
  fetchFrameworks,
  setFrameworkEnabled,
  type FrameworkInfo,
} from "../api";
import { ControlPicker } from "./ControlPicker";
import { FrameworkTabs, useEnabledFrameworks } from "./FrameworkTabs";

const ROLES: Role[] = ["admin", "compliance_manager", "control_owner", "auditor", "viewer"];

export interface NavItem {
  key: string;
  label: string;
  group?: string;
}

// Below "Programs" the rail was seven flat entries in no particular order, so
// the only organised part of it was the first four. Each block now answers a
// different question: how are we doing against a framework, what needs doing,
// what does the catalog say, and how is this instance set up.
//
// "Controls (CCF)" became "Control library": it sat next to "Control Matrix"
// with an acronym doing the work of telling them apart, which it only does for
// someone who already knows the difference.
export const NAV: NavItem[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "matrix", label: "Control Matrix", group: "Programs" },
  { key: "requirements", label: "Requirements + gaps", group: "Programs" },
  { key: "soa", label: "ISO SoA", group: "Programs" },
  { key: "periods", label: "Assessment periods", group: "Programs" },
  { key: "worklist", label: "Worklist", group: "Operate" },
  { key: "evidence", label: "Evidence", group: "Operate" },
  { key: "risks", label: "Risks & Exceptions", group: "Operate" },
  { key: "controls", label: "Control library", group: "Reference" },
  { key: "reports", label: "Reports", group: "Reference" },
  { key: "integrations", label: "Integrations", group: "Setup" },
  { key: "admin", label: "Admin", group: "Setup" },
];


/**
 * Loading, empty and error are three different things and were rendering as one
 * blank box: a page fetching, a page with nothing in it, and a page whose fetch
 * failed all looked the same, so "is it broken or is it empty?" had no answer.
 */
export function ListState({
  loading,
  error,
  empty,
  emptyText,
}: {
  loading: boolean;
  error?: string | null;
  empty: boolean;
  emptyText: string;
}) {
  if (error) return <div className="api-banner error">{error}</div>;
  if (loading) return <div className="stub-sub list-state">Loading…</div>;
  if (empty) return <div className="stub-sub list-state">{emptyText}</div>;
  return null;
}

export function Sidebar({ active, onNav, hide = [] }: { active: string; onNav: (k: string) => void; hide?: string[] }) {
  let lastGroup: string | undefined;
  return (
    <nav className="sidebar" aria-label="Sections">
      {NAV.filter((item) => !hide.includes(item.key)).map((item) => {
        const showGroup = item.group && item.group !== lastGroup;
        lastGroup = item.group;
        return (
          <div key={item.key}>
            {showGroup && <div className="nav-group">{item.group}</div>}
            <button
              className={`nav-item ${active === item.key ? "active" : ""} ${item.group ? "indented" : ""}`}
              aria-current={active === item.key ? "page" : undefined}
              onClick={() => onNav(item.key)}
            >
              <span>{item.label}</span>
            </button>
          </div>
        );
      })}
    </nav>
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

export function WorklistPage({
  onOpenControl,
  onNav,
}: {
  onOpenControl?: (code: string) => void;
  onNav?: (section: string) => void;
}) {
  const [data, setData] = useState<{ count: number; returned?: number; truncated?: boolean; tasks: WorklistTask[] } | null>(null);
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
          <div
            key={`${t.control}-${t.type}`}
            className="wl-row clickable"
            // Route by task type. Every task used to open the control drawer,
            // including "approve this exception" — and an exception cannot be
            // approved from the drawer, so the highest-priority items in the
            // worklist led somewhere they could not be actioned.
            onClick={() => {
              if (t.type === "approve-exception" || t.type === "exception-expiring" || t.type === "exception-lapsed") {
                onNav?.("risks");
              } else {
                onOpenControl?.(t.control);
              }
            }}
            title={
              t.type.startsWith("exception") || t.type === "approve-exception"
                ? "Open Risks & Exceptions"
                : `Open ${t.control}`
            }
          >
            <span className={`wl-prio p${Math.round(t.priority / 10)}`}>{t.priority}</span>
            <span className="wl-ctrl">{t.control}</span>
            <span className="wl-name">{t.name}</span>
            <span className="wl-reason">{t.reason}</span>
            <span className="wl-type">{t.type}</span>
          </div>
        ))}
        <ListState loading={!data && !err} error={err} empty={!!data && data.tasks.length === 0} emptyText="Nothing outstanding." />
        {/* Say when the list is cut. Showing 80 of 289 with no indication means
            everything below the cut does not exist as far as the user knows. */}
        {data?.truncated && (
          <div className="stub-sub" style={{ padding: "10px 20px" }}>
            Showing the {data.returned} highest-priority of {data.count} open items.
          </div>
        )}
      </div>
    </div>
  );
}

export function EvidencePage({ onOpenControl }: { onOpenControl?: (code: string) => void }) {
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
          <div
            key={e.id}
            className={`ev-row ${onOpenControl ? "clickable" : ""}`}
            onClick={onOpenControl ? () => onOpenControl(e.controlCode) : undefined}
            title={onOpenControl ? `Open ${e.controlCode}` : undefined}
          >
            <span className="wl-ctrl">{e.controlCode}</span>
            <span className="ev-dim">{e.dimension}</span>
            <span className="wl-name">{e.title}</span>
            <span className="ev-src">{e.kind ?? e.sourceType}</span>
            <span className="ev-hash" title={e.contentHash ?? ""}>{e.contentHash?.slice(0, 10) ?? "—"}</span>
            {e.drifted ? <span className="tag drift">drift</span> : <span className="ev-ok">✓ current</span>}
          </div>
        ))}
        <ListState loading={!data && !err} error={err} empty={!!data && data.evidence.length === 0} emptyText="No evidence has been attached yet." />
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
        <ListState loading={!data && !err} error={err} empty={!!data && data.exceptions.length === 0} emptyText="No exceptions have been raised." />
      </div>
      <div className="stub-note" style={{ marginTop: 12, textAlign: "left" }}>
        SoD enforced: the requester cannot approve their own exception (the API returns 403). As the dev user is the
        Compliance Manager, approving the seeded owner-requested exceptions works; a self-requested one would be blocked.
      </div>
    </div>
  );
}

export function RequirementsPage({
  role,
  framework,
  onFramework,
}: {
  role?: string;
  /** From the URL, so a framework view can be bookmarked and shared. */
  framework?: string | null;
  onFramework?: (id: string) => void;
}) {
  // Whatever is enabled, not a hardcoded pair.
  const frameworks = useEnabledFrameworks();
  // The URL is the source of truth when it names one.
  const fw = framework || "soc2";
  const setFw = (id: string) => onFramework?.(id);
  useEffect(() => {
    // If the current selection is not enabled, land on the first one that is
    // rather than asking for a framework the organisation has not adopted.
    if (frameworks.length && !frameworks.some((f) => f.id === fw)) onFramework?.(frameworks[0].id);
  }, [frameworks, fw, onFramework]);
  const [data, setData] = useState<RequirementsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [gapsOnly, setGapsOnly] = useState(false);
  const [mapFor, setMapFor] = useState<string | null>(null);
  const [mapCode, setMapCode] = useState("");
  const [mapBusy, setMapBusy] = useState(false);

  async function doMap(r: { code: string; requirementId?: number }, picked?: string) {
    const requirementId = (r as any).requirementId;
    const code = (picked ?? mapCode).trim();
    if (!requirementId || !code) return;
    setMapBusy(true);
    setErr(null);
    try {
      await createMapping({
        control: code.toUpperCase(),
        requirementId,
        // Conservative defaults for a hand-made link: it covers part of the
        // requirement, and a human said so rather than a crosswalk deriving it.
        relationship: "partial",
        confidence: "medium",
      });
      setMapFor(null);
      setMapCode("");
      await loadReqs();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setMapBusy(false);
    }
  }
  const loadReqs = () => fetchRequirements(fw).then(setData).catch((e) => setErr(String(e.message ?? e)));
  useEffect(() => {
    setData(null);
    loadReqs();
  }, [fw]);
  // Editing the crosswalk is the same authority as editing the SoA.
  const canMap = role === "admin" || role === "compliance_manager";
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
          <FrameworkTabs value={fw} onChange={setFw} frameworks={frameworks} />
        </div>
        <button className={`chip ${gapsOnly ? "active" : ""}`} onClick={() => setGapsOnly((g) => !g)}>
          gaps only {s ? <span className="count">{s.gaps}</span> : null}
        </button>
      </div>
      {err && <div className="api-banner error">{err}</div>}
      {s && (
        <div className="kpi-strip" style={{ marginBottom: 16 }}>
          <div className="kpi"><span className="kpi-label">Readiness</span><span className="kpi-value">{s.readiness ?? "—"}<span className="unit">%</span></span><span className="kpi-delta">{s.assessed ?? 0} of {s.assessedOf ?? data!.total} assessed</span></div>
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
            {/* A gap you cannot close in the product is a to-do list. Mappings
                could only come from the loader, so closing one meant editing
                YAML and reseeding — which wipes the database. */}
            {canMap && r.status === "gap" && (
              mapFor === r.code ? (
                <span className="adm-add">
                  <ControlPicker
                    value={mapCode}
                    onChange={setMapCode}
                    onPick={(code) => doMap(r, code)}
                    autoFocus
                    ariaLabel={`Control to map to ${r.code}`}
                  />
                  <button className="btn" onClick={() => doMap(r)} disabled={mapBusy}>
                    {mapBusy ? "…" : "map"}
                  </button>
                  <button className="btn ghost" onClick={() => { setMapFor(null); setMapCode(""); }}>cancel</button>
                </span>
              ) : (
                <button className="btn ghost" onClick={() => { setMapFor(r.code); setMapCode(""); }}>
                  map a control
                </button>
              )
            )}
          </div>
        ))}
        {data && rows.length === 0 && <div className="stub-sub" style={{ padding: 20 }}>None.</div>}
      </div>
    </div>
  );
}

const SOA_STATUS = ["implemented", "partial", "planned", "na"];

// The SoA as the document an assessor actually asks for: one CSV row per Annex A
// entry with applicability, status, justification, and crosswalk-derived coverage.
function soaCsv(entries: SoaEntry[]): string {
  const esc = (v: unknown) => {
    const str = v == null ? "" : String(v);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const header = ["code", "title", "theme", "new_2022", "applicable", "status", "justification", "coverage_status", "coverage_score", "mapped_controls"];
  const lines = [header.join(",")];
  for (const r of entries) {
    lines.push(
      [
        r.code,
        r.title ?? "",
        r.theme ?? "",
        r.new2022 ? "yes" : "no",
        // An undecided control exports as blank, not "yes". A CSV row that says
        // "applicable: yes" is a claim, and nobody made it.
        r.applicable == null ? "" : r.applicable ? "yes" : "no",
        r.applicable == null ? "undecided" : r.applicable ? r.status : "excluded",
        r.justification ?? "",
        r.coverage?.status ?? "",
        r.coverage?.score ?? "",
        r.coverage?.mapped ?? 0,
      ]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export function SoaPage({ role }: { role: string }) {
  const canEdit = role === "admin" || role === "compliance_manager";
  const [data, setData] = useState<SoaResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const load = () => fetchSoa().then(setData).catch((e) => setErr(String(e.message ?? e)));
  useEffect(() => {
    load();
  }, []);
  async function update(reqId: number, body: { applicable?: boolean; status?: string; justification?: string }) {
    setErr(null);
    try {
      await setSoaEntry(reqId, body);
      await load();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }
  const rows = (data?.entries ?? []).filter((r) => !q || r.code.toLowerCase().includes(q.toLowerCase()) || (r.title ?? "").toLowerCase().includes(q.toLowerCase()));
  const s = data?.summary;
  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">ISO/IEC 27001:2022 · Annex A</span>
        <h1 className="h1">
          Statement of Applicability {data ? <span className="frame">· {data.summary.total} controls</span> : null}
        </h1>
      </div>
      {s && (
        <div className="kpi-strip" style={{ marginBottom: 16 }}>
          <div className="kpi"><span className="kpi-label">Applicable</span><span className="kpi-value">{s.applicable}<span className="unit">/{s.total}</span></span><span className="kpi-delta">{s.excluded} excluded</span></div>
          <div className="kpi"><span className="kpi-label">Implemented</span><span className="kpi-value">{s.implemented}</span><span className="kpi-delta">status set</span></div>
          <div className="kpi"><span className="kpi-label">Justified</span><span className="kpi-value">{s.documented}</span><span className="kpi-delta">have justification</span></div>
          <div className="kpi"><span className="kpi-label">Excluded</span><span className="kpi-value">{s.excluded}</span><span className="kpi-delta">marked N/A</span></div>
        </div>
      )}
      <div className="req-toolbar">
        <div className="search" style={{ width: 280 }}>
          <input placeholder="Filter by code or title…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {data && (
          <button
            className="btn"
            onClick={() => {
              const blob = new Blob([soaCsv(data.entries)], { type: "text/csv" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "autocomply-iso27001-soa.csv";
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Download CSV
          </button>
        )}
        {!canEdit && <span className="stub-sub">Read-only — admin / compliance manager can edit.</span>}
      </div>
      {err && <div className="api-banner error">{err}</div>}
      <div className="worklist">
        {rows.map((r) => (
          <div key={r.requirementId} className={`soa-row ${!r.applicable ? "excluded" : ""}`}>
            <span className="wl-ctrl">
              {r.code}
              {r.new2022 ? <span className="soa-new" title="new in 2022"> ●</span> : null}
            </span>
            <span className="wl-name">{r.title}</span>
            {r.coverage ? (
              <span className={`req-status st-${r.coverage.status}`} title="crosswalk-derived coverage">
                {r.coverage.status}
                {r.coverage.score != null ? ` ${r.coverage.score}%` : ""}
              </span>
            ) : (
              <span className="req-mapped">no map</span>
            )}
            {canEdit ? (
              <select className="adm-role" value={r.status} disabled={r.applicable !== true} onChange={(e) => update(r.requirementId, { status: e.target.value })}>
                {SOA_STATUS.map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
            ) : (
              <span className="soa-status-ro">
                {r.applicable == null ? "undecided" : r.applicable ? r.status : "excluded"}
              </span>
            )}
            {canEdit && (
              <label className="soa-appl">
                {/* Three states, not two: an undecided control renders indeterminate
                    rather than unchecked, so "nobody has ruled on this" cannot be
                    misread as "we excluded it". */}
                <input
                  type="checkbox"
                  ref={(el) => {
                    if (el) el.indeterminate = r.applicable == null;
                  }}
                  checked={r.applicable === true}
                  onChange={(e) => update(r.requirementId, { applicable: e.target.checked })}
                />{" "}
                applicable
              </label>
            )}
            {editing === r.requirementId ? (
              <span className="soa-just-edit">
                <input className="adm-add-input" value={draft} placeholder="justification…" autoFocus onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { update(r.requirementId, { justification: draft }); setEditing(null); } }} />
                <button className="btn" onClick={() => { update(r.requirementId, { justification: draft }); setEditing(null); }}>save</button>
              </span>
            ) : (
              <span className="soa-just" title={r.justification ?? ""} onClick={() => { if (canEdit) { setEditing(r.requirementId); setDraft(r.justification ?? ""); } }}>
                {r.justification ? r.justification.slice(0, 44) : canEdit ? "+ justify" : "—"}
              </span>
            )}
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
  // Readiness per adopted framework, fetched for whichever are enabled.
  const frameworks = useEnabledFrameworks();
  const [readiness, setReadiness] = useState<Record<string, RequirementsResponse | null>>({});
  useEffect(() => {
    let alive = true;
    Promise.all(
      frameworks.map((f) =>
        fetchRequirements(f.id)
          .then((r) => [f.id, r] as const)
          .catch(() => [f.id, null] as const),
      ),
    ).then((pairs) => {
      if (alive) setReadiness(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [frameworks]);
  useEffect(() => {
    fetchMatrix().then((r) => { setSummary(r.summary); setDomains(r.domains); }).catch(() => {});
  }, []);
  const scored = domains.filter((d) => d.score != null);
  const gatesFailing = domains.filter((d) => d.gateFail);
  const fwCard = (label: string, key: string, d: RequirementsResponse | null) => (
    <button className="dash-fw" onClick={() => onNav("requirements")}>
      <div className="dash-fw-name">{label}</div>
      <div className="dash-fw-readiness">{d?.summary.readiness ?? "—"}<span className="unit">%</span></div>
      <div className="dash-fw-meta">
        {d ? `${d.summary.assessed ?? 0}/${d.total} assessed · ${d.summary.gaps} gaps` : "…"}
      </div>
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
        <div className="kpi"><span className="kpi-label">Frameworks</span><span className="kpi-value">{frameworks.length || "—"}</span><span className="kpi-delta">{frameworks.map((f) => f.name).join(" · ") || "none adopted"}</span></div>
      </div>
      <div className="dash-grid">
        <div className="dash-panel">
          <div className="section-label">Framework readiness</div>
          <div className="dash-fws">
            {/* Every adopted framework, not a hardcoded pair. Two catalogs were
                named here while five were enabled, so three had no readiness
                figure anywhere in the product. */}
            {frameworks.map((f) => fwCard(f.name, f.id, readiness[f.id] ?? null))}
            {frameworks.length === 0 && (
              <div className="stub-sub">No frameworks adopted yet — enable one under Admin.</div>
            )}
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

// Read side of the append-only audit trail (GET /api/audit): newest-first,
// paginated, filterable by action. Visible to admin + auditor.
function AuditLogPanel() {
  const PAGE = 25;
  const [data, setData] = useState<AuditResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState(""); // applied filter
  const [draft, setDraft] = useState(""); // filter input (applied on Enter)
  useEffect(() => {
    fetchAudit({ limit: PAGE, offset, action: action || undefined })
      .then(setData)
      .catch((e) => setErr(String(e.message ?? e)));
  }, [offset, action]);
  const apply = () => {
    setOffset(0);
    setAction(draft.trim());
  };
  return (
    <>
      <div className="page-head" style={{ marginTop: 28 }}>
        <span className="eyebrow">Append-only · who did what, when</span>
        <h1 className="h1">
          Audit log <span className="frame">{data ? `· ${data.total} entries` : ""}</span>
        </h1>
      </div>
      <div className="req-toolbar">
        <div className="search" style={{ width: 280 }}>
          <input
            placeholder="Filter by action (Enter)… e.g. attest"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
          />
        </div>
        {action && (
          <button className="chip active" onClick={() => { setDraft(""); setAction(""); setOffset(0); }}>
            action: {action} ×
          </button>
        )}
        <span className="chip-spacer" />
        {data && data.total > PAGE && (
          <span className="audit-pager">
            <button className="btn ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>‹ newer</button>
            <span className="stub-sub">{offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}</span>
            <button className="btn ghost" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>older ›</button>
          </span>
        )}
      </div>
      {err && <div className="api-banner error">{err}</div>}
      <div className="worklist">
        {data?.entries.map((e) => (
          <div key={e.id} className="audit-row">
            <span className="audit-ts">{new Date(e.ts).toLocaleString()}</span>
            <span className="audit-actor">{e.actor ?? "system"}</span>
            <span className="wl-type">{e.action}</span>
            <span className="audit-target">{e.targetType ? `${e.targetType}${e.targetId ? ` · ${e.targetId}` : ""}` : "—"}</span>
            <span className="audit-payload" title={e.payload ? JSON.stringify(e.payload, null, 2) : ""}>
              {e.payload ? JSON.stringify(e.payload) : ""}
            </span>
          </div>
        ))}
        <ListState loading={!data && !err} error={err} empty={!!data && data.entries.length === 0} emptyText="No matching entries." />
      </div>
    </>
  );
}

export function AdminPage({ me }: { me: { role: string } }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<number | null>(null);
  const [addCode, setAddCode] = useState("");
  // Creating a user existed only as an API: seed.ts held the only INSERT into
  // users, so there was no way to add a colleague from inside the product.
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<Role>("viewer");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<{ email: string; token: string; hours: number } | null>(null);
  const [frameworks, setFrameworks] = useState<FrameworkInfo[]>([]);
  const loadFrameworks = () =>
    fetchFrameworks().then((d) => setFrameworks(d.frameworks)).catch(() => { /* non-fatal */ });

  async function toggleFramework(id: string, enabled: boolean) {
    setErr(null);
    try {
      await setFrameworkEnabled(id, enabled);
      await loadFrameworks();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }
  const load = () => fetchUsers().then((d) => setUsers(d.users)).catch((e) => setErr(String(e.message ?? e)));

  async function addUser() {
    setErr(null);
    setBusy(true);
    try {
      const res = await createUser({ email: newEmail.trim(), name: newName.trim(), role: newRole });
      // Shown once, and never stored. The admin copies it to the person.
      setInvite({ email: res.user.email, token: res.inviteToken, hours: res.expiresInHours });
      setNewEmail("");
      setNewName("");
      await load();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(u: AdminUser) {
    setErr(null);
    try {
      const res = await reissueInvite(u.id);
      setInvite({ email: u.email, token: res.inviteToken, hours: res.expiresInHours });
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }

  async function toggleActive(u: AdminUser, active: boolean) {
    setErr(null);
    try {
      await setUserActive(u.id, active);
      await load();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }
  useEffect(() => {
    load();
    loadFrameworks();
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
  async function addAssign(userId: number, picked?: string) {
    // Take the picked code directly: when the typeahead fires onPick in the
    // same tick, the state update behind it has not flushed yet.
    const code = (picked ?? addCode).trim();
    if (!code) return;
    setErr(null);
    try {
      await assignControl(userId, code);
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

      {frameworks.length > 0 && (
        <div className="subsection" style={{ marginBottom: 14 }}>
          <div className="section-label">Framework catalogs</div>
          <small className="stub-sub">
            Which standards this organisation is measured against. A catalog being installed is not
            the same as having adopted it — disabled catalogs are excluded from readiness, the SoA
            and the GRCen export.
          </small>
          <div className="worklist" style={{ marginTop: 8 }}>
            {frameworks.map((f) => (
              <div key={f.id} className="adm-row">
                <div className="adm-id">
                  <div className="adm-name">
                    {f.name} {f.version ? <span className="adm-exp">· {f.version}</span> : null}
                  </div>
                  <div className="adm-email">
                    {f.requirements} requirements
                    {f.licence ? ` · ${f.licence}` : ""}
                  </div>
                </div>
                {isAdmin ? (
                  <label className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={f.enabled}
                      onChange={(e) => toggleFramework(f.id, e.target.checked)}
                      aria-label={`Enable ${f.name}`}
                    />{" "}
                    enabled
                  </label>
                ) : (
                  <span className="req-status">{f.enabled ? "enabled" : "not adopted"}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="subsection" style={{ marginBottom: 14 }}>
          <div className="section-label">Add a user</div>
          <div className="row-inline" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              className="adm-add-input"
              placeholder="name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              aria-label="New user name"
            />
            <input
              className="adm-add-input"
              placeholder="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              aria-label="New user email"
            />
            <select className="adm-role" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)} aria-label="New user role">
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <button className="btn" disabled={busy || !newEmail.trim() || !newName.trim()} onClick={addUser}>
              {busy ? "Creating…" : "Create + invite"}
            </button>
          </div>
          <small className="stub-sub">
            The account is created without a password. You get a single-use link to send them.
          </small>
        </div>
      )}

      {invite && (
        <div className="subsection" style={{ marginBottom: 14 }}>
          <div className="section-label">Invite link for {invite.email}</div>
          <code className="invite-token">{`${window.location.origin}/invite#${invite.token}`}</code>
          <small className="stub-sub">
            Shown once — it is not stored anywhere and cannot be shown again. Expires in {invite.hours} hours;
            issue a new one from “reset password” if it lapses.
          </small>
          <div className="row-inline" style={{ marginTop: 8 }}>
            <button
              className="btn"
              onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/invite#${invite.token}`)}
            >
              Copy link
            </button>
            <button className="btn ghost" onClick={() => setInvite(null)}>Dismiss</button>
          </div>
        </div>
      )}

      <div className="worklist">
        {users.map((u) => (
          <div key={u.id} className="adm-row">
            <div className="adm-id">
              <div className="adm-name">
                {u.name}
                {u.deactivatedAt ? <span className="adm-exp"> · deactivated</span> : null}
                {u.expiresAt ? <span className="adm-exp"> · expires {u.expiresAt.slice(0, 10)}</span> : null}
              </div>
              <div className="adm-email">{u.email}</div>
            </div>
            <select className="adm-role" value={u.role} disabled={!isAdmin} onChange={(e) => changeRole(u.id, e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            {isAdmin && (
              <div className="row-inline" style={{ gap: 6 }}>
                <button className="btn ghost" onClick={() => resetPassword(u)} title="Issue a new single-use link">
                  reset password
                </button>
                {u.deactivatedAt ? (
                  <button className="btn ghost" onClick={() => toggleActive(u, true)}>reactivate</button>
                ) : (
                  <button
                    className="btn ghost"
                    onClick={() => toggleActive(u, false)}
                    title="Ends their sessions and revokes their API tokens immediately"
                  >
                    deactivate
                  </button>
                )}
              </div>
            )}
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
                      {/* Was placeholder "01.a" — a code format from a
                          pre-pivot catalog that does not exist in the loaded
                          data, so following the hint returned "unknown control". */}
                      <ControlPicker
                        value={addCode}
                        onChange={setAddCode}
                        onPick={(code) => addAssign(u.id, code)}
                        autoFocus
                        ariaLabel={`Control to assign to ${u.name}`}
                      />
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
      {(me.role === "admin" || me.role === "auditor") && <AuditLogPanel />}
    </div>
  );
}

const RATING_LABEL: Record<string, string> = { fc: "Fully", mc: "Mostly", pc: "Partially", sc: "Somewhat", nc: "Non-compliant" };

export function ReportsPage({ framework, onFramework }: { framework?: string | null; onFramework?: (id: string) => void } = {}) {
  const frameworks = useEnabledFrameworks();
  // Same treatment as Requirements: the chosen framework belongs in the URL, so
  // "the CSF readiness report" is a link rather than a set of instructions.
  const [localFw, setLocalFw] = useState<string>("soc2");
  const fw = framework ?? localFw;
  const setFw = (id: string) => (onFramework ? onFramework(id) : setLocalFw(id));
  useEffect(() => {
    if (frameworks.length && !frameworks.some((f) => f.id === fw)) setFw(frameworks[0].id);
  }, [frameworks, fw]);
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
          <FrameworkTabs value={fw} onChange={setFw} frameworks={frameworks} />
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
            {/* Whether this document reproduces is the first thing an auditor
                needs to know about it, so it goes next to the title rather than
                in a footnote. */}
            {report.meta.basis && (
              <div className={`report-basis b-${report.meta.basis.kind}`}>
                {report.meta.basis.kind === "frozen" && (
                  <>
                    <b>Frozen</b> as at {report.meta.basis.asOf?.slice(0, 10)} — the assessment is closed, so these
                    figures reproduce: {report.meta.basis.requirements} requirements and {report.meta.basis.mappings} mappings
                    recorded at close, with ratings as they stood then.
                  </>
                )}
                {report.meta.basis.kind === "partially-frozen" && (
                  <>
                    <b>Partially frozen</b> as at {report.meta.basis.asOf?.slice(0, 10)} — {report.meta.basis.note}
                  </>
                )}
                {report.meta.basis.kind === "live" && (
                  <>
                    <b>Live</b> — the assessment window is open, so these figures move with the catalog, the
                    crosswalk and every new attestation. Close the period to fix them.
                  </>
                )}
              </div>
            )}
            {report.meta.windowCoverage && report.meta.windowCoverage.total > 0 && (
              <div className="report-basis b-coverage">
                <b>{report.meta.windowCoverage.withinWindow}</b> of {report.meta.windowCoverage.total} current ratings
                were attested inside this window;{" "}
                <b>{report.meta.windowCoverage.carriedIn}</b> carried in from before it. A Type II opinion rests on
                what was assessed during the observation period, so the second number is the one to justify.
              </div>
            )}
            {report.meta.reopened && (
              <div className="report-basis b-reopened">
                <b>Reopened</b> {report.meta.reopened.at?.slice(0, 10)}
                {report.meta.reopened.count > 1 ? ` (${report.meta.reopened.count}×)` : ""}
                {report.meta.reopened.reason ? ` — ${report.meta.reopened.reason}` : ""}
              </div>
            )}
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
  const [catalog, setCatalog] = useState<CatalogExportStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetchIntegrations()
      .then((d) => {
        setConns(d.connectors);
        setCatalog(d.catalog);
      })
      .catch((e) => setErr(String(e.message ?? e)));
  }, []);
  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Connectors · collector health</span>
        <h1 className="h1">Integrations</h1>
      </div>
      {err && <div className="api-banner error">{err}</div>}
      {catalog && (
        <div className="conn-card export-card">
          <div className="conn-top">
            <span className="conn-name">GRCen catalog export</span>
            <span className={`conn-status cs-${catalog.lastExport ? "healthy" : "degraded"}`}>
              {catalog.lastExport ? "exported" : "never"}
            </span>
          </div>
          <div className="conn-stats">
            <div><b>{catalog.frameworks}</b><span>frameworks</span></div>
            <div><b>{catalog.requirements}</b><span>requirements</span></div>
            <div><b>{catalog.controls}</b><span>controls</span></div>
            <div><b>{catalog.satisfies}</b><span>satisfies</span></div>
            <div><b>{catalog.crosswalks}</b><span>crosswalks</span></div>
          </div>
          <div className="conn-foot">
            Read-only projection at <code>GET /api/catalog</code> → <code>grcen sync-catalog</code>
            {catalog.lastExport ? ` · last ${new Date(catalog.lastExport).toLocaleString()}` : " · not yet exported"}
          </div>
        </div>
      )}
      <div className="conn-grid">
        {conns.map((c) => (
          <div key={c.name} className="conn-card">
            <div className="conn-top">
              <span className="conn-name">{c.name}</span>
              {/* A connector that has never run is not healthy — it is unknown.
                  Reporting the absence of failures as a pass is how a dashboard
                  ends up green over nothing. */}
              {c.lastRun ? (
                <span className={`conn-status cs-${c.status}`}>{c.status}</span>
              ) : (
                <span className="conn-status cs-unknown" title="This connector has never run — there is nothing to report on yet">
                  never run
                </span>
              )}
            </div>
            <div className="conn-stats">
              <div><b>{c.checks}</b><span>checks</span></div>
              <div><b>{c.passRate ?? "—"}%</b><span>pass</span></div>
              <div><b>{c.findings}</b><span>findings</span></div>
            </div>
            <div className="conn-foot">
              {c.lastRun ? `${c.coverage} · last ${new Date(c.lastRun).toLocaleDateString()}` : "no collection yet"}
            </div>
          </div>
        ))}
      </div>
      <div className="stub-note" style={{ marginTop: 14, textAlign: "left" }}>
        AWS connectors use assume-role (no stored keys) in production; here they're the simulated collector
        — no cloud credentials are configured, so its findings are generated, not
        collected. Status reflects CheckRun completeness; document sources flag drift.
      </div>
    </div>
  );
}

export function ControlsPage({ onOpenControl }: { onOpenControl?: (code: string) => void }) {
  const [data, setData] = useState<{ categories: { id: string; title: string }[]; controls: LibraryControl[] } | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetchControlsLibrary().then(setData).catch((e) => setErr(String(e.message ?? e)));
  }, []);
  const filtered = (data?.controls ?? []).filter((c) => !q || c.code.includes(q) || c.title.toLowerCase().includes(q.toLowerCase()));
  const baseControls = data ? new Set(data.controls.map((c) => c.objective?.split(" ")[0]).filter(Boolean)).size : 0;
  const eyebrow = data
    ? `CCF · ${data.controls.length} controls → ${data.categories.length} families → ${baseControls} base controls`
    : "CCF · control library";
  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="h1">Controls <span className="frame">{data ? `· ${data.controls.length}` : ""}</span></h1>
      </div>
      <div className="req-toolbar">
        <div className="search" style={{ width: 280 }}>
          <input placeholder="Filter by code or title…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {err && <div className="api-banner error">{err}</div>}
      <div className="worklist">
        <ListState
          loading={!data && !err}
          error={err}
          empty={!!data && filtered.length === 0}
          emptyText={q ? `No controls match “${q}”.` : "No controls loaded."}
        />
        {filtered.map((c) => (
          <div
            key={c.code}
            className={`lib-row ${onOpenControl ? "clickable" : ""}`}
            onClick={onOpenControl ? () => onOpenControl(c.code) : undefined}
            title={onOpenControl ? `Open ${c.code}` : undefined}
          >
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
  const isAdmin = role === "admin";
  const [periods, setPeriods] = useState<Period[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const frameworks = useEnabledFrameworks();
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
  // The status badge used to be a cycle button: one unconfirmed click on a badge
  // reading "active" closed the whole assessment, and closing was irreversible.
  // Worse, it cycled closed -> planning, a transition the server has always
  // refused — so the one click that looked like an undo was the one that errored.
  //
  // Each transition is now its own labelled button, and the consequential ones
  // ask first.
  async function move(p: Period, next: string, reason?: string) {
    try {
      await setPeriodStatus(p.id, next, reason);
      await load();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }
  async function closePeriod(p: Period) {
    const ok = window.confirm(
      `Close "${p.name}"?\n\n` +
        "This ends the assessment: its scope is frozen and it stops being the period " +
        "that scoping and reporting read.\n\n" +
        "It can be reopened afterwards, but only by an admin and only with a reason, " +
        "which is recorded on the period and in the audit log.",
    );
    if (ok) await move(p, "closed");
  }
  async function reopenPeriod(p: Period) {
    const reason = window.prompt(
      `Reopen "${p.name}"?\n\n` +
        "The reopen is recorded on the period and in the audit log, and the close is " +
        "not erased. Why is it being reopened?",
      "",
    );
    if (reason === null) return;
    if (reason.trim().length < 8) {
      setErr("Reopening needs a reason of at least 8 characters — it goes on the permanent record.");
      return;
    }
    await move(p, "active", reason.trim());
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
            {/* nist80053 is the CCF itself — an assessment scoped by baseline
                rather than targeting a compliance framework. The rest come from
                what has been adopted, so a new catalog is selectable without a
                UI change. */}
            <option value="nist80053">NIST 800-53 Rev 5 (baseline only)</option>
            {frameworks.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
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
            <span
              className={`exc-status s-${p.status === "active" ? "approved" : p.status === "closed" ? "rejected" : "pending"}`}
              title={p.reopenedAt ? `Reopened ${p.reopenedAt.slice(0, 10)}: ${p.reopenReason ?? ""}` : undefined}
            >
              {p.status}
              {p.reopenCount ? <span className="reopened-mark" title={`Reopened ${p.reopenCount}×`}> ↺</span> : null}
            </span>
            {canEdit && (
              <span className="period-actions">
                {p.status === "planning" && (
                  <button className="btn small" onClick={() => move(p, "active")}>Activate</button>
                )}
                {p.status !== "closed" && (
                  <button className="btn small" onClick={() => closePeriod(p)}>Close…</button>
                )}
                {p.status === "closed" &&
                  (isAdmin ? (
                    <button className="btn small" onClick={() => reopenPeriod(p)}>Reopen…</button>
                  ) : (
                    <span className="stub-sub" title="Reopening a closed period is an admin action">admin only</span>
                  ))}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
