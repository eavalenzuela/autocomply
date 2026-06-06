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
export interface LoadedFramework { id: string; name: string; version: string; }
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

  const frameworks: LoadedFramework[] = [
    { id: "soc2", name: soc2.meta?.framework ?? "SOC 2", version: String(soc2.meta?.version ?? "") },
    { id: "iso27001", name: iso.meta?.framework ?? "ISO/IEC 27001", version: String(iso.meta?.version ?? "") },
  ];

  const mappings: LoadedMapping[] = [
    ...crosswalk.soc2.map((m: any) => ({ frameworkId: "soc2", control: m.control, requirement: String(m.requirement), relationship: m.relationship, confidence: m.confidence, source: m.source })),
    ...crosswalk.iso27001.map((m: any) => ({ frameworkId: "iso27001", control: m.control, requirement: String(m.requirement), relationship: m.relationship, confidence: m.confidence, source: m.source })),
  ];

  return { categories, objectives, controls, baselines, frameworks, requirements, mappings };
}
