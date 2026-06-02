// autocomply — GRCen catalog export (producer side).
//
// Projects autocomply's system-of-record (CCF controls + framework requirements
// + crosswalk mappings) into the read-only catalog document GRCen ingests via
// `grcen sync-catalog`. The shape + rules are the contract in GRCEN_CATALOG_EXPORT.md
// and contracts/grcen_catalog_export.schema.json.
//
// Read-only projection: this never mutates autocomply state.
import { asc, eq } from "drizzle-orm";
import { db } from "./db/index";
import * as s from "./db/schema";

export const CATALOG_VERSION = "1";

// SOC 2 TSC category (data/frameworks/soc2-tsc.yaml `category`) → display label.
const SOC2_CATEGORY_LABEL: Record<string, string> = {
  security: "Common Criteria",
  availability: "Availability",
  confidentiality: "Confidentiality",
  processing_integrity: "Processing Integrity",
  privacy: "Privacy",
};

// ISO 27001 Annex A theme (extra.theme) → display label.
const ANNEXA_THEME_LABEL: Record<string, string> = {
  organizational: "Annex A — Organizational",
  people: "Annex A — People",
  physical: "Annex A — Physical",
  technological: "Annex A — Technological",
};

// Stable, globally-unique requirement ref: namespaced with the framework slug
// so two frameworks' "6.1" can't collide (contract rule 2).
const requirementRef = (frameworkId: string, code: string) => `${frameworkId}:${code}`;

function requirementCategory(kind: string, extra: Record<string, unknown>): string | undefined {
  if (kind === "soc2-criterion") return SOC2_CATEGORY_LABEL[extra.category as string] ?? "Common Criteria";
  if (kind === "iso-clause") return "ISMS Clauses (4–10)";
  if (kind === "iso-annexa") return ANNEXA_THEME_LABEL[extra.theme as string] ?? "Annex A";
  return undefined;
}

export interface CatalogRequirement {
  ref: string;
  name: string;
  reference_id: string;
  category?: string;
  metadata: Record<string, unknown>;
}
export interface CatalogFramework {
  ref: string;
  name: string;
  metadata?: Record<string, unknown>;
  requirements: CatalogRequirement[];
}
export interface CatalogControl {
  ref: string;
  name: string;
  metadata?: Record<string, unknown>;
  satisfies?: string[];
}
export interface Catalog {
  catalog_version: string;
  source: string;
  generated_at?: string;
  frameworks: CatalogFramework[];
  controls: CatalogControl[];
}

// Build the catalog document. `generatedAt` is an optional, informational
// ISO-8601 timestamp (omitted if not supplied — keeps output deterministic).
export async function buildCatalog(generatedAt?: string): Promise<{ catalog: Catalog; droppedSatisfies: number }> {
  const [fws, reqs, ctrls, cats, maps] = await Promise.all([
    db.select().from(s.frameworks).orderBy(asc(s.frameworks.id)),
    db.select().from(s.requirements).orderBy(asc(s.requirements.frameworkId), asc(s.requirements.code)),
    db.select().from(s.controls).orderBy(asc(s.controls.code)),
    db.select().from(s.controlCategories),
    db
      .select({ control: s.mappings.controlCode, frameworkId: s.requirements.frameworkId, code: s.requirements.code })
      .from(s.mappings)
      .innerJoin(s.requirements, eq(s.mappings.requirementId, s.requirements.id)),
  ]);

  const catTitle = new Map(cats.map((c) => [c.id, c.title]));

  // requirements nested under their framework; collect refs for satisfies validation
  const reqByFw = new Map<string, CatalogRequirement[]>();
  const reqRefs = new Set<string>();
  for (const r of reqs) {
    const ref = requirementRef(r.frameworkId, r.code);
    reqRefs.add(ref);
    const extra = (r.extra ?? {}) as Record<string, unknown>;
    const category = requirementCategory(r.kind, extra);
    // metadata carries provenance (kind + any extra) minus the raw category key,
    // which we surface as the typed `category` field instead.
    const { category: _rawCat, ...restExtra } = extra;
    const req: CatalogRequirement = {
      ref,
      name: r.title ? `${r.code} — ${r.title}` : r.code,
      reference_id: r.code,
      metadata: { kind: r.kind, ...restExtra },
    };
    if (category) req.category = category;
    (reqByFw.get(r.frameworkId) ?? reqByFw.set(r.frameworkId, []).get(r.frameworkId)!).push(req);
  }

  const frameworks: CatalogFramework[] = fws.map((f) => {
    const metadata: Record<string, unknown> = {};
    if (f.version) metadata.version = f.version;
    return {
      ref: f.id,
      name: f.name,
      ...(Object.keys(metadata).length ? { metadata } : {}),
      requirements: reqByFw.get(f.id) ?? [],
    };
  });

  // control.satisfies[] from the crosswalk — fail-closed: only emit refs that
  // exist as requirements in this same document (contract rule 3).
  const satisfiesByControl = new Map<string, Set<string>>();
  let droppedSatisfies = 0;
  for (const m of maps) {
    const ref = requirementRef(m.frameworkId, m.code);
    if (!reqRefs.has(ref)) {
      droppedSatisfies++;
      continue;
    }
    (satisfiesByControl.get(m.control) ?? satisfiesByControl.set(m.control, new Set()).get(m.control)!).add(ref);
  }

  const controls: CatalogControl[] = ctrls.map((c) => {
    const metadata: Record<string, unknown> = {};
    const cat = catTitle.get(c.categoryId);
    if (cat) metadata.category = cat;
    if (c.objectiveCode) metadata.objective = c.objectiveCode;
    const sat = satisfiesByControl.get(c.code);
    return {
      ref: c.code,
      name: c.title,
      ...(Object.keys(metadata).length ? { metadata } : {}),
      ...(sat && sat.size ? { satisfies: [...sat].sort() } : {}),
    };
  });

  const catalog: Catalog = {
    catalog_version: CATALOG_VERSION,
    source: "autocomply",
    ...(generatedAt ? { generated_at: generatedAt } : {}),
    frameworks,
    controls,
  };
  return { catalog, droppedSatisfies };
}
