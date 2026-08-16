// Drawer — live control detail + attestation. Fetches /api/control/:code,
// shows the maturity ladder, crosswalk, evidence, attestation history, an inline
// attest form that writes back through /api/attest, and a risk-acceptance
// request form (POST /api/exception).
import { useEffect, useMemo, useRef, useState } from "react";
import type { Control, Domain, GlyphStyle } from "../types";
import { GlyphCell } from "./Glyph";
import { MATURITY_COLS } from "../data";
import { fetchControl, attest, requestException, type ControlDetail } from "../api";

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
  const [just, setJust] = useState("");
  // Risk-acceptance request form state (collapsed until opened).
  const [excOpen, setExcOpen] = useState(false);
  const [excReason, setExcReason] = useState("");
  const [excExpires, setExcExpires] = useState("");
  const [excMsg, setExcMsg] = useState<string | null>(null);

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
    setJust("");
    setExcOpen(false);
    setExcReason("");
    setExcExpires("");
    setExcMsg(null);
    if (controlId) fetchControl(controlId).then(setDetail).catch((e) => setErr(String(e.message ?? e)));
  }, [controlId]);

  const open = !!controlId;
  const panelRef = useRef<HTMLElement | null>(null);
  // Where focus was before the drawer opened, so it can be handed back. A
  // dialog that dumps focus at the top of the document on close makes a
  // keyboard user retrace their whole path to get back to the row they opened.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      // Move focus into the panel so the next Tab stays inside it.
      requestAnimationFrame(() => {
        const target = panelRef.current?.querySelector<HTMLElement>(".drawer-close");
        target?.focus();
      });
    } else {
      returnFocusRef.current?.focus?.();
      returnFocusRef.current = null;
    }
  }, [open]);

  async function doAttest(rating: "nc" | "sc" | "pc" | "mc" | "fc") {
    if (!controlId) return;
    setBusy(true);
    setErr(null);
    try {
      // The justification is the audit trail — free text from the attester, not a
      // canned string (empty stays empty rather than pretending there's a reason).
      await attest({ control: controlId, dimension: dim, rating, justification: just.trim() || undefined });
      setJust("");
      const fresh = await fetchControl(controlId);
      setDetail(fresh);
      onChanged();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function doRequestException() {
    if (!controlId || !excReason.trim()) return;
    setBusy(true);
    setErr(null);
    setExcMsg(null);
    try {
      await requestException({ control: controlId, reason: excReason.trim(), expiresAt: excExpires || undefined });
      setExcReason("");
      setExcExpires("");
      setExcOpen(false);
      setExcMsg("Exception requested — pending approval (see Risks & Exceptions).");
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={`drawer-backdrop ${open ? "open" : ""}`} onClick={onClose} />
      {/* A dialog needs to announce itself, keep focus inside while it is open,
          and hand focus back where it came from on close. Without that, a
          screen reader user is not told anything opened and a keyboard user
          tabs straight out of it into the page behind. */}
      <aside
        ref={panelRef}
        className={`drawer ${open ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={control ? `${control.id} — ${control.name}` : "Control detail"}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
            return;
          }
          if (e.key !== "Tab" || !panelRef.current) return;
          const focusable = panelRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
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
                  <input
                    className="login-input attest-just"
                    value={just}
                    onChange={(e) => setJust(e.target.value)}
                    placeholder="Justification — why this rating? (recorded in the audit trail)"
                  />
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

              {/* Risk acceptance (writers only) — files a pending exception for this control */}
              {canWrite && (
                <div className="section">
                  <div className="section-label">Risk acceptance</div>
                  {excMsg && <div className="api-banner">{excMsg}</div>}
                  {excOpen ? (
                    <div className="attest-box">
                      <input
                        className="login-input attest-just"
                        value={excReason}
                        onChange={(e) => setExcReason(e.target.value)}
                        placeholder="Reason — why is this risk acceptable?"
                        autoFocus
                      />
                      <label className="exc-exp-label">
                        expires
                        <input className="login-input exc-exp-date" type="date" value={excExpires} onChange={(e) => setExcExpires(e.target.value)} />
                        <span className="attest-hint" style={{ margin: 0 }}>(optional)</span>
                      </label>
                      <div className="stepup-actions" style={{ marginTop: 8 }}>
                        <button className="btn ghost" disabled={busy} onClick={() => setExcOpen(false)}>Cancel</button>
                        <button className="btn primary" disabled={busy || !excReason.trim()} onClick={doRequestException}>
                          Request exception
                        </button>
                      </div>
                      <div className="attest-hint">Pending until a different approver decides it (separation of duties).</div>
                    </div>
                  ) : (
                    <button className="btn" onClick={() => { setExcOpen(true); setExcMsg(null); }}>+ Request exception</button>
                  )}
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

              {/* Evidence (live) — the endpoint has always shipped these rows; now they render */}
              {detail && detail.evidence.length > 0 && (
                <div className="section">
                  <div className="section-label">Evidence ({detail.evidence.length})</div>
                  <div className="evid-table">
                    {detail.evidence.map((e) => (
                      <div key={e.id} className={`evid-row ${e.drifted ? "warn" : "ok"}`}>
                        <span className="dot" />
                        <div>
                          <div className="e-name">
                            {e.liveUrl ? (
                              <a href={e.liveUrl} target="_blank" rel="noreferrer">{e.title}</a>
                            ) : (
                              e.title
                            )}{" "}
                            {e.drifted && <span className="tag drift">drift</span>}
                          </div>
                          <div className="e-meta" title={e.contentHash ?? ""}>
                            {e.kind ?? e.sourceType} · {e.dimension} · {e.contentHash?.slice(0, 10) ?? "—"}
                          </div>
                        </div>
                        <span className="e-status">{e.sourceType}</span>
                        <span className="e-meta">{new Date(e.collectedAt).toLocaleDateString()}</span>
                      </div>
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
                      // status class on the row — .evid-row.ok .dot is what the CSS colors
                      <div key={a.id} className={`evid-row ${a.rating === "fc" || a.rating === "mc" ? "ok" : a.rating === "nc" ? "bad" : "warn"}`}>
                        <span className="dot" />
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
