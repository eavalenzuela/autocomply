// Assessment domain: what the compliance posture IS, independent of HTTP.
//
// These functions decide every number the product reports — latest
// attestations, per-control scores, the framework readiness roll-up, and the
// active period's scope. They sat among the route handlers in app.ts, which
// made the rules hard to find and impossible to exercise without a request.
// Moved verbatim: the coverage-adjusted arithmetic is unchanged, and the HTTP
// tests committed in 3fb76d1 are the safety net for that claim.
import { and, asc, desc, eq, inArray, lte, gte } from "drizzle-orm";
import { db } from "../db/index";
import * as s from "../db/schema";
import { controlScore, DIMENSIONS, type Dimension, type Rating } from "../scoring";

// A family fails its certification gate if a single in-scope assessed control falls below
// Partially-Compliant (50) — averages alone let strong policy/process dimensions mask a
// control whose Implemented dimension is non-compliant (e.g. a coverage gap → NC).
export const GATE_FLOOR = 50;

// Display names come from the frameworks table, which is where catalogs are
// loaded. As a hardcoded map this covered three ids, so every catalog added
// since — CSF 2.0, 800-171, CIS v8 — rendered as its raw id ("csf2") anywhere a
// period was shown. nist80053 is not a row in that table: it is the CCF itself,
// so it keeps a literal.
const FW_LABEL_STATIC: Record<string, string> = { nist80053: "NIST 800-53 Rev 5" };
let fwLabelCache: Record<string, string> | null = null;

export async function frameworkLabels(): Promise<Record<string, string>> {
  if (fwLabelCache) return fwLabelCache;
  const rows = await db.select({ id: s.frameworks.id, name: s.frameworks.name }).from(s.frameworks);
  fwLabelCache = { ...FW_LABEL_STATIC };
  for (const r of rows) fwLabelCache[r.id] = r.name;
  return fwLabelCache;
}

/** Drop the cached labels — call after loading or renaming a catalog. */
export function resetFrameworkLabels() {
  fwLabelCache = null;
}

export const REL_W: Record<string, number> = { equivalent: 1, superset: 1, subset: 0.6, partial: 0.6, related: 0.3 };

// latest attestation per (controlCode, dimension). Postgres DISTINCT ON pulls
// exactly one row per key in the database instead of shipping the whole
// append-only table over the wire and deduping in JS on every request.
// (id is the tiebreaker for same-timestamp inserts.)
/**
 * Latest attestation per (controlCode, dimension).
 *
 * `asOf` restricts to what had been attested at a moment in time. The table is
 * append-only, so this reconstructs the state exactly rather than approximating
 * it — which is what makes a closed assessment stable: without it, attesting a
 * control today changes the scores in a report for a period that closed last
 * year, and the document an auditor was handed no longer reproduces.
 */
export async function latestAttestations(asOf?: Date | null) {
  const rows = await db
    .selectDistinctOn([s.attestations.controlCode, s.attestations.dimension])
    .from(s.attestations)
    .where(asOf ? lte(s.attestations.createdAt, asOf) : undefined)
    .orderBy(asc(s.attestations.controlCode), asc(s.attestations.dimension), desc(s.attestations.createdAt), desc(s.attestations.id));
  const map = new Map<string, (typeof rows)[number]>();
  for (const a of rows) map.set(`${a.controlCode}:${a.dimension}`, a);
  return map;
}

// Referenced-entity guard: FK violations from a typo'd control code used to
// surface as opaque Postgres 500s; write endpoints check first and 404 cleanly.
export async function controlExists(code: string | undefined): Promise<boolean> {
  if (!code) return false;
  const rows = await db.select({ code: s.controls.code }).from(s.controls).where(eq(s.controls.code, code)).limit(1);
  return rows.length > 0;
}

// The org's current assessment window. Prefer an active period (the live cycle),
// else the most recent. Drives the report/header period instead of hardcoded dates.
/** Id of the active period, or null. Facts are stamped with this at write time
 *  so a report for a closed window can be answered with what was true then
 *  rather than with whatever is current. */
/** Ids of the frameworks an organisation has actually adopted.
 *  Everything that reports against a framework filters on this: a catalog being
 *  loaded is not the same as an organisation having chosen to be measured by it. */
export async function enabledFrameworkIds(): Promise<string[]> {
  const rows = await db.select({ id: s.frameworks.id }).from(s.frameworks).where(eq(s.frameworks.enabled, true));
  return rows.map((r) => r.id);
}

/** Whether a specific framework is enabled — for routes that take one by name. */
export async function isFrameworkEnabled(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: s.frameworks.id })
    .from(s.frameworks)
    .where(and(eq(s.frameworks.id, id), eq(s.frameworks.enabled, true)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Every active period, newest first.
 *
 * There used to be at most one. That was wrong about how assessments actually
 * run: a SOC 2 observation window routinely overlaps a CSF or HITRUST
 * assessment, and forcing them to be sequential means closing a period that is
 * still open in order to start one that has already started. Uniqueness is now
 * per framework — two concurrent SOC 2 windows are still meaningless — and is
 * enforced by a partial unique index rather than by a read-then-write check.
 */
export async function activePeriods() {
  return db
    .select()
    .from(s.assessmentPeriods)
    .where(eq(s.assessmentPeriods.status, "active"))
    .orderBy(desc(s.assessmentPeriods.startDate));
}

/**
 * The most recent period for a framework whatever its status — what a report
 * falls back to when no window is currently open, which is the normal state
 * after an assessment finishes.
 */
export async function latestPeriodFor(framework: string) {
  const rows = await db
    .select()
    .from(s.assessmentPeriods)
    .where(eq(s.assessmentPeriods.framework, framework))
    .orderBy(desc(s.assessmentPeriods.startDate))
    .limit(1);
  return rows[0] ?? null;
}

/** The active period for one framework, or null. */
export async function activePeriodFor(framework: string) {
  const rows = await db
    .select()
    .from(s.assessmentPeriods)
    .where(and(eq(s.assessmentPeriods.status, "active"), eq(s.assessmentPeriods.framework, framework)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The baseline (CCF) period, whose tier is the only thing that scopes the
 * control matrix. Reading "whatever is active" for that was fine when only one
 * period could be active and became order-dependent the moment two could:
 * a SOC 2 period carries no tier, so which of two active periods you happened
 * to read decided whether the matrix showed a moderate baseline or everything.
 */
export async function baselinePeriod() {
  return activePeriodFor("nist80053");
}

/**
 * The period an attestation is stamped with. Nothing reads this column yet, so
 * the aim is to be defensible rather than clever: a rating is made against a
 * CCF control, so it belongs to the baseline assessment if one is running; with
 * no baseline period but exactly one active period, that one is unambiguous;
 * with several and no baseline, there is no single right answer and guessing is
 * worse than recording nothing.
 */
export async function activePeriodId(): Promise<number | null> {
  const baseline = await baselinePeriod();
  if (baseline) return baseline.id;
  const active = await activePeriods();
  return active.length === 1 ? active[0].id : null;
}

const periodView = (p: typeof s.assessmentPeriods.$inferSelect, labels: Record<string, string>) => ({
  id: p.id,
  name: p.name,
  framework: p.framework,
  frameworkLabel: labels[p.framework] ?? p.framework,
  tier: p.tier,
  start: p.startDate.toISOString().slice(0, 10),
  end: p.endDate.toISOString().slice(0, 10),
  days: Math.max(0, Math.round((p.endDate.getTime() - p.startDate.getTime()) / 864e5)),
  status: p.status,
});

/** A display view of one specific period row. */
export async function periodViewOf(p: typeof s.assessmentPeriods.$inferSelect) {
  return periodView(p, await frameworkLabels());
}

/** Every active period, for surfaces that must not pretend there is only one. */
export async function activePeriodViews() {
  const [rows, labels] = await Promise.all([activePeriods(), frameworkLabels()]);
  return rows.map((p) => periodView(p, labels));
}

/**
 * A single headline period, for the places that show one. Prefers the framework
 * asked for, then the baseline assessment, then the newest active one — so with
 * overlapping windows the answer is at least deterministic.
 */
export async function currentPeriod(framework?: string | null) {
  const rows = await db.select().from(s.assessmentPeriods).orderBy(desc(s.assessmentPeriods.startDate));
  if (rows.length === 0) return null;
  const active = rows.filter((r) => r.status === "active");
  const p =
    (framework ? active.find((r) => r.framework === framework) : undefined) ??
    active.find((r) => r.framework === "nist80053") ??
    active[0] ??
    rows[0];
  return periodView(p, await frameworkLabels());
}

// Reverse roll-up: framework requirements ← mapped controls' scores, + gap report.
// Generic over framework id — it was typed to two while the query was always
// generic, which is how a third framework silently became soc2 at the route.
/**
 * What a closed assessment covered, frozen at close.
 *
 * The column existed and was written on every close, and nothing ever read it —
 * so the freeze it documented did not happen. Reloading a catalog, editing a
 * crosswalk or attesting a control all silently rewrote what a finished
 * assessment had found, and a report reprinted a year later would not match the
 * one that was issued.
 *
 * v1 snapshots were a bare array of in-scope control codes, which only ever
 * populated for baseline periods (a tier is an 800-53 concept), so a closed
 * SOC 2 period froze nothing at all. v2 captures the framework's requirements
 * and their mappings as well, and is read back below.
 */
export interface ScopeSnapshot {
  version: 2;
  closedAt: string;
  /** In-scope CCF controls, when the period was scoped by a baseline tier. */
  controls: string[] | null;
  framework: string;
  requirements: { id: number; code: string; title: string | null; kind: string }[];
  mappings: { requirementId: number; control: string; relationship: string }[];
}

/** Read a stored snapshot, tolerating the v1 bare-array form. */
export function parseSnapshot(raw: unknown): ScopeSnapshot | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    // v1: control codes only. Enough to freeze baseline scope, not requirements.
    return { version: 2, closedAt: "", controls: raw as string[], framework: "", requirements: [], mappings: [] };
  }
  const o = raw as Partial<ScopeSnapshot>;
  if (!o || typeof o !== "object" || !Array.isArray(o.requirements)) return null;
  return {
    version: 2,
    closedAt: o.closedAt ?? "",
    controls: o.controls ?? null,
    framework: o.framework ?? "",
    requirements: o.requirements ?? [],
    mappings: o.mappings ?? [],
  };
}

/** Capture everything a period's findings depend on, at the moment it closes. */
export async function buildScopeSnapshot(framework: string, controls: Set<string> | null): Promise<ScopeSnapshot> {
  const [reqs, maps] = await Promise.all([
    db
      .select({ id: s.requirements.id, code: s.requirements.code, title: s.requirements.title, kind: s.requirements.kind })
      .from(s.requirements)
      .where(eq(s.requirements.frameworkId, framework))
      .orderBy(asc(s.requirements.code)),
    db
      .select({ requirementId: s.mappings.requirementId, control: s.mappings.controlCode, relationship: s.mappings.relationship })
      .from(s.mappings)
      .innerJoin(s.requirements, eq(s.mappings.requirementId, s.requirements.id))
      .where(eq(s.requirements.frameworkId, framework)),
  ]);
  return {
    version: 2,
    closedAt: new Date().toISOString(),
    controls: controls ? Array.from(controls).sort() : null,
    framework,
    requirements: reqs.map((r) => ({ id: r.id, code: r.code, title: r.title, kind: r.kind })),
    mappings: maps,
  };
}

/**
 * Requirement posture for a framework.
 *
 * With `frozen`, the requirement set, the mappings and the attestation cut-off
 * all come from a closed period's snapshot instead of from live tables, so the
 * finding reproduces however much the catalog and crosswalks have moved since.
 */
export async function computeRequirements(fw: string, frozen?: ScopeSnapshot | null) {
  const asOf = frozen?.closedAt ? new Date(frozen.closedAt) : null;
  const [reqs, maps, scoreMap] = frozen && frozen.requirements.length
    ? [
        frozen.requirements,
        frozen.mappings.map((m) => ({ reqId: m.requirementId, control: m.control, relationship: m.relationship })),
        await controlScoreMap(asOf),
      ]
    : await Promise.all([
        db.select().from(s.requirements).where(eq(s.requirements.frameworkId, fw)).orderBy(asc(s.requirements.code)),
        db
          .select({ reqId: s.mappings.requirementId, control: s.mappings.controlCode, relationship: s.mappings.relationship })
          .from(s.mappings)
          .innerJoin(s.requirements, eq(s.mappings.requirementId, s.requirements.id))
          .where(eq(s.requirements.frameworkId, fw)),
        controlScoreMap(asOf),
      ]);
  const byReq = new Map<number, { control: string; relationship: string }[]>();
  for (const m of maps) {
    const arr = byReq.get(m.reqId) ?? byReq.set(m.reqId, []).get(m.reqId)!;
    arr.push({ control: m.control, relationship: m.relationship });
  }
  const summary = { covered: 0, gaps: 0, met: 0, partial: 0, weak: 0, unassessed: 0 };
  const requirements = reqs.map((r) => {
    const mc = byReq.get(r.id) ?? [];
    if (mc.length === 0) {
      summary.gaps++;
      // requirementId is needed HERE most of all: a gap row is exactly where
      // someone maps a control to close it, and omitting the id from this branch
      // meant the "map a control" affordance silently did nothing — the client
      // had no id to send.
      return {
        requirementId: r.id,
        code: r.code,
        title: r.title,
        kind: r.kind,
        status: "gap",
        score: null as number | null,
        mapped: 0,
        assessed: 0,
        mappedControls: [] as any[],
      };
    }
    summary.covered++;
    let num = 0;
    let den = 0;
    let assessedControls = 0;
    const mappedControls = mc.map((m) => {
      const sc = scoreMap.get(m.control) ?? null;
      const w = REL_W[m.relationship] ?? 0.5;
      // An unassessed mapped control contributes 0 and still carries its weight.
      // Previously it was skipped entirely, so a requirement mapped to 21
      // controls with 1 assessed reported that one control's score as the
      // requirement's posture — "met, 100%" on a single data point.
      num += w * (sc ?? 0);
      den += w;
      if (sc != null) assessedControls++;
      return { control: m.control, relationship: m.relationship, score: sc };
    });
    const score = den ? Math.round(num / den) : null;
    // Posture over just what was assessed — shown beside coverage, never instead.
    const assessedOnly = assessedControls
      ? Math.round(
          mappedControls.reduce((a, m) => a + (m.score ?? 0) * (REL_W[m.relationship] ?? 0.5), 0) /
            mappedControls.reduce((a, m) => a + (m.score == null ? 0 : REL_W[m.relationship] ?? 0.5), 0),
        )
      : null;
    let status: string;
    // Nothing assessed stays its own state rather than reading as a hard zero.
    if (assessedControls === 0) (status = "unassessed"), summary.unassessed++;
    else if (score! >= 75) (status = "met"), summary.met++;
    else if (score! >= 50) (status = "partial"), summary.partial++;
    else (status = "weak"), summary.weak++;
    return {
      // The id the client needs to create a mapping against this requirement.
      requirementId: r.id,
      code: r.code,
      title: r.title,
      kind: r.kind,
      status,
      score,
      assessedOnly,
      mapped: mc.length,
      assessed: assessedControls,
      mappedControls,
    };
  });
  // Readiness divides by every requirement in the framework. A requirement that
  // is unmapped (a gap) or mapped-but-unassessed counts as 0, because the
  // alternative — dividing only by what has been assessed — makes the number
  // rise as assessment shrinks.
  const scores = requirements.map((r) => r.score ?? 0);
  const readiness = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const assessedReqs = requirements.filter((r) => (r as any).assessed > 0).length;
  return {
    framework: fw,
    total: reqs.length,
    summary: {
      ...summary,
      readiness,
      // Every render site is expected to print these beside the number.
      assessed: assessedReqs,
      assessedOf: reqs.length,
      coverage: reqs.length ? Math.round((assessedReqs / reqs.length) * 100) : 0,
    },
    requirements,
  };
}

// current score per control, from its latest attestations
export async function controlScoreMap(asOf?: Date | null): Promise<Map<string, number | null>> {
  const att = await latestAttestations(asOf);
  const byControl = new Map<string, Partial<Record<Dimension, Rating>>>();
  for (const [key, a] of att) {
    const [code, dim] = key.split(":");
    const r = byControl.get(code) ?? byControl.set(code, {}).get(code)!;
    r[dim as Dimension] = a.rating as Rating;
  }
  const out = new Map<string, number | null>();
  for (const [code, ratings] of byControl) out.set(code, controlScore(ratings));
  return out;
}
