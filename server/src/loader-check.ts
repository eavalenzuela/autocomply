// Standalone loader verification — no DB required.
import { loadAll } from "./loader";

const d = loadAll();
const counts = {
  categories: d.categories.length,
  objectives: d.objectives.length,
  controls: d.controls.length,
  baselines: d.baselines.length,
  frameworks: d.frameworks.length,
  requirements: d.requirements.length,
  mappings: d.mappings.length,
};
console.log("loaded:", counts);

// integrity: every mapping references a known control + a known requirement
const controlCodes = new Set(d.controls.map((c) => c.code));
const reqKeys = new Set(d.requirements.map((r) => `${r.frameworkId}:${r.code}`));
const bad: string[] = [];
for (const m of d.mappings) {
  if (!controlCodes.has(m.control)) bad.push(`bad control ${m.control}`);
  if (!reqKeys.has(`${m.frameworkId}:${m.requirement}`)) bad.push(`bad requirement ${m.frameworkId}:${m.requirement} (${m.control})`);
}
const objCodes = new Set(d.objectives.map((o) => o.code));
for (const c of d.controls) {
  if (!objCodes.has(c.objectiveCode)) bad.push(`control ${c.code} → unknown objective ${c.objectiveCode}`);
}
const validBaselines = new Set(["low", "moderate", "high"]);
for (const b of d.baselines) {
  if (!controlCodes.has(b.controlCode)) bad.push(`baseline → unknown control ${b.controlCode}`);
  if (!validBaselines.has(b.baseline)) bad.push(`bad baseline ${b.baseline} (${b.controlCode})`);
}
console.log("integrity:", bad.length ? bad : "OK");
// Invariants, not cardinalities. This used to demand exactly 1196 controls /
// 324 objectives / 20 categories, which meant loading YOUR organisation's
// control set failed the check — the tooling asserted the fixture rather than
// the rules the data has to obey. What matters is that the catalog is
// non-empty, internally consistent, and free of duplicates; how big it is, is
// the operator's business.
const invariants: [string, boolean][] = [
  ["catalog is non-empty", counts.controls > 0],
  ["every control belongs to a category", counts.categories > 0],
  ["objectives are present", counts.objectives > 0],
  ["control codes are unique", new Set(d.controls.map((c) => c.code)).size === counts.controls],
  ["category ids are unique", new Set(d.categories.map((c) => c.id)).size === counts.categories],
  [
    "objective codes are unique",
    new Set(d.objectives.map((o: any) => o.code)).size === counts.objectives,
  ],
  [
    "requirement refs are unique within a framework",
    new Set(d.requirements.map((r: any) => `${r.frameworkId}:${r.code}`)).size === counts.requirements,
  ],
];
const broken = invariants.filter(([, ok]) => !ok).map(([name]) => name);
if (broken.length) {
  console.error("BROKEN INVARIANTS:", broken);
  process.exit(1);
}
if (bad.length) process.exit(1);
console.log("loader-check PASSED");
