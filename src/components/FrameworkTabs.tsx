// Framework selector, driven by what is actually enabled.
//
// Both places that let you choose a framework hardcoded two buttons, SOC 2 and
// ISO 27001. Enabling CSF 2.0, 800-171 and CIS v8 therefore made them
// completely unreachable: the data was there, the API served them, and the UI
// offered no way to ask. Anything that adds a catalog has to appear here
// automatically or the same thing happens again.
import { useEffect, useState } from "react";
import { fetchFrameworks, type FrameworkInfo } from "../api";

let cache: FrameworkInfo[] | null = null;

export function useEnabledFrameworks(): FrameworkInfo[] {
  const [fws, setFws] = useState<FrameworkInfo[]>(cache ?? []);
  useEffect(() => {
    let alive = true;
    fetchFrameworks()
      .then((d) => {
        cache = d.frameworks.filter((f) => f.enabled);
        if (alive) setFws(cache);
      })
      .catch(() => {
        /* the caller falls back to whatever it already has */
      });
    return () => {
      alive = false;
    };
  }, []);
  return fws;
}

export function FrameworkTabs({
  value,
  onChange,
  frameworks,
}: {
  value: string;
  onChange: (id: string) => void;
  frameworks: FrameworkInfo[];
}) {
  if (frameworks.length === 0) return null;
  return (
    <div className="fw-tabs" role="tablist" aria-label="Framework">
      {frameworks.map((f) => (
        <button
          key={f.id}
          role="tab"
          aria-selected={value === f.id}
          className={value === f.id ? "on" : ""}
          onClick={() => onChange(f.id)}
          title={f.version ? `${f.name} ${f.version}` : f.name}
        >
          {f.name}
        </button>
      ))}
    </div>
  );
}
