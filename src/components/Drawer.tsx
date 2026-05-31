// Drawer — live control detail + attestation. Fetches /api/control/:code,
// shows the maturity ladder, crosswalk, attestation history, and an inline
// attest form that writes back through /api/attest.
import { useEffect, useMemo, useState } from "react";
import type { Control, Domain, GlyphStyle } from "../types";
import { GlyphCell } from "./Glyph";
import { MATURITY_COLS } from "../data";
import { fetchControl, attest, type ControlDetail } from "../api";

const RUNG_SCORE = ["—", "20", "40", "60", "80", "100"];
const RATINGS: { v: "nc" | "sc" | "pc" | "mc" | "fc"; label: string }[] = [
  { v: "nc", label: "NC" },
  { v: "sc", label: "SC" },
  { v: "pc", label: "PC" },
  { v: "mc", label: "MC" },
  { v: "fc", label: "FC" },
];
const DIMS = ["pol", "proc", "impl", "meas", "mang"] as const;

export function Drawer({
  controlId,
  domains,
  onClose,
  onChanged,
  canWrite,
  glyphStyle,
}: {
  controlId: string | null;
  domains: Domain[];
  onClose: () => void;
  onChanged: () => void;
  canWrite: boolean;
  glyphStyle: GlyphStyle;
}) {
  const [detail, setDetail] = useState<ControlDetail | null>(null);
  const [dim, setDim] = useState<(typeof DIMS)[number]>("impl");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const control = useMemo<(Control & { domain: string }) | null>(() => {
    if (!controlId) return null;
    for (const d of domains) {
      const c = (d.controls || []).find((c) => c.id === controlId);
      if (c) return { ...c, domain: `${d.id} · ${d.name}` };
    }
    return null;
  }, [controlId, domains]);

  useEffect(() => {
    setDetail(null);
    setErr(null);
    if (controlId) fetchControl(controlId).then(setDetail).catch((e) => setErr(String(e.message ?? e)));
  }, [controlId]);

  const open = !!controlId;

  async function doAttest(rating: "nc" | "sc" | "pc" | "mc" | "fc") {
    if (!controlId) return;
    setBusy(true);
    setErr(null);
    try {
      await attest({ control: controlId, dimension: dim, rating, justification: `Manual attestation (${dim})` });
      const fresh = await fetchControl(controlId);
      setDetail(fresh);
      onChanged();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={`drawer-backdrop ${open ? "open" : ""}`} onClick={onClose} />
      <aside className={`drawer ${open ? "open" : ""}`}>
        {control && (
          <>
            <div className="drawer-head">
              <div className="drawer-head-top">
                <span className="drawer-id">{control.id}</span>
                <span className="drawer-sub">{control.domain}</span>
                <button className="drawer-close" onClick={onClose} aria-label="Close">
                  <svg width="14" height="14" viewBox="0 0 14 14">
                    <path d="M3 3 L11 11 M11 3 L3 11" stroke="currentColor" strokeWidth="1.4" />
                  </svg>
                </button>
              </div>
              <div className="drawer-title">{control.name}</div>
            </div>

            <div className="drawer-body">
              {err && <div className="api-banner error">{err}</div>}

              {/* Maturity ladder */}
              <div className="section">
                <div className="section-label">Maturity ladder</div>
                <div className="ladder">
                  {control.cells.map((c, i) => (
                    <div key={i} className={`rung ${c.marker === "aws" ? "marker-aws" : ""}`}>
                      <span className="rung-glyph">
                        <GlyphCell grade={c.grade} marker={c.marker} size={18} style={glyphStyle} />
                      </span>
                      <span className="rung-label">{MATURITY_COLS[i].short}</span>
                      <span className="rung-score">{c.grade == null ? "—" : RUNG_SCORE[c.grade]}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Attest (writers only; read-only roles see history only) */}
              {canWrite && (
              <div className="section">
                <div className="section-label">Attest</div>
                <div className="attest-box">
                  <div className="attest-dims">
                    {DIMS.map((d) => (
                      <button key={d} className={`attest-dim ${dim === d ? "on" : ""}`} onClick={() => setDim(d)}>
                        {MATURITY_COLS[DIMS.indexOf(d)].short}
                      </button>
                    ))}
                  </div>
                  <div className="attest-ratings">
                    {RATINGS.map((r) => (
                      <button key={r.v} className="attest-rating" disabled={busy} onClick={() => doAttest(r.v)}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <div className="attest-hint">Sets the {MATURITY_COLS[DIMS.indexOf(dim)].label} rating (appends an attestation).</div>
                </div>
              </div>
              )}

              {/* Crosswalk (live) */}
              {detail && detail.crosswalk.length > 0 && (
                <div className="section">
                  <div className="section-label">Crosswalk ({detail.crosswalk.length})</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {detail.crosswalk.map((c) => (
                      <span key={`${c.framework}-${c.code}`} className="xwalk" style={{ fontSize: 11, padding: "3px 8px" }} title={`${c.relationship} · ${c.confidence}`}>
                        {c.code}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Attestation history (live) */}
              <div className="section">
                <div className="section-label">Attestation history{detail ? ` (${detail.attestations.length})` : ""}</div>
                {detail && detail.attestations.length > 0 ? (
                  <div className="evid-table">
                    {detail.attestations.map((a) => (
                      <div key={a.id} className="evid-row">
                        <span className={`dot ${a.rating === "fc" || a.rating === "mc" ? "ok" : a.rating === "nc" ? "bad" : "warn"}`} />
                        <div>
                          <div className="e-name">
                            {a.dimension.toUpperCase()} → {a.rating.toUpperCase()} {a.marker ? `· ${a.marker}` : ""}
                          </div>
                          <div className="e-meta">{a.justification}</div>
                        </div>
                        <span className="e-status">{a.source}</span>
                        <span className="e-meta">{new Date(a.createdAt).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="drawer-sub">No attestations yet.</div>
                )}
              </div>
            </div>

            <div className="drawer-actions">
              <button className="btn ghost" style={{ marginLeft: "auto" }} onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
