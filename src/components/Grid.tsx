// Maturity grid — the main 5-column matrix.
import { useState, Fragment } from "react";
import type { Cell, Control, Domain, Evidence, GlyphStyle } from "../types";
import { GlyphCell } from "./Glyph";
import { OWNERS, MATURITY_COLS } from "../data";

function Tooltip({ children, label, sub }: { children: React.ReactNode; label: string; sub?: string | null }) {
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setTip({ x: r.left + r.width / 2, y: r.top - 6 });
      }}
      onMouseLeave={() => setTip(null)}
      style={{ display: "inline-flex" }}
    >
      {children}
      {tip && (
        <span className="tip" style={{ left: tip.x, top: tip.y, transform: "translate(-50%, -100%)" }}>
          {sub && <span className="tip-key">{sub}</span>}
          {label}
        </span>
      )}
    </span>
  );
}

function ScoreCell({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <td className="score-cell">
        <span className="num" style={{ color: "var(--ink-4)" }}>—</span>
      </td>
    );
  }
  const cls = value >= 75 ? "ok" : value >= 50 ? "warn" : "bad";
  return (
    <td className={`score-cell ${cls}`}>
      <span className="num">{value}%</span>
      <span className="bar">
        <i style={{ width: `${value}%` }} />
      </span>
    </td>
  );
}

function EvidenceCell({
  evidence,
  gate,
  gateFail,
  isDomain,
}: {
  evidence?: Evidence;
  gate?: number | null;
  gateFail?: boolean;
  isDomain?: boolean;
}) {
  if (isDomain) {
    return (
      <td className="gate-cell">
        {gate != null && (
          <span className={`gate-badge ${gateFail ? "fail" : "pass"}`}>
            <span className="triangle">{gateFail ? "▲" : "✓"}</span>
            <span>GATE {gate.toFixed(1)}</span>
          </span>
        )}
      </td>
    );
  }
  if (!evidence) return <td className="evid-cell" />;
  return (
    <td className="evid-cell">
      {evidence.age && <span className="age">{evidence.age}</span>}
      {evidence.tag && <span className={`tag ${evidence.tag}`}>{evidence.label || evidence.tag}</span>}
    </td>
  );
}

const MARKER_LABEL: Record<string, string> = {
  aws: "AWS-fed · suggested",
  drift: "Doc drifted · re-attest",
  gap: "Coverage gap → NC",
};
const MAT_LABEL = ["N/A", "Policy", "Process", "Implemented", "Measured", "Managed"];

function MaturityCell({ cell, glyphStyle }: { cell?: Cell; glyphStyle: GlyphStyle }) {
  if (!cell) return <td className="mat-cell" />;
  const label = cell.grade == null ? "Unrated" : MAT_LABEL[cell.grade] || "—";
  return (
    <td className="mat-cell">
      <Tooltip label={label} sub={cell.marker ? MARKER_LABEL[cell.marker] : null}>
        <GlyphCell grade={cell.grade} marker={cell.marker} style={glyphStyle} />
      </Tooltip>
    </td>
  );
}

function ControlRow({
  control,
  glyphStyle,
  onSelect,
  selected,
  showOwners,
}: {
  control: Control;
  glyphStyle: GlyphStyle;
  onSelect: (id: string) => void;
  selected: boolean;
  showOwners: boolean;
}) {
  const owner = control.owner ? OWNERS[control.owner] : undefined;
  return (
    <tr className={`row-control ${selected ? "selected" : ""}`} onClick={() => onSelect(control.id)}>
      <td className="col-control">
        <div className="control-cell">
          <span className="ctrl-id">{control.id}</span>
          <span className={`ctrl-name ${control.flag === "coverage-as-nc" ? "scored-nc" : ""}`}>{control.name}</span>
          <span className="ctrl-meta">
            {control.docs > 0 && <span className="docs-note">└ {control.docs} docs</span>}
            {control.crosswalk?.map((c) => (
              <span key={c} className="xwalk">
                {c}
              </span>
            ))}
          </span>
        </div>
      </td>
      {control.cells.map((c, i) => (
        <MaturityCell key={i} cell={c} glyphStyle={glyphStyle} />
      ))}
      <ScoreCell value={control.score} />
      <EvidenceCell evidence={control.evidence} />
      {showOwners && (
        <td className="owner-cell">
          {control.owner && (
            <span className="av" style={{ background: owner?.color }}>
              {control.owner}
            </span>
          )}
        </td>
      )}
    </tr>
  );
}

function DomainRow({
  domain,
  onToggle,
  showOwners,
}: {
  domain: Domain;
  onToggle: (id: string) => void;
  showOwners: boolean;
}) {
  return (
    <tr className="row-domain" onClick={() => onToggle(domain.id)}>
      <td className="col-control">
        <div className="domain-toggle">
          <span className={`caret ${domain.open ? "open" : ""}`}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M3 2 L7 5 L3 8 Z" fill="currentColor" />
            </svg>
          </span>
          <span className="domain-id">{domain.id}</span>
          <span className="domain-name">{domain.name}</span>
          {!domain.open && <span className="domain-meta">({domain.controls.length || domain.controlCount || 0} controls)</span>}
        </div>
      </td>
      <td colSpan={5} />
      <ScoreCell value={domain.score} />
      <EvidenceCell isDomain gate={domain.gate} gateFail={domain.gateFail} />
      {showOwners && (
        <td className="owner-cell">
          {domain.owner && (
            <span className="av" style={{ background: OWNERS[domain.owner]?.color }}>
              {domain.owner}
            </span>
          )}
        </td>
      )}
    </tr>
  );
}

export function Grid({
  domains,
  glyphStyle,
  onToggleDomain,
  onSelectControl,
  selectedId,
  showOwners,
}: {
  domains: Domain[];
  glyphStyle: GlyphStyle;
  onToggleDomain: (id: string) => void;
  onSelectControl: (id: string) => void;
  selectedId: string | null;
  showOwners: boolean;
}) {
  return (
    <div className="grid-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th className="col-control">Control</th>
            {MATURITY_COLS.map((c) => (
              <th key={c.key} className="col-maturity" title={c.label}>
                {c.short}
              </th>
            ))}
            <th className="col-score">Score</th>
            <th className="col-evidence">Freshest evidence</th>
            {showOwners && <th className="col-owner">Owner</th>}
          </tr>
        </thead>
        <tbody>
          {domains.map((d) => (
            <Fragment key={d.id}>
              <DomainRow domain={d} onToggle={onToggleDomain} showOwners={showOwners} />
              {d.open &&
                d.controls.map((c) => (
                  <ControlRow
                    key={c.id}
                    control={c}
                    glyphStyle={glyphStyle}
                    onSelect={onSelectControl}
                    selected={selectedId === c.id}
                    showOwners={showOwners}
                  />
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
