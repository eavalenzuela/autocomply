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

export const FW_LABEL: Record<string, string> = { nist80053: "NIST 800-53 Rev 5", soc2: "SOC 2", iso27001: "ISO 27001" };

export const REL_W: Record<string, number> = { equivalent: 1, superset: 1, subset: 0.6, partial: 0.6, related: 0.3 };

// latest attestation per (controlCode, dimension). Postgres DISTINCT ON pulls
// exactly one row per key in the database instead of shipping the whole
// append-only table over the wire and deduping in JS on every request.
// (id is the tiebreaker for same-timestamp inserts.)
export async function latestAttestations() {
  const rows = await db
    .selectDistinctOn([s.attestations.controlCode, s.attestations.dimension])
    .from(s.attestations)
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

export async function activePeriodId(): Promise<number | null> {
  const rows = await db
    .select({ id: s.assessmentPeriods.id })
    .from(s.assessmentPeriods)
    .where(eq(s.assessmentPeriods.status, "active"))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function currentPeriod() {
  const rows = await db.select().from(s.assessmentPeriods).orderBy(desc(s.assessmentPeriods.startDate));
  if (rows.length === 0) return null;
  const p = rows.find((r) => r.status === "active") ?? rows[0];
  const days = Math.max(0, Math.round((p.endDate.getTime() - p.startDate.getTime()) / 864e5));
  return {
    name: p.name,
    framework: p.framework,
    frameworkLabel: FW_LABEL[p.framework] ?? p.framework,
    tier: p.tier,
    start: p.startDate.toISOString().slice(0, 10),
    end: p.endDate.toISOString().slice(0, 10),
    days,
    status: p.status,
  };
}

// Reverse roll-up: framework requirements ← mapped controls' scores, + gap report.
// Generic over framework id — it was typed to two while the query was always
// generic, which is how a third framework silently became soc2 at the route.
export async function computeRequirements(fw: string) {
  const [reqs, maps, scoreMap] = await Promise.all([
    db.select().from(s.requirements).where(eq(s.requirements.frameworkId, fw)).orderBy(asc(s.requirements.code)),
    db
      .select({ reqId: s.mappings.requirementId, control: s.mappings.controlCode, relationship: s.mappings.relationship })
      .from(s.mappings)
      .innerJoin(s.requirements, eq(s.mappings.requirementId, s.requirements.id))
      .where(eq(s.requirements.frameworkId, fw)),
    controlScoreMap(),
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
export async function controlScoreMap(): Promise<Map<string, number | null>> {
  const att = await latestAttestations();
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
