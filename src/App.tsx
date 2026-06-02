// autocomply — control matrix main view pane.
import { useState, useMemo, useEffect, useCallback } from "react";
import type { Domain, GlyphStyle } from "./types";
import { HEADER } from "./data";
import { fetchMatrix, fetchMe, logout, type MatrixSummary, type CurrentUser } from "./api";
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

function Topbar({ me, onLogout }: { me: CurrentUser; onLogout: () => void }) {
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
        <span>HITRUST</span>
        <span className="sep">/</span>
        <strong>r2 · 2026 cycle</strong>
      </div>
      <div className="topbar-right">
        <span className="pill">⌘K</span>
        <span>
          Period: {HEADER.period.start} → {HEADER.period.end}
        </span>
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

const LENSES = [
  { id: "gate-failing", label: "gate-failing", count: 4 },
  { id: "stale", label: "stale", count: 11 },
  { id: "unmapped", label: "unmapped", count: 5 },
  { id: "aws-pending", label: "aws-pending", count: 12 },
  { id: "drift", label: "drift", count: 3 },
];

function Header({
  filters,
  setFilters,
  summary,
  domains,
}: {
  filters: string[];
  setFilters: React.Dispatch<React.SetStateAction<string[]>>;
  summary: MatrixSummary | null;
  domains: Domain[];
}) {
  const toggle = (id: string) => setFilters((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  return (
    <div className="header">
      <div className="header-top">
        <div className="header-title">
          <span className="eyebrow">Assessment · {HEADER.period.days}d period</span>
          <h1 className="h1">
            {HEADER.framework} <span className="frame">control matrix</span>
          </h1>
        </div>
        <KpiStrip summary={summary} domains={domains} />
      </div>
      <div className="filter-row">
        <span className="filter-label">Lenses</span>
        {LENSES.map((l) => (
          <button key={l.id} className={`chip ${filters.includes(l.id) ? "active" : ""}`} onClick={() => toggle(l.id)}>
            {l.label}
            <span className="count">{l.count}</span>
          </button>
        ))}
        <span className="chip-spacer" />
        <div className="search">
          <svg width="12" height="12" viewBox="0 0 12 12" style={{ color: "var(--ink-4)" }}>
            <circle cx="5" cy="5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M7.3 7.3 L10 10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <input placeholder="Search controls, evidence, owners…" />
          <kbd>⌘ K</kbd>
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

function FootRail({ visibleCount, totalCount, selectedId }: { visibleCount: number; totalCount: number; selectedId: string | null }) {
  return (
    <div className="foot-rail">
      <span>
        {visibleCount} of {totalCount} controls
      </span>
      <span className="sep">·</span>
      <span>auto-sync 2m ago</span>
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
        <span>← → expand · ⏎ open · ⌘E export</span>
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

  useEffect(() => {
    loadMatrix();
  }, [loadMatrix]);

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

  const visible = useMemo<Domain[]>(() => {
    if (filters.length === 0) return domains;
    return domains
      .map((d) => {
        let controls = d.controls;
        if (filters.includes("stale"))
          controls = controls.filter((c) => c.evidence?.tag === "drift" || (c.evidence?.age != null && parseInt(c.evidence.age) > 5));
        if (filters.includes("unmapped")) controls = controls.filter((c) => (c.crosswalk || []).length < 2);
        if (filters.includes("drift")) controls = controls.filter((c) => c.evidence?.tag === "drift");
        if (filters.includes("aws-pending")) controls = controls.filter((c) => c.cells.some((x) => x.marker === "aws"));
        if (filters.includes("gate-failing") && !d.gateFail) return { ...d, controls: [], hidden: true };
        return { ...d, controls };
      })
      .filter((d) => !d.hidden);
  }, [domains, filters]);

  const { totalCount, visibleCount } = useMemo(() => {
    const total = summary?.controlsTotal ?? domains.reduce((s, d) => s + (d.controls.length || d.controlCount || 0), 0);
    const vis = visible.reduce((s, d) => s + (d.open ? d.controls.length : d.controls.length || d.controlCount || 0), 0);
    return { totalCount: total, visibleCount: vis };
  }, [visible, summary, domains]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!authChecked) return null;
  if (!me) return <LoginPage onLogin={setMe} />;

  const navItem = NAV.find((n) => n.key === active);
  const handleLogout = async () => {
    await logout();
    setMe(null);
  };

  return (
    <div className="app-shell">
      <Topbar me={me} onLogout={handleLogout} />
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
              <Header filters={filters} setFilters={setFilters} summary={summary} domains={domains} />
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
                <FootRail visibleCount={visibleCount} totalCount={totalCount} selectedId={selectedId} />
              </main>
            </>
          )}
          {active === "dashboard" && <DashboardPage onNav={setActive} />}
          {active === "worklist" && <WorklistPage />}
          {active === "evidence" && <EvidencePage />}
          {active === "risks" && <ExceptionsPage role={me.role} />}
          {active === "requirements" && <RequirementsPage />}
          {active === "reports" && <ReportsPage />}
          {active === "integrations" && <IntegrationsPage />}
          {active === "controls" && <ControlsPage />}
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
