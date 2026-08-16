// autocomply — GRCen catalog export (producer side).
//
// Projects autocomply's system-of-record (CCF controls + framework requirements
// + crosswalk mappings) into the read-only catalog document GRCen ingests via
// `grcen sync-catalog`. The shape + rules are the contract in GRCEN_CATALOG_EXPORT.md
// and contracts/grcen_catalog_export.schema.json.
//
// Read-only projection: this never mutates autocomply state.
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { asc, desc, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { db } from "./db/index";
import { recordAudit, type AuditActor } from "./audit";
import * as s from "./db/schema";

export const CATALOG_VERSION = "1";

// Producer-side contract self-validation: every export is checked against
// contracts/grcen_catalog_export.schema.json before it ships, so a malformed
// catalog fails here (fail-closed) rather than at GRCen's importer.
const SCHEMA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../contracts/grcen_catalog_export.schema.json");
let _validate: ((data: unknown) => boolean) & { errors?: unknown } | null = null;
async function getValidator() {
  if (_validate) return _validate;
  const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  _validate = ajv.compile(schema);
  return _validate;
}
export async function validateCatalog(catalog: unknown): Promise<void> {
  const validate = await getValidator();
  if (!validate(catalog)) {
    throw new Error(`catalog failed schema validation: ${JSON.stringify(validate.errors)?.slice(0, 600)}`);
  }
}

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
export interface CatalogCrosswalk {
  from: string;
  to: string;
  relationship?: string;
  confidence?: string;
  note?: string;
}
export interface Catalog {
  catalog_version: string;
  source: string;
  generated_at?: string;
  frameworks: CatalogFramework[];
  controls: CatalogControl[];
  crosswalks: CatalogCrosswalk[];
}

// A control→requirement mapping that survived ref validation, used to derive
// requirement↔requirement crosswalks.
export interface MappedRequirement {
  control: string;
  ref: string;
  fw: string;
  relationship: string;
  confidence: string;
}

// Strength orderings for combining inferred crosswalk evidence.
const REL_RANK: Record<string, number> = { related: 0, subset: 1, superset: 1, partial: 2, equivalent: 3 };
const CONF_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };
const CONF_NAME = ["low", "medium", "high"] as const;

// The req↔req relationship inferred from the two control→req legs that imply it.
// Both legs equivalent ⇒ the requirements are equivalent; both at least partial ⇒
// partial; otherwise merely related.
function pairRelationship(a: string, b: string): string {
  if (a === "equivalent" && b === "equivalent") return "equivalent";
  const atLeastPartial = (r: string) => r === "equivalent" || r === "partial";
  if (atLeastPartial(a) && atLeastPartial(b)) return "partial";
  return "related";
}

// Derive cross-framework requirement↔requirement crosswalks from control→requirement
// mappings: two requirements in *different* frameworks that a single control maps to
// are the same underlying obligation. Deduped to one entry per unordered pair,
// keeping the strongest relationship/confidence across every control that links them,
// with the contributing controls recorded in `note`. Pure (no DB) so it's unit-testable.
// Cross-framework only — two requirements in the same framework sharing a control is
// just that control covering two requirements, not a crosswalk. See
// GRCEN_CATALOG_EXPORT.md rule 6.
export function deriveCrosswalks(mapped: MappedRequirement[]): CatalogCrosswalk[] {
  const byControl = new Map<string, MappedRequirement[]>();
  for (const m of mapped) {
    (byControl.get(m.control) ?? byControl.set(m.control, []).get(m.control)!).push(m);
  }

  const acc = new Map<
    string,
    { from: string; to: string; relationship: string; confidence: string; controls: Set<string> }
  >();
  for (const [control, list] of byControl) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.fw === b.fw) continue;
        const [from, to] = a.ref < b.ref ? [a.ref, b.ref] : [b.ref, a.ref];
        const key = `${from}|${to}`;
        const relationship = pairRelationship(a.relationship, b.relationship);
        const confidence = CONF_NAME[Math.min(CONF_RANK[a.confidence] ?? 0, CONF_RANK[b.confidence] ?? 0)];
        const prev = acc.get(key);
        if (!prev) {
          acc.set(key, { from, to, relationship, confidence, controls: new Set([control]) });
        } else {
          prev.controls.add(control);
          if (
            REL_RANK[relationship] > REL_RANK[prev.relationship] ||
            (REL_RANK[relationship] === REL_RANK[prev.relationship] &&
              CONF_RANK[confidence] > CONF_RANK[prev.confidence])
          ) {
            prev.relationship = relationship;
            prev.confidence = confidence;
          }
        }
      }
    }
  }

  return [...acc.values()]
    .sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to))
    .map(({ from, to, relationship, confidence, controls }) => {
      const ctrls = [...controls].sort();
      const shown = ctrls.slice(0, 5).join(", ");
      const more = ctrls.length > 5 ? `, +${ctrls.length - 5} more` : "";
      const note = `shared control${ctrls.length > 1 ? "s" : ""}: ${shown}${more}`;
      return { from, to, relationship, confidence, note };
    });
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
      .select({
        control: s.mappings.controlCode,
        frameworkId: s.requirements.frameworkId,
        code: s.requirements.code,
        relationship: s.mappings.relationship,
        confidence: s.mappings.confidence,
      })
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
  // exist as requirements in this same document (contract rule 3). We also keep
  // each mapping's relationship/confidence in metadata.crosswalk so that detail
  // survives the trip (GRCen's covered/gap model is binary and ignores it today).
  const crosswalkByControl = new Map<string, Record<string, { relationship: string; confidence: string }>>();
  const mappedReqs: MappedRequirement[] = [];
  let droppedSatisfies = 0;
  for (const m of maps) {
    const ref = requirementRef(m.frameworkId, m.code);
    if (!reqRefs.has(ref)) {
      droppedSatisfies++;
      continue;
    }
    const cw = crosswalkByControl.get(m.control) ?? crosswalkByControl.set(m.control, {}).get(m.control)!;
    cw[ref] = { relationship: m.relationship, confidence: m.confidence };
    mappedReqs.push({ control: m.control, ref, fw: m.frameworkId, relationship: m.relationship, confidence: m.confidence });
  }

  const controls: CatalogControl[] = ctrls.map((c) => {
    const metadata: Record<string, unknown> = {};
    const cat = catTitle.get(c.categoryId);
    if (cat) metadata.category = cat;
    if (c.objectiveCode) metadata.objective = c.objectiveCode;
    const cw = crosswalkByControl.get(c.code);
    if (cw && Object.keys(cw).length) metadata.crosswalk = cw;
    return {
      ref: c.code,
      name: c.title,
      ...(Object.keys(metadata).length ? { metadata } : {}),
      ...(cw && Object.keys(cw).length ? { satisfies: Object.keys(cw).sort() } : {}),
    };
  });

  // Cross-framework requirement↔requirement crosswalks, derived from the same
  // control crosswalk data the satisfies[] edges come from.
  const crosswalks = deriveCrosswalks(mappedReqs);

  const catalog: Catalog = {
    catalog_version: CATALOG_VERSION,
    source: "autocomply",
    ...(generatedAt ? { generated_at: generatedAt } : {}),
    frameworks,
    controls,
    crosswalks,
  };
  await validateCatalog(catalog); // fail-closed if the projection ever violates the contract
  return { catalog, droppedSatisfies };
}

// Record a catalog export in the append-only audit log.
//
// GRCen's sync authenticates with a scoped API token, and this used to record
// only the token OWNER's user id — so the single most common machine-driven
// export in the product was indistinguishable in the trail from that person
// pulling it by hand. Pass the actor (whose tokenId identifies the credential)
// and, for live pulls, the request, so the entry carries where it came from.
// Scheduled file exports legitimately have neither.
export async function recordCatalogExport(
  actor: AuditActor,
  mode: "api" | "scheduled" | "dump",
  extra?: Record<string, unknown>,
  req?: FastifyRequest,
) {
  if (req) {
    await recordAudit(db, req, actor, {
      action: "catalog-export",
      targetType: "catalog",
      payload: { mode, ...extra },
    });
    return;
  }
  await db.insert(s.auditLog).values({
    actorId: actor?.id ?? null,
    actorTokenId: actor?.tokenId ?? null,
    action: "catalog-export",
    targetType: "catalog",
    payload: { mode, ...extra },
  });
}

// Build the catalog and write it to a file (the scheduled-export job). Audit-logged.
export async function exportCatalogToFile(path: string, generatedAt?: string) {
  const { catalog, droppedSatisfies } = await buildCatalog(generatedAt);
  await writeFile(path, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  await recordCatalogExport(null, "scheduled", { path });
  return {
    droppedSatisfies,
    frameworks: catalog.frameworks.length,
    controls: catalog.controls.length,
    crosswalks: catalog.crosswalks.length,
  };
}

// Latest catalog-export timestamp (for the Integrations export-status card).
export async function lastCatalogExportAt(): Promise<Date | null> {
  const row = (
    await db
      .select({ ts: s.auditLog.ts })
      .from(s.auditLog)
      .where(eq(s.auditLog.action, "catalog-export"))
      .orderBy(desc(s.auditLog.ts))
      .limit(1)
  )[0];
  return row?.ts ?? null;
}
