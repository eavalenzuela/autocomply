// Maturity glyphs — pie-fill circles using SVG arc geometry.
// Five fill states + N/A (slash). Markers (aws/drift/gap) rendered by parent.
import type { GlyphStyle, MaturityGrade, Marker } from "../types";

export function gradeColor(grade: number): string {
  if (grade >= 5) return "var(--m-5)";
  if (grade === 4) return "var(--m-4)";
  if (grade === 3) return "var(--m-3)";
  if (grade === 2) return "var(--m-2)";
  if (grade === 1) return "var(--m-1)";
  return "var(--m-0)";
}

interface GlyphProps {
  grade: MaturityGrade;
  size?: number;
  color?: string;
  style?: GlyphStyle;
}

export function Glyph({ grade, size = 14, color, style = "pie" }: GlyphProps) {
  if (grade === 0) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-label="N/A">
        <circle cx="8" cy="8" r="6" fill="none" stroke={color || "var(--ink-5)"} strokeWidth="1.2" />
        <line x1="3.5" y1="12.5" x2="12.5" y2="3.5" stroke={color || "var(--ink-5)"} strokeWidth="1.2" />
      </svg>
    );
  }

  const fillColor = color || gradeColor(grade);

  if (style === "bars") {
    return (
      <svg width={size + 4} height={size} viewBox="0 0 20 16" aria-label={`grade ${grade}`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <rect
            key={i}
            x={1 + (i - 1) * 3.6}
            y={i <= grade ? 4 : 8}
            width="2.6"
            height={i <= grade ? 9 : 5}
            fill={i <= grade ? fillColor : "var(--line-strong)"}
            rx="0.4"
          />
        ))}
      </svg>
    );
  }

  if (style === "blocks") {
    return (
      <svg width={size + 4} height={size} viewBox="0 0 20 16" aria-label={`grade ${grade}`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <rect key={i} x={1 + (i - 1) * 3.6} y={5} width="3" height="6" fill={i <= grade ? fillColor : "var(--line-strong)"} />
        ))}
      </svg>
    );
  }

  // Default: pie-fill circle
  const cx = 8;
  const cy = 8;
  const r = 5.6;
  const stroke = color || gradeColor(grade);
  const angle = (grade / 5) * 360;
  const a = ((angle - 90) * Math.PI) / 180;
  const x = cx + r * Math.cos(a);
  const y = cy + r * Math.sin(a);
  const largeArc = angle > 180 ? 1 : 0;
  const d =
    grade === 5
      ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} L ${cx} ${cy} Z`
      : `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 ${largeArc} 1 ${x} ${y} Z`;

  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-label={`grade ${grade}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth="1.2" />
      <path d={d} fill={stroke} />
    </svg>
  );
}

interface GlyphCellProps {
  grade: MaturityGrade | null;
  marker?: Marker;
  size?: number;
  style?: GlyphStyle;
}

export function GlyphCell({ grade, marker = null, size = 14, style = "pie" }: GlyphCellProps) {
  if (grade == null) {
    return (
      <span className="glyph-wrap" data-grade="unrated" role="img" aria-label="unrated">
        <span className="glyph-unrated" />
      </span>
    );
  }
  return (
    <span
      className="glyph-wrap"
      data-marker={marker || undefined}
      data-grade={grade}
      role="img"
      aria-label={`grade ${grade}${marker ? " " + marker : ""}`}
    >
      <Glyph grade={grade} size={size} style={style} />
      {marker === "aws" && <span className="glyph-marker" />}
      {marker === "drift" && <span className="glyph-marker" />}
    </span>
  );
}
