// A small history router.
//
// The app had none: `active` was a useState string, so nothing had a URL.
// An auditor could not bookmark a view or paste one into a ticket, Back left
// the application entirely, and — because the Caddyfile serves an SPA fallback
// — GET /admin returned 200 and silently rendered the Control Matrix. A deep
// link landed on the wrong page with no error.
//
// Purpose-built rather than react-router: twelve static sections, one code
// segment and a couple of query parameters do not need a routing tree, and the
// dependency list of a compliance tool is worth keeping at two.
//
// Shape:  /                      -> the default section
//         /matrix                -> a section
//         /matrix/AC-2           -> a section with the control drawer open
//         /requirements?framework=iso27001
//         /matrix?filters=gate-failing,drift

export const SECTIONS = [
  "dashboard",
  "matrix",
  "requirements",
  "soa",
  "periods",
  "worklist",
  "evidence",
  "controls",
  "risks",
  "integrations",
  "reports",
  "admin",
] as const;

export type Section = (typeof SECTIONS)[number];
export const DEFAULT_SECTION: Section = "matrix";

export interface Route {
  /** null when the path names something that is not a section — render a 404. */
  section: Section | null;
  /** Control code from the second path segment, if present. */
  code: string | null;
  filters: string[];
  framework: string | null;
  /** The path as given, for reporting what was not found. */
  path: string;
}

const isSection = (v: string): v is Section => (SECTIONS as readonly string[]).includes(v);

export function parseLocation(pathname: string, search: string): Route {
  const params = new URLSearchParams(search);
  const filters = (params.get("filters") ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  const framework = params.get("framework");

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return { section: DEFAULT_SECTION, code: null, filters, framework, path: pathname };
  }
  const [head, second] = segments;
  if (!isSection(head)) {
    // Deliberately not a redirect to the default: silently rendering something
    // else for an unknown path is exactly the behaviour that made a mistyped
    // deep link look like it worked.
    return { section: null, code: null, filters, framework, path: pathname };
  }
  return {
    section: head,
    code: second ? decodeURIComponent(second) : null,
    filters,
    framework,
    path: pathname,
  };
}

export function buildUrl(opts: {
  section: Section;
  code?: string | null;
  filters?: string[];
  framework?: string | null;
}): string {
  const path = opts.code
    ? `/${opts.section}/${encodeURIComponent(opts.code)}`
    : `/${opts.section}`;
  const params = new URLSearchParams();
  if (opts.filters?.length) params.set("filters", opts.filters.join(","));
  if (opts.framework) params.set("framework", opts.framework);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

const TITLES: Record<Section, string> = {
  dashboard: "Dashboard",
  matrix: "Control Matrix",
  requirements: "Requirements",
  soa: "Statement of Applicability",
  periods: "Assessment periods",
  worklist: "Worklist",
  evidence: "Evidence",
  controls: "Controls",
  risks: "Risks & Exceptions",
  integrations: "Integrations",
  reports: "Reports",
  admin: "Admin",
};

/** Human name for a section — used by the breadcrumb as well as the title. */
export function sectionTitle(section: Section): string {
  return TITLES[section];
}

/** Document title for a route — a browser tab and a bookmark should say where they are. */
export function titleFor(route: Route): string {
  if (!route.section) return "Not found · autocomply";
  const base = TITLES[route.section];
  return route.code ? `${route.code} · ${base} · autocomply` : `${base} · autocomply`;
}
