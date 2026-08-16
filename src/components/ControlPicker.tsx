// Typeahead for control codes.
//
// Both places that took a control used a bare text input, and the assignment
// one carried the placeholder "01.a" — a code format from a pre-pivot catalog
// that does not exist in the loaded data, so following the hint produced
// "unknown control". Asking someone to recall an exact code out of 1,196 was
// never reasonable; asking them to recall one in a format that no longer exists
// is a trap.
//
// The catalog is fetched once per session and shared: 1,196 rows is ~190KB, and
// paying that per picker mount would be careless.
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchControlsLibrary, type LibraryControl } from "../api";

let cache: LibraryControl[] | null = null;
let inFlight: Promise<LibraryControl[]> | null = null;

async function loadControls(): Promise<LibraryControl[]> {
  if (cache) return cache;
  if (!inFlight) {
    inFlight = fetchControlsLibrary()
      .then((d) => {
        cache = d.controls;
        return cache;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}


/**
 * Filter and rank controls for a query. Exported and pure so the ranking can be
 * tested: "type AC-2, get AC-2 first" is the whole promise of a typeahead, and
 * it is easy to break silently with a sort tweak.
 */
export function matchControls(controls: LibraryControl[], query: string, limit = 40): LibraryControl[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: LibraryControl[] = [];
  for (const c of controls) {
    const code = c.code.toLowerCase();
    if (code.includes(q) || c.title.toLowerCase().includes(q)) out.push(c);
    if (out.length >= limit) break; // a dropdown is not a list view
  }
  return out.sort((a, b) => {
    const ac = a.code.toLowerCase();
    const bc = b.code.toLowerCase();
    // Exact code, then code prefix, then everything else. A person typing a
    // code wants that code, not the first alphabetical thing containing it.
    const rank = (code: string) => (code === q ? 0 : code.startsWith(q) ? 1 : 2);
    return rank(ac) - rank(bc) || ac.localeCompare(bc);
  });
}

export function ControlPicker({
  value,
  onChange,
  onPick,
  placeholder = "control code or name",
  autoFocus,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Fired when a suggestion is chosen — the caller usually submits on this. */
  onPick?: (code: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  const [controls, setControls] = useState<LibraryControl[]>(cache ?? []);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    loadControls()
      .then((cs) => alive && setControls(cs))
      .catch(() => {
        /* the field still works as free text if the catalog cannot load */
      });
    return () => {
      alive = false;
    };
  }, []);

  const matches = useMemo(() => matchControls(controls, value), [value, controls]);

  // Close when focus leaves the whole widget, not just the input, so clicking a
  // suggestion still registers.
  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const choose = (c: LibraryControl) => {
    onChange(c.code);
    setOpen(false);
    onPick?.(c.code);
  };

  const listId = "control-picker-list";

  return (
    <div className="ctrl-picker" ref={boxRef}>
      <input
        className="adm-add-input"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel ?? "Control"}
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[highlight] ? `cp-${matches[highlight].code}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || matches.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => (h + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => (h - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter") {
            // Enter picks the highlighted suggestion rather than submitting the
            // half-typed string underneath it.
            e.preventDefault();
            choose(matches[highlight]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 && (
        <ul className="ctrl-picker-list" id={listId} role="listbox">
          {matches.slice(0, 12).map((c, i) => (
            <li
              key={c.code}
              id={`cp-${c.code}`}
              role="option"
              aria-selected={i === highlight}
              className={`ctrl-picker-opt ${i === highlight ? "on" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus so onPick can submit
                choose(c);
              }}
            >
              <span className="cp-code">{c.code}</span>
              <span className="cp-title">{c.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
