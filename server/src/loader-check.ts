// Standalone loader verification — no DB required.
import { loadAll } from "./loader";

const d = loadAll();
const counts = {
  categories: d.categories.length,
  objectives: d.objectives.length,
  controls: d.controls.length,
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
console.log("integrity:", bad.length ? bad : "OK");
if (counts.controls !== 156 || counts.objectives !== 49 || counts.categories !== 14) {
  console.error("UNEXPECTED COUNTS");
  process.exit(1);
}
if (bad.length) process.exit(1);
console.log("loader-check PASSED");
