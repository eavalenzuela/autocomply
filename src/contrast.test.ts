// A contrast budget, enforced.
//
// --ink-4 shipped at 3.28:1 on the light background and 3.50:1 on the dark one,
// against a WCAG AA requirement of 4.5:1 for body text. It is used for meta
// lines, units and captions — small text, where the requirement matters most.
// Parsing the real stylesheet rather than a copy of the values means this fails
// if someone edits the token back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function tokensFor(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function ratio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// :root is the light theme; the dark block follows.
const rootBlock = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
const darkStart = css.indexOf("--bg:", css.indexOf("}", css.indexOf(":root")));
const darkBlock = css.slice(darkStart, css.indexOf("}", darkStart));

const AA = 4.5;

test("light theme: every ink token meets AA against the background", () => {
  const t = tokensFor(rootBlock);
  assert.ok(t.bg, "expected a --bg token in :root");
  for (const name of ["ink", "ink-2", "ink-3", "ink-4"]) {
    const r = ratio(t[name], t.bg);
    assert.ok(r >= AA, `--${name} (${t[name]}) is ${r.toFixed(2)}:1 on ${t.bg}, needs ${AA}:1`);
  }
});

test("dark theme: every ink token meets AA against the background", () => {
  const t = tokensFor(darkBlock);
  assert.ok(t.bg, "expected a --bg token in the dark block");
  for (const name of ["ink", "ink-2", "ink-3", "ink-4"]) {
    const r = ratio(t[name], t.bg);
    assert.ok(r >= AA, `dark --${name} (${t[name]}) is ${r.toFixed(2)}:1 on ${t.bg}, needs ${AA}:1`);
  }
});
