// Producer-side contract tests for the GRCen catalog export. Integration test:
// runs against the seeded dev DB (docker compose + db:setup). Run: `npm test`.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, validateCatalog, deriveCrosswalks } from "./catalog";
import { pool } from "./db/index";

const GEN_AT = "2026-01-01T00:00:00.000Z";

// ── deriveCrosswalks: pure unit tests (no DB) ────────────────────────────────

test("deriveCrosswalks: a control shared across frameworks yields one cross-framework pair", () => {
  const xs = deriveCrosswalks([
    { control: "AC-2", ref: "iso27001:A.5.16", fw: "iso27001", relationship: "equivalent", confidence: "high" },
    { control: "AC-2", ref: "soc2:CC6.1", fw: "soc2", relationship: "equivalent", confidence: "high" },
  ]);
  assert.equal(xs.length, 1);
  assert.deepEqual([xs[0].from, xs[0].to], ["iso27001:A.5.16", "soc2:CC6.1"]); // canonical (sorted) order
  assert.equal(xs[0].relationship, "equivalent");
  assert.equal(xs[0].confidence, "high");
  assert.match(xs[0].note!, /AC-2/);
});

test("deriveCrosswalks: two requirements in the same framework are not crosswalked", () => {
  const xs = deriveCrosswalks([
    { control: "AC-2", ref: "soc2:CC6.1", fw: "soc2", relationship: "equivalent", confidence: "high" },
    { control: "AC-2", ref: "soc2:CC6.2", fw: "soc2", relationship: "partial", confidence: "high" },
  ]);
  assert.equal(xs.length, 0);
});

test("deriveCrosswalks: relationship/confidence inferred from the legs (weaker confidence, related unless both >= partial)", () => {
  const xs = deriveCrosswalks([
    { control: "AC-2", ref: "iso27001:A.8.2", fw: "iso27001", relationship: "partial", confidence: "high" },
    { control: "AC-2", ref: "soc2:CC6.3", fw: "soc2", relationship: "related", confidence: "low" },
  ]);
  assert.equal(xs.length, 1);
  assert.equal(xs[0].relationship, "related"); // one leg is merely "related"
  assert.equal(xs[0].confidence, "low"); // weaker leg
});

test("deriveCrosswalks: same pair via multiple controls dedups, keeping strongest evidence + listing controls", () => {
  const xs = deriveCrosswalks([
    { control: "SI-4", ref: "iso27001:A.8.16", fw: "iso27001", relationship: "partial", confidence: "medium" },
    { control: "SI-4", ref: "soc2:CC7.2", fw: "soc2", relationship: "partial", confidence: "medium" },
    { control: "AU-6", ref: "iso27001:A.8.16", fw: "iso27001", relationship: "equivalent", confidence: "high" },
    { control: "AU-6", ref: "soc2:CC7.2", fw: "soc2", relationship: "equivalent", confidence: "high" },
  ]);
  assert.equal(xs.length, 1);
  assert.equal(xs[0].relationship, "equivalent"); // strongest across the two controls
  assert.equal(xs[0].confidence, "high");
  assert.match(xs[0].note!, /AU-6/);
  assert.match(xs[0].note!, /SI-4/);
});

test("catalog builds, self-validates against the contract schema, and drops nothing", async () => {
  const { catalog, droppedSatisfies } = await buildCatalog(GEN_AT);
  await validateCatalog(catalog); // throws on any schema violation
  assert.equal(droppedSatisfies, 0, "no satisfies edges should be dropped");
  assert.ok(catalog.frameworks.length >= 2, "expected >=2 frameworks");
  // An invariant, not a fixture size: this suite must pass against whatever
  // catalog is loaded, including a real organisation's. It previously demanded
  // >1000 controls, so loading your own control set turned the build red.
  assert.ok(catalog.controls.length > 0, "catalog should not be empty");
});

test("requirement refs are unique and namespaced <fw>:<code>", async () => {
  const { catalog } = await buildCatalog(GEN_AT);
  const refs = catalog.frameworks.flatMap((f) => f.requirements.map((r) => r.ref));
  assert.ok(refs.length > 100, "expected >100 requirements");
  assert.equal(new Set(refs).size, refs.length, "requirement refs must be unique");
  // Hyphens allowed: the contract's `ref` is an unconstrained string, and real
  // framework ids have them (sp800-171). This regex was stricter than the schema
  // it exists to check, so adding a legitimately-named catalog failed a test
  // that the contract itself was happy with.
  for (const r of refs) assert.match(r, /^[a-z0-9][a-z0-9-]*:/, `ref not namespaced: ${r}`);
});

test("control satisfies edges only reference declared requirement refs (fail-closed)", async () => {
  const { catalog } = await buildCatalog(GEN_AT);
  const known = new Set(catalog.frameworks.flatMap((f) => f.requirements.map((r) => r.ref)));
  for (const c of catalog.controls)
    for (const ref of c.satisfies ?? []) assert.ok(known.has(ref), `dangling satisfies ref ${ref} on ${c.ref}`);
});

test("crosswalks[] are cross-framework, resolve to declared requirements, and are deduped", async () => {
  const { catalog } = await buildCatalog(GEN_AT);
  await validateCatalog(catalog); // schema enforces from/to + relationship/confidence enums
  assert.ok(catalog.crosswalks.length > 0, "expected derived cross-framework crosswalks");
  const known = new Set(catalog.frameworks.flatMap((f) => f.requirements.map((r) => r.ref)));
  const fwOf = (ref: string) => ref.slice(0, ref.indexOf(":"));
  const seen = new Set<string>();
  for (const x of catalog.crosswalks) {
    assert.ok(known.has(x.from), `dangling crosswalk from-ref ${x.from}`);
    assert.ok(known.has(x.to), `dangling crosswalk to-ref ${x.to}`);
    assert.notEqual(x.from, x.to, "crosswalk maps a requirement to itself");
    assert.notEqual(fwOf(x.from), fwOf(x.to), `crosswalk within one framework: ${x.from} → ${x.to}`);
    assert.ok(x.from < x.to, `crosswalk endpoints not in canonical order: ${x.from} → ${x.to}`);
    const key = `${x.from}|${x.to}`;
    assert.ok(!seen.has(key), `duplicate crosswalk pair ${key}`);
    seen.add(key);
  }
});

after(async () => {
  await pool.end();
});
