// autocomply — control matrix main view pane.
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import type { Domain, GlyphStyle } from "./types";
import { fetchMatrix, fetchMe, logout, type MatrixSummary, type CurrentUser, type AssessmentPeriodInfo } from "./api";
import { GlyphCell } from "./components/Glyph";
import { Grid } from "./components/Grid";
import { Drawer } from "./components/Drawer";
import { TweaksPanel, useTweaks } from "./components/Tweaks";
import { LoginPage } from "./components/auth";
import { StepUpGate } from "./components/StepUp";
import { Sidebar, StubPage, WorklistPage, EvidencePage, ExceptionsPage, RequirementsPage, DashboardPage, AdminPage, ReportsPage, IntegrationsPage, ControlsPage, PeriodsPage, NAV } from "./components/shell";

function initials(name: string) {
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const ACCENT_OPTIONS: Record<string, [string, string, string, string]> = {
  indigo: ["oklch(0.48 0.10 268)", "oklch(0.62 0.12 268)", "oklch(0.92 0.03 268)", "oklch(0.96 0.015 268)"],
  rust: ["oklch(0.52 0.13 40)", "oklch(0.64 0.15 40)", "oklch(0.92 0.04 40)", "oklch(0.96 0.02 40)"],
  pine: ["oklch(0.45 0.10 175)", "oklch(0.58 0.12 175)", "oklch(0.92 0.03 175)", "oklch(0.96 0.015 175)"],
  graphite: ["oklch(0.32 0.01 270)", "oklch(0.45 0.01 270)", "oklch(0.88 0.005 270)", "oklch(0.95 0.005 270)"],
};

function applyAccent(name: string) {
  const v = ACCENT_OPTIONS[name] || ACCENT_OPTIONS.indigo;
  const r = document.documentElement.style;
  r.setProperty("--accent", v[0]);
  r.setProperty("--accent-2", v[1]);
  r.setProperty("--accent-3", v[2]);
  r.setProperty("--accent-bg", v[3]);
}

function Topbar({ me, onLogout, period }: { me: CurrentUser; onLogout: () => void; period: AssessmentPeriodInfo | null }) {
  const cycle = period ? `${period.tier ? cap(period.tier) + " · " : ""}${period.start.slice(0, 4)} cycle` : "no active period";
  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-mark" />
        <span className="brand-name">
          autocomply<span> / control center</span>
        </span>
      </div>
      <div className="crumbs">
        <span>Programs</span>
        <span className="sep">/</span>
        <span>{period?.frameworkLabel ?? "NIST 800-53"}</span>
        <span className="sep">/</span>
        <strong>{cycle}</strong>
      </div>
      <div className="topbar-right">
        <span className="pill">⌘K</span>
        <span>{period ? `Period: ${period.start} → ${period.end}` : "No active period"}</span>
        <span className="user-chip" title={me.email}>
          <span className="avatar">{initials(me.name)}</span>
          <span className="user-meta">
            <span className="user-name">{me.name}</span>
            <span className="user-role">{me.role.replace("_", " ")}</span>
          </span>
        </span>
        <button className="btn ghost logout-btn" onClick={onLogout}>Sign out</button>
      </div>
    </div>
  );
}

function KpiStrip({ summary, domains }: { summary: MatrixSummary | null; domains: Domain[] }) {
  // P0/P1: real totals where we have them; score-derived KPIs show "—" until
  // enough is attested (full per-domain scoring is Phase 4).
  const scored = domains.map((d) => d.score).filter((x): x is number => x != null);
  const overall = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null;
  const gatesFailing = domains.filter((d) => d.gateFail).length;
  return (
    <div className="kpi-strip">
      <div className="kpi">
        <span className="kpi-label">Overall</span>
        <span className="kpi-value">
          {overall ?? "—"}
          <span className="unit">%</span>
        </span>
        <span className="kpi-delta">{scored.length}/{domains.length} domains scored</span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Gates failing</span>
        <span className="kpi-value">
          {scored.length ? gatesFailing : "—"}
          <span className="unit">/{domains.length}</span>
        </span>
        <span className="kpi-delta">categories</span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Controls</span>
        <span className="kpi-value">{summary?.controlsTotal ?? "—"}</span>
        <span className="kpi-delta">{summary?.categories ?? "—"} categories</span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Crosswalk links</span>
        <span className="kpi-value">{summary?.mappingLinks ?? "—"}</span>
        <span className="kpi-delta">{(summary?.frameworks ?? []).join(" · ") || "—"}</span>
      </div>
    </div>
  );
}

const LENS_DEFS: { id: string; label: string }[] = [
  { id: "gate-failing", label: "gate-failing" },
  { id: "aws-pending", label: "aws-pending" },
  { id: "coverage-gap", label: "coverage-gap" },
  { id: "drift", label: "drift" },
  { id: "unmapped", label: "unmapped" },
];

function Header({
  filters,
  setFilters,
  summary,
  domains,
  period,
  lensCounts,
  query,
  setQuery,
  searchRef,
}: {
  filters: string[];
  setFilters: React.Dispatch<React.SetStateAction<string[]>>;
  summary: MatrixSummary | null;
  domains: Domain[];
  period: AssessmentPeriodInfo | null;
  lensCounts: Record<string, number>;
  query: string;
  setQuery: (v: string) => void;
  searchRef: React.RefObject<HTMLInputElement>;
}) {
  const toggle = (id: string) => setFilters((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  return (
    <div className="header">
      <div className="header-top">
        <div className="header-title">
          <span className="eyebrow">Assessment · {period ? `${period.days}d period` : "no active period"}</span>
          <h1 className="h1">
            {period?.frameworkLabel ?? "NIST 800-53"}{" "}
            <span className="frame">{period?.tier ? `${cap(period.tier)} control matrix` : "control matrix"}</span>
          </h1>
        </div>
        <KpiStrip summary={summary} domains={domains} />
      </div>
      <div className="filter-row">
        <span className="filter-label">Lenses</span>
        {LENS_DEFS.map((l) => (
          <button key={l.id} className={`chip ${filters.includes(l.id) ? "active" : ""}`} onClick={() => toggle(l.id)}>
            {l.label}
            <span className="count">{lensCounts[l.id] ?? 0}</span>
          </button>
        ))}
        <span className="chip-spacer" />
        <div className="search">
          <svg width="12" height="12" viewBox="0 0 12 12" style={{ color: "var(--ink-4)" }}>
            <circle cx="5" cy="5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M7.3 7.3 L10 10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search controls by code, name, or crosswalk…"
          />
          {query ? (
            <button className="search-clear" onClick={() => setQuery("")} aria-label="Clear search">×</button>
          ) : (
            <kbd>⌘ K</kbd>
          )}
        </div>
      </div>
    </div>
  );
}

function Legend({ glyphStyle }: { glyphStyle: GlyphStyle }) {
  return (
    <div className="legend">
      <div className="legend-group">
        <span className="legend-label">Maturity</span>
        {([1, 2, 3, 4, 5] as const).map((g) => (
          <span key={g} className="legend-item">
            <GlyphCell grade={g} size={12} style={glyphStyle} />
            {["Pol", "Proc", "Impl", "Meas", "Mang"][g - 1]}
          </span>
        ))}
        <span className="legend-item">
          <GlyphCell grade={0} size={12} style={glyphStyle} /> N/A
        </span>
      </div>
      <div className="legend-divider" />
      <div className="legend-group">
        <span className="legend-label">Markers</span>
        <span className="legend-item">
          <GlyphCell grade={3} marker="aws" size={12} style={glyphStyle} /> AWS-fed (unconfirmed)
        </span>
        <span className="legend-item">
          <GlyphCell grade={3} marker="gap" size={12} style={glyphStyle} /> coverage gap → NC
        </span>
        <span className="legend-item">
          <GlyphCell grade={3} marker="drift" size={12} style={glyphStyle} /> doc drift
        </span>
      </div>
    </div>
  );
}

function FootRail({ visibleCount, totalCount, selectedId, filtered }: { visibleCount: number; totalCount: number; selectedId: string | null; filtered: boolean }) {
  return (
    <div className="foot-rail">
      <span>
        {visibleCount} of {totalCount} controls
      </span>
      {filtered && (
        <>
          <span className="sep">·</span>
          <span>filtered</span>
        </>
      )}
      <span className="sep">·</span>
      <span>
        {selectedId ? (
          <>
            selected: <strong style={{ color: "var(--ink)" }}>{selectedId}</strong>
          </>
        ) : (
          "click a row to inspect"
        )}
      </span>
      <span className="right">
        <span>⌘K search · Esc close</span>
      </span>
    </div>
  );
}

export default function App() {
  const [t, setTweak] = useTweaks();
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [filters, setFilters] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [summary, setSummary] = useState<MatrixSummary | null>(null);
  const [load, setLoad] = useState<{ state: "loading" | "ok" | "error"; msg?: string }>({ state: "loading" });
  const [active, setActive] = useState("matrix");
  const [stepupMsg, setStepupMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const loadMatrix = useCallback(() => {
    fetchMatrix()
      .then((r) => {
        // preserve which domains the user has expanded across refreshes
        setDomains((prev) => {
          const openById = new Map(prev.map((d) => [d.id, d.open]));
          return r.domains.map((d) => ({ ...d, open: openById.get(d.id) ?? d.open }));
        });
        setSummary(r.summary);
        setLoad({ state: "ok" });
      })
      .catch((e) => setLoad({ state: "error", msg: String(e.message ?? e) }));
  }, []);

  // Load the matrix only once we have a logged-in user. Doing it on bare mount
  // (before auth) fetched /api/matrix anonymously → 401, and it was never retried
  // after login, leaving the matrix + drawer permanently stuck on an error.
  useEffect(() => {
    if (me) loadMatrix();
  }, [me, loadMatrix]);

  useEffect(() => {
    fetchMe().then((u) => {
      setMe(u);
      setAuthChecked(true);
    });
  }, []);

  // Feedback after an SSO step-up round-trip (?stepup=ok|mismatch|expired).
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("stepup");
    if (!v) return;
    const MSG: Record<string, { text: string; bad: boolean }> = {
      ok: { text: "Re-authenticated — you can repeat the action.", bad: false },
      mismatch: { text: "Re-authentication was for a different account; not applied.", bad: true },
      expired: { text: "Your session expired during re-authentication. Sign in again.", bad: true },
    };
    setStepupMsg(MSG[v] ?? null);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = t.theme;
    document.body.classList.toggle("dense", t.density === "dense");
    applyAccent(t.accent);
  }, [t.theme, t.density, t.accent]);

  const toggleDomain = (id: string) => {
    setDomains((ds) => ds.map((d) => (d.id === id ? { ...d, open: !d.open } : d)));
  };

  // Real lens counts derived from the loaded matrix (every control ships in the
  // payload, so these are accurate — no more hardcoded placeholder numbers).
  const lensCounts = useMemo(() => {
    const c: Record<string, number> = { "gate-failing": 0, "aws-pending": 0, "coverage-gap": 0, drift: 0, unmapped: 0 };
    for (const d of domains) {
      if (d.gateFail) c["gate-failing"]++;
      for (const ctrl of d.controls) {
        if (ctrl.cells.some((x) => x.marker === "aws")) c["aws-pending"]++;
        if (ctrl.cells.some((x) => x.marker === "gap")) c["coverage-gap"]++;
        if (ctrl.cells.some((x) => x.marker === "drift")) c.drift++;
        if ((ctrl.crosswalk || []).length === 0) c.unmapped++;
      }
    }
    return c;
  }, [domains]);

  const isFiltered = filters.length > 0 || query.trim().length > 0;

  const visible = useMemo<Domain[]>(() => {
    const q = query.trim().toLowerCase();
    const controlFilters = filters.filter((f) => f !== "gate-failing");
    const controlFilterActive = q.length > 0 || controlFilters.length > 0;
    if (!isFiltered) return domains;
    return domains
      .map((d) => {
        if (filters.includes("gate-failing") && !d.gateFail) return { ...d, hidden: true };
        let controls = d.controls;
        if (q)
          controls = controls.filter(
            (c) =>
              c.id.toLowerCase().includes(q) ||
              c.name.toLowerCase().includes(q) ||
              (c.crosswalk || []).some((x) => x.toLowerCase().includes(q)),
          );
        if (filters.includes("drift")) controls = controls.filter((c) => c.cells.some((x) => x.marker === "drift"));
        if (filters.includes("aws-pending")) controls = controls.filter((c) => c.cells.some((x) => x.marker === "aws"));
        if (filters.includes("coverage-gap")) controls = controls.filter((c) => c.cells.some((x) => x.marker === "gap"));
        if (filters.includes("unmapped")) controls = controls.filter((c) => (c.crosswalk || []).length === 0);
        // When a control-level filter/search is active, hide empty domains and
        // auto-expand the ones with matches so results are immediately visible.
        if (controlFilterActive && controls.length === 0) return { ...d, hidden: true };
        return { ...d, controls, open: controlFilterActive ? true : d.open };
      })
      .filter((d) => !d.hidden);
  }, [domains, filters, query, isFiltered]);

  const { totalCount, visibleCount } = useMemo(() => {
    const total = summary?.controlsTotal ?? domains.reduce((s, d) => s + (d.controls.length || d.controlCount || 0), 0);
    const vis = visible.reduce((s, d) => s + (d.open ? d.controls.length : d.controls.length || d.controlCount || 0), 0);
    return { totalCount: total, visibleCount: vis };
  }, [visible, summary, domains]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setActive("matrix");
        requestAnimationFrame(() => searchRef.current?.focus());
      } else if (e.key === "Escape") {
        if (document.activeElement === searchRef.current && query) setQuery("");
        else setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [query]);

  if (!authChecked) return null;
  if (!me) return <LoginPage onLogin={setMe} />;

  const navItem = NAV.find((n) => n.key === active);
  const handleLogout = async () => {
    await logout();
    setMe(null);
  };

  return (
    <div className="app-shell">
      <Topbar me={me} onLogout={handleLogout} period={summary?.period ?? null} />
      <div className="shell-body">
        <Sidebar active={active} onNav={setActive} />
        <div className="content">
          {stepupMsg && (
            <div className={`api-banner ${stepupMsg.bad ? "error" : ""}`} onClick={() => setStepupMsg(null)}>
              {stepupMsg.text}
            </div>
          )}
          {active === "matrix" && (
            <>
              <Header
                filters={filters}
                setFilters={setFilters}
                summary={summary}
                domains={domains}
                period={summary?.period ?? null}
                lensCounts={lensCounts}
                query={query}
                setQuery={setQuery}
                searchRef={searchRef}
              />
              <main>
                <Legend glyphStyle={t.glyphStyle} />
                {load.state === "error" && (
                  <div className="api-banner error">
                    API unreachable ({load.msg}). Start it with <code>docker compose up -d</code>, then <code>npm run dev:all</code>.
                  </div>
                )}
                {load.state === "loading" && <div className="api-banner">Loading control matrix…</div>}
                <Grid
                  domains={visible}
                  glyphStyle={t.glyphStyle}
                  onToggleDomain={toggleDomain}
                  onSelectControl={setSelectedId}
                  selectedId={selectedId}
                  showOwners={t.showOwners}
                />
                <FootRail visibleCount={visibleCount} totalCount={totalCount} selectedId={selectedId} filtered={isFiltered} />
              </main>
            </>
          )}
          {active === "dashboard" && <DashboardPage onNav={setActive} />}
          {active === "worklist" && <WorklistPage onOpenControl={setSelectedId} />}
          {active === "evidence" && <EvidencePage onOpenControl={setSelectedId} />}
          {active === "risks" && <ExceptionsPage role={me.role} />}
          {active === "requirements" && <RequirementsPage />}
          {active === "reports" && <ReportsPage />}
          {active === "integrations" && <IntegrationsPage />}
          {active === "controls" && <ControlsPage onOpenControl={setSelectedId} />}
          {active === "periods" && <PeriodsPage role={me.role} />}
          {active === "admin" && <AdminPage me={me} />}
          {active !== "matrix" &&
            !["dashboard", "worklist", "evidence", "risks", "requirements", "reports", "integrations", "controls", "periods", "admin"].includes(active) && (
              <StubPage title={navItem?.label ?? active} phase={navItem?.phase} />
            )}
        </div>
      </div>
      <Drawer
        controlId={selectedId}
        domains={domains}
        onClose={() => setSelectedId(null)}
        onChanged={loadMatrix}
        canWrite={["admin", "compliance_manager", "control_owner"].includes(me.role)}
        glyphStyle={t.glyphStyle}
      />
      <TweaksPanel t={t} setTweak={setTweak} />
      <StepUpGate me={me} />
    </div>
  );
}
