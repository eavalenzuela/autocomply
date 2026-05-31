// Compact tweaks panel — theme / accent / density / glyph style.
// A design-iteration affordance (carried over from the prototype), not a
// product feature. Keep or drop freely.
import { useEffect, useState } from "react";
import type { Tweaks as TweaksState } from "../types";

const STORAGE_KEY = "autocomply.tweaks";

export const TWEAK_DEFAULTS: TweaksState = {
  theme: "light",
  density: "comfortable",
  glyphStyle: "pie",
  showOwners: true,
  accent: "indigo",
};

export function useTweaks(): [TweaksState, <K extends keyof TweaksState>(k: K, v: TweaksState[K]) => void] {
  const [t, setT] = useState<TweaksState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? { ...TWEAK_DEFAULTS, ...JSON.parse(saved) } : TWEAK_DEFAULTS;
    } catch {
      return TWEAK_DEFAULTS;
    }
  });
  const setTweak = <K extends keyof TweaksState>(k: K, v: TweaksState[K]) => {
    setT((prev) => {
      const next = { ...prev, [k]: v };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  return [t, setTweak];
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="tweak-row">
      <span className="tweak-label">{label}</span>
      <div className="tweak-control">{children}</div>
    </div>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="tweak-seg">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TweaksPanel({
  t,
  setTweak,
}: {
  t: TweaksState;
  setTweak: <K extends keyof TweaksState>(k: K, v: TweaksState[K]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tweaks ${open ? "open" : ""}`}>
      <button className="tweaks-toggle" onClick={() => setOpen((o) => !o)} aria-label="Tweaks">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      {open && (
        <div className="tweaks-body">
          <div className="tweaks-title">Tweaks</div>
          <Row label="Theme">
            <Seg value={t.theme} onChange={(v) => setTweak("theme", v)} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
          </Row>
          <Row label="Accent">
            <Seg
              value={t.accent}
              onChange={(v) => setTweak("accent", v)}
              options={[
                { value: "indigo", label: "Indigo" },
                { value: "rust", label: "Rust" },
                { value: "pine", label: "Pine" },
                { value: "graphite", label: "Mono" },
              ]}
            />
          </Row>
          <Row label="Density">
            <Seg value={t.density} onChange={(v) => setTweak("density", v)} options={[{ value: "comfortable", label: "Comfy" }, { value: "dense", label: "Dense" }]} />
          </Row>
          <Row label="Glyph">
            <Seg
              value={t.glyphStyle}
              onChange={(v) => setTweak("glyphStyle", v)}
              options={[
                { value: "pie", label: "Pie" },
                { value: "bars", label: "Bars" },
                { value: "blocks", label: "Mosaic" },
              ]}
            />
          </Row>
          <Row label="Owners">
            <Seg
              value={t.showOwners ? "on" : "off"}
              onChange={(v) => setTweak("showOwners", v === "on")}
              options={[{ value: "on", label: "Show" }, { value: "off", label: "Hide" }]}
            />
          </Row>
        </div>
      )}
    </div>
  );
}
