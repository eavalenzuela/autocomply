// Routing is where "the deep link silently rendered the wrong page" lived, so
// the parser is worth testing directly — including the case that used to 200.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLocation, buildUrl, titleFor, DEFAULT_SECTION } from "./router";

test("root resolves to the default section", () => {
  const r = parseLocation("/", "");
  assert.equal(r.section, DEFAULT_SECTION);
  assert.equal(r.code, null);
});

test("a known section resolves, with or without a trailing slash", () => {
  assert.equal(parseLocation("/admin", "").section, "admin");
  assert.equal(parseLocation("/admin/", "").section, "admin");
  assert.equal(parseLocation("/requirements", "").section, "requirements");
});

test("an unknown path is NOT quietly the default section", () => {
  // The regression: /nope used to return 200 and render the Control Matrix,
  // because the SPA fallback served index.html and nothing parsed the path.
  const r = parseLocation("/nope", "");
  assert.equal(r.section, null, "an unknown path must resolve to a 404, not to a section");
  assert.equal(r.path, "/nope", "and it should report what was not found");
});

test("a second segment is the control code, and survives encoding", () => {
  assert.equal(parseLocation("/matrix/AC-2", "").code, "AC-2");
  assert.equal(parseLocation("/controls/SC-28", "").code, "SC-28");
  assert.equal(parseLocation(`/matrix/${encodeURIComponent("AC-2(1)")}`, "").code, "AC-2(1)");
});

test("filters and framework come from the query string", () => {
  const r = parseLocation("/matrix", "?filters=gate-failing,drift&framework=iso27001");
  assert.deepEqual(r.filters, ["gate-failing", "drift"]);
  assert.equal(r.framework, "iso27001");
});

test("empty and whitespace-only filters do not become phantom entries", () => {
  assert.deepEqual(parseLocation("/matrix", "?filters=").filters, []);
  assert.deepEqual(parseLocation("/matrix", "?filters=a,,%20,b").filters, ["a", "b"]);
});

test("buildUrl round-trips through parseLocation", () => {
  const cases = [
    { section: "matrix" as const, code: "AC-2", filters: ["drift"], framework: null },
    { section: "requirements" as const, code: null, filters: [], framework: "soc2" },
    { section: "controls" as const, code: "AC-2(1)", filters: [], framework: null },
  ];
  for (const c of cases) {
    const url = buildUrl(c);
    const [path, search] = url.split("?");
    const r = parseLocation(path, search ? `?${search}` : "");
    assert.equal(r.section, c.section, url);
    assert.equal(r.code, c.code ?? null, url);
    assert.deepEqual(r.filters, c.filters, url);
    assert.equal(r.framework, c.framework, url);
  }
});

test("buildUrl omits an empty query rather than trailing a bare ?", () => {
  assert.equal(buildUrl({ section: "matrix" }), "/matrix");
  assert.equal(buildUrl({ section: "matrix", filters: [] }), "/matrix");
});

test("the document title says where you are", () => {
  assert.match(titleFor(parseLocation("/matrix", "")), /Control Matrix/);
  assert.match(titleFor(parseLocation("/matrix/AC-2", "")), /^AC-2 · Control Matrix/);
  assert.match(titleFor(parseLocation("/nope", "")), /Not found/);
});
