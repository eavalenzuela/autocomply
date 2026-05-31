// Source-agnostic data loader — reads data/*.yaml into normalized structures.
// This is the MyCSF-ingest seam: today it reads our bootstrap yaml; later an
// ingester augments/overrides the same shapes. Nothing downstream cares about
// the origin.
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
export interface LoadedControl { code: string; title: string; categoryId: string; objectiveCode: string; isoRef: string | null; }
export interface LoadedFramework { id: string; name: string; version: string; }
export interface LoadedRequirement { frameworkId: string; code: string; title: string; kind: string; extra: unknown; }
export interface LoadedMapping { frameworkId: string; control: string; requirement: string; relationship: string; confidence: string; source: string; }

export interface LoadedData {
  categories: LoadedCategory[];
  objectives: LoadedObjective[];
  controls: LoadedControl[];
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

  const objMap = new Map<string, LoadedObjective>();
  for (const c of controlsDoc.controls) {
    const code = String(c.objective).split(" ")[0];
    const title = String(c.objective).slice(code.length).trim();
    if (!objMap.has(code)) objMap.set(code, { code, title, categoryId: c.category });
  }
  const objectives = [...objMap.values()];

  const controls: LoadedControl[] = controlsDoc.controls.map((c: any) => ({
    code: c.code,
    title: c.title,
    categoryId: c.category,
    objectiveCode: String(c.objective).split(" ")[0],
    isoRef: c.iso_2005 ?? null,
  }));

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

  return { categories, objectives, controls, frameworks, requirements, mappings };
}
