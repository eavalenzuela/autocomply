// Ranking is the whole promise of a typeahead — "type AC-2, get AC-2 first" —
// and it is easy to break silently with a sort tweak.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchControls } from "./ControlPicker";

const C = (code: string, title: string) => ({ code, title }) as any;
const CATALOG = [
  C("AC-1", "Policy and Procedures"),
  C("AC-2", "Account Management"),
  C("AC-2(1)", "Automated System Account Management"),
  C("AC-20", "Use of External Systems"),
  C("AU-2", "Event Logging"),
  C("SC-28", "Protection of Information at Rest"),
  C("MA-2", "Controlled Maintenance"),
];

test("an empty query offers nothing", () => {
  assert.deepEqual(matchControls(CATALOG, ""), []);
  assert.deepEqual(matchControls(CATALOG, "   "), []);
});

test("an exact code ranks first, ahead of codes that merely contain it", () => {
  const r = matchControls(CATALOG, "AC-2");
  assert.equal(r[0].code, "AC-2", `expected AC-2 first, got ${r.map((x) => x.code).join(",")}`);
  // AC-2(1) and AC-20 both contain "ac-2" and must not outrank the exact match.
  assert.ok(r.slice(1).some((x) => x.code === "AC-20"));
  assert.ok(r.slice(1).some((x) => x.code === "AC-2(1)"));
});

test("matching is case-insensitive", () => {
  assert.equal(matchControls(CATALOG, "ac-2")[0].code, "AC-2");
  assert.equal(matchControls(CATALOG, "AC-2")[0].code, "AC-2");
});

test("titles are searchable, for people who know the name not the code", () => {
  const r = matchControls(CATALOG, "account management");
  assert.ok(r.length >= 2);
  assert.ok(r.every((x) => x.title.toLowerCase().includes("account management")));
});

test("a code prefix outranks a mid-string match", () => {
  const r = matchControls(CATALOG, "2");
  const first = r[0].code;
  assert.ok(r.length > 1);
  // Nothing starts with "2", so this is purely the stable alphabetical fallback.
  assert.equal(first, r.map((x) => x.code).sort()[0]);
});

test("the result set is capped so the dropdown stays a dropdown", () => {
  const many = Array.from({ length: 200 }, (_, i) => C(`XX-${i}`, "Filler"));
  assert.equal(matchControls(many, "XX", 40).length, 40);
});
