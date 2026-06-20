// Producer-side contract tests for the GRCen catalog export. Integration test:
// runs against the seeded dev DB (docker compose + db:setup). Run: `npm test`.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, validateCatalog } from "./catalog";
import { pool } from "./db/index";

const GEN_AT = "2026-01-01T00:00:00.000Z";

test("catalog builds, self-validates against the contract schema, and drops nothing", async () => {
  const { catalog, droppedSatisfies } = await buildCatalog(GEN_AT);
  await validateCatalog(catalog); // throws on any schema violation
  assert.equal(droppedSatisfies, 0, "no satisfies edges should be dropped");
  assert.ok(catalog.frameworks.length >= 2, "expected >=2 frameworks");
  assert.ok(catalog.controls.length > 1000, "expected the full 800-53 control set");
});

test("requirement refs are unique and namespaced <fw>:<code>", async () => {
  const { catalog } = await buildCatalog(GEN_AT);
  const refs = catalog.frameworks.flatMap((f) => f.requirements.map((r) => r.ref));
  assert.ok(refs.length > 100, "expected >100 requirements");
  assert.equal(new Set(refs).size, refs.length, "requirement refs must be unique");
  for (const r of refs) assert.match(r, /^[a-z0-9]+:/, `ref not namespaced: ${r}`);
});

test("control satisfies edges only reference declared requirement refs (fail-closed)", async () => {
  const { catalog } = await buildCatalog(GEN_AT);
  const known = new Set(catalog.frameworks.flatMap((f) => f.requirements.map((r) => r.ref)));
  for (const c of catalog.controls)
    for (const ref of c.satisfies ?? []) assert.ok(known.has(ref), `dangling satisfies ref ${ref} on ${c.ref}`);
});

after(async () => {
  await pool.end();
});
