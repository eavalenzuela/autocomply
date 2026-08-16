// Source-agnostic data loader — reads data/*.yaml into normalized structures.
// controls.yaml is generated from the NIST SP 800-53 Rev 5 OSCAL catalog
// (scripts/gen_nist_catalog.py); the crosswalk from scripts/gen_crosswalk.py.
// Nothing downstream cares about the origin.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import YAML from "yaml";

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");

function load(file: string): any {
  return YAML.parse(readFileSync(path.join(DATA_DIR, file), "utf8"));
}

export interface LoadedCategory { id: string; title: string; }
export interface LoadedObjective { code: string; title: string; categoryId: string; }
export interface LoadedControl { code: string; title: string; categoryId: string; objectiveCode: string; }
export interface LoadedBaseline { controlCode: string; baseline: string; }
export interface LoadedFramework {
  id: string;
  name: string;
  version: string;
  /** Opt-in: a catalog in the repo is not consent to be measured by it. */
  enabled: boolean;
  /** Provenance travels with the data — the licence is what decides what may ship. */
  licence: string | null;
  sourceUrl: string | null;
}
export interface LoadedRequirement { frameworkId: string; code: string; title: string; kind: string; extra: unknown; }
export interface LoadedMapping { frameworkId: string; control: string; requirement: string; relationship: string; confidence: string; source: string; }

export interface LoadedData {
  categories: LoadedCategory[];
  objectives: LoadedObjective[];
  controls: LoadedControl[];
  baselines: LoadedBaseline[];
  frameworks: LoadedFramework[];
  requirements: LoadedRequirement[];
  mappings: LoadedMapping[];
}

export function loadAll(): LoadedData {
  const controlsDoc = load("controls.yaml");
  const soc2 = load("frameworks/soc2-tsc.yaml");
  const iso = load("frameworks/iso27001-2022.yaml");
  const crosswalk = load("mappings/ccf-crosswalk.yaml");

  const categories: LoadedCategory[] = controlsDoc.categories.map((c: any) => ({ id: c.id, title: c.title }));

  const objectives: LoadedObjective[] = controlsDoc.objectives.map((o: any) => ({
    code: o.code,
    title: o.title,
    categoryId: o.category,
  }));

  const controls: LoadedControl[] = controlsDoc.controls.map((c: any) => ({
    code: c.code,
    title: c.title,
    categoryId: c.category,
    objectiveCode: c.objective,
  }));

  const baselines: LoadedBaseline[] = controlsDoc.controls.flatMap((c: any) =>
    (c.baselines ?? []).map((b: string) => ({ controlCode: c.code, baseline: b })),
  );

  const requirements: LoadedRequirement[] = [];
  for (const cr of soc2.criteria)
    requirements.push({ frameworkId: "soc2", code: cr.code, title: cr.title, kind: "soc2-criterion", extra: { category: cr.category } });
  for (const cl of iso.clauses)
    requirements.push({ frameworkId: "iso27001", code: cl.code, title: cl.title, kind: "iso-clause", extra: null });
  for (const a of iso.annex_a)
    requirements.push({ frameworkId: "iso27001", code: a.code, title: a.title, kind: "iso-annexa", extra: { theme: a.theme, new_2022: a.new_2022 ?? false } });

  const fw = (id: string, doc: any, fallbackName: string): LoadedFramework => ({
    id,
    name: doc?.meta?.framework ?? fallbackName,
    version: String(doc?.meta?.version ?? ""),
    // Default off. seed.ts preserves whatever an existing database already has,
    // so enabling a framework is a decision made once and not undone by a reload.
    enabled: doc?.meta?.enabled === true,
    licence: doc?.meta?.licence ?? null,
    sourceUrl: doc?.meta?.source_url ?? null,
  });

  const frameworks: LoadedFramework[] = [
    fw("soc2", soc2, "SOC 2"),
    fw("iso27001", iso, "ISO/IEC 27001"),
  ];

  const mapFor = (frameworkId: string, rows: any[] = []): LoadedMapping[] =>
    rows.map((m: any) => ({
      frameworkId,
      control: m.control,
      requirement: String(m.requirement),
      relationship: m.relationship,
      confidence: m.confidence,
      source: m.source,
    }));

  const mappings: LoadedMapping[] = [
    ...mapFor("soc2", crosswalk.soc2),
    ...mapFor("iso27001", crosswalk.iso27001),
  ];

  return { categories, objectives, controls, baselines, frameworks, requirements, mappings };
}
