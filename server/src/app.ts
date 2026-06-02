import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "./db/index";
import * as s from "./db/schema";
import { controlScore, ratingToGrade, DIMENSIONS, type Dimension, type Rating } from "./scoring";
import {
  currentUser,
  canWrite,
  canWriteControl,
  verifyPassword,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  hasFreshStepUp,
  recordStepUp,
  sessionToken,
  STEP_UP_TTL_MS,
  SESSION_COOKIE,
} from "./auth";
import { registerOAuth } from "./oauth";
import { buildCatalog, recordCatalogExport, lastCatalogExportAt } from "./catalog";

const RATINGS: Rating[] = ["nc", "sc", "pc", "mc", "fc"];

// latest attestation per (controlCode, dimension)
async function latestAttestations() {
  const rows = await db.select().from(s.attestations).orderBy(desc(s.attestations.createdAt));
  const map = new Map<string, (typeof rows)[number]>();
  for (const a of rows) {
    const key = `${a.controlCode}:${a.dimension}`;
    if (!map.has(key)) map.set(key, a);
  }
  return map;
}

const REL_W: Record<string, number> = { equivalent: 1, superset: 1, subset: 0.6, partial: 0.6, related: 0.3 };

// Reverse roll-up: framework requirements ← mapped controls' scores, + gap report.
async function computeRequirements(fw: "soc2" | "iso27001") {
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
      return { code: r.code, title: r.title, kind: r.kind, status: "gap", score: null as number | null, mapped: 0, mappedControls: [] as any[] };
    }
    summary.covered++;
    let num = 0;
    let den = 0;
    const mappedControls = mc.map((m) => {
      const sc = scoreMap.get(m.control) ?? null;
      const w = REL_W[m.relationship] ?? 0.5;
      if (sc != null) {
        num += w * sc;
        den += w;
      }
      return { control: m.control, relationship: m.relationship, score: sc };
    });
    const score = den ? Math.round(num / den) : null;
    let status: string;
    if (score == null) (status = "unassessed"), summary.unassessed++;
    else if (score >= 75) (status = "met"), summary.met++;
    else if (score >= 50) (status = "partial"), summary.partial++;
    else (status = "weak"), summary.weak++;
    return { code: r.code, title: r.title, kind: r.kind, status, score, mapped: mc.length, mappedControls };
  });
  const assessed = requirements.filter((r) => r.score != null).map((r) => r.score as number);
  const readiness = assessed.length ? Math.round(assessed.reduce((a, b) => a + b, 0) / assessed.length) : null;
  return { framework: fw, total: reqs.length, summary: { ...summary, readiness }, requirements };
}

// current score per control, from its latest attestations
async function controlScoreMap(): Promise<Map<string, number | null>> {
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

export async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie);
  registerOAuth(app);

  app.get("/api/health", async () => ({ ok: true, ts: new Date().toISOString() }));

  // ---- auth ----
  app.post<{ Body: { email: string; password: string } }>("/api/login", async (req, reply) => {
    const { email, password } = req.body ?? {};
    const u = (await db.select().from(s.users).where(eq(s.users.email, email)).limit(1))[0];
    if (!u || !verifyPassword(password, u.passwordHash)) return reply.code(401).send({ error: "invalid credentials" });
    if (u.expiresAt && u.expiresAt.getTime() < Date.now()) return reply.code(403).send({ error: "account expired" });
    const token = await createSession(u.id);
    setSessionCookie(reply, token);
    await db.insert(s.auditLog).values({ actorId: u.id, action: "login", targetType: "user", targetId: u.email });
    return { id: u.id, email: u.email, name: u.name, role: u.role, authProvider: u.authProvider };
  });

  app.post("/api/logout", async (req, reply) => {
    const token = (req as any).cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) await destroySession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/me", async (req) => {
    const u = await currentUser(req);
    return u ?? { error: "no user" };
  });

  // Step-up re-auth: re-verify the signed-in user's password, stamping the
  // session so sensitive actions (attest / approve / export) are allowed for a
  // short window. MFA itself is delegated to the IdP for SSO accounts.
  app.post<{ Body: { password: string } }>("/api/step-up", async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const token = sessionToken(req);
    if (!token) return reply.code(400).send({ error: "step-up requires an interactive session" });
    const u = (await db.select().from(s.users).where(eq(s.users.id, user.id)).limit(1))[0];
    if (!u?.passwordHash) return reply.code(400).send({ error: "step-up requires re-authentication with your identity provider" });
    if (!verifyPassword(req.body?.password ?? "", u.passwordHash)) return reply.code(401).send({ error: "incorrect password" });
    await recordStepUp(token);
    await db.insert(s.auditLog).values({ actorId: user.id, action: "step-up", targetType: "session" });
    return { ok: true, expiresInMs: STEP_UP_TTL_MS };
  });

  app.get("/api/matrix", async () => {
    const [cats, ctrls, maps, fw] = await Promise.all([
      db.select().from(s.controlCategories).orderBy(asc(s.controlCategories.id)),
      db.select().from(s.controls).orderBy(asc(s.controls.code)),
      db
        .select({ controlCode: s.mappings.controlCode, code: s.requirements.code })
        .from(s.mappings)
        .innerJoin(s.requirements, eq(s.mappings.requirementId, s.requirements.id)),
      db.select().from(s.frameworks),
    ]);
    const att = await latestAttestations();

    const xwalk = new Map<string, string[]>();
    for (const m of maps) {
      const arr = xwalk.get(m.controlCode);
      if (arr) arr.push(m.code);
      else xwalk.set(m.controlCode, [m.code]);
    }

    const byCat = new Map<string, any[]>();
    for (const c of ctrls) {
      const ratings: Partial<Record<Dimension, Rating>> = {};
      const cells = DIMENSIONS.map((d) => {
        const a = att.get(`${c.code}:${d}`);
        if (a) ratings[d] = a.rating as Rating;
        return { dim: d, grade: ratingToGrade((a?.rating as Rating) ?? null), marker: a?.marker ?? null };
      });
      const list = byCat.get(c.categoryId) ?? byCat.set(c.categoryId, []).get(c.categoryId)!;
      list.push({
        id: c.code,
        name: c.title,
        crosswalk: (xwalk.get(c.code) ?? []).sort(),
        cells,
        score: controlScore(ratings),
        evidence: { age: null, tag: null, label: null },
        docs: 0,
        owner: null,
      });
    }

    const domains = cats.map((cat, i) => {
      const controls = byCat.get(cat.id) ?? [];
      const scored = controls.map((c) => c.score).filter((x): x is number => x != null);
      const score = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null;
      const gate = score != null ? Math.round((score / 20) * 10) / 10 : null; // 0–5 scale
      return {
        id: cat.id,
        name: cat.title,
        score,
        gate,
        gateFail: gate != null && gate < 3.0,
        owner: null,
        open: i === 0,
        controls,
      };
    });

    return {
      summary: {
        controlsTotal: ctrls.length,
        categories: cats.length,
        frameworks: fw.map((f) => f.id),
        mappingLinks: maps.length,
      },
      domains,
    };
  });

  // Control detail for the drawer.
  app.get<{ Params: { code: string } }>("/api/control/:code", async (req, reply) => {
    const code = req.params.code;
    const ctrl = (await db.select().from(s.controls).where(eq(s.controls.code, code)).limit(1))[0];
    if (!ctrl) return reply.code(404).send({ error: "not found" });
    const cat = (await db.select().from(s.controlCategories).where(eq(s.controlCategories.id, ctrl.categoryId)).limit(1))[0];
    const history = await db.select().from(s.attestations).where(eq(s.attestations.controlCode, code)).orderBy(desc(s.attestations.createdAt));
    const evidence = await db.select().from(s.evidenceItems).where(eq(s.evidenceItems.controlCode, code));
    const maps = await db
      .select({ code: s.requirements.code, framework: s.requirements.frameworkId, relationship: s.mappings.relationship, confidence: s.mappings.confidence })
      .from(s.mappings)
      .innerJoin(s.requirements, eq(s.mappings.requirementId, s.requirements.id))
      .where(eq(s.mappings.controlCode, code));
    return { control: { id: ctrl.code, name: ctrl.title, domain: `${cat?.id} · ${cat?.title}` }, crosswalk: maps, attestations: history, evidence };
  });

  // Create an attestation (append-only). RBAC + assignment-scoping enforced.
  app.post<{ Body: { control: string; dimension: Dimension; rating: Rating; justification?: string; marker?: string } }>(
    "/api/attest",
    async (req, reply) => {
      const user = await currentUser(req);
      if (!user) return reply.code(401).send({ error: "unauthenticated" });
      const { control, dimension, rating, justification, marker } = req.body;
      if (!DIMENSIONS.includes(dimension)) return reply.code(400).send({ error: "bad dimension" });
      if (!RATINGS.includes(rating)) return reply.code(400).send({ error: "bad rating" });
      if (!(await canWriteControl(user, control))) return reply.code(403).send({ error: "forbidden (role or assignment scope)" });
      if (!(await hasFreshStepUp(req))) return reply.code(403).send({ error: "re-authentication required", code: "step_up_required" });

      const [row] = await db
        .insert(s.attestations)
        .values({ controlCode: control, dimension, rating, justification: justification ?? null, marker: marker ?? null, actorId: user.id, source: "human" })
        .returning();
      await db.insert(s.auditLog).values({ actorId: user.id, action: "attest", targetType: "control", targetId: `${control}:${dimension}`, payload: { rating } });
      return { ok: true, attestation: row };
    },
  );

  // Worklist v2 — composed, prioritized tasks (clock-starters, drift, coverage
  // gaps, AWS confirm, maturity dependencies, expiring/pending exceptions).
  app.get("/api/worklist", async () => {
    const [ctrls, att, excs] = await Promise.all([
      db.select().from(s.controls).orderBy(asc(s.controls.code)),
      latestAttestations(),
      db.select().from(s.exceptions),
    ]);
    const tasks: any[] = [];
    for (const c of ctrls) {
      const dims = DIMENSIONS.map((d) => att.get(`${c.code}:${d}`));
      const impl = att.get(`${c.code}:impl`);
      const pol = att.get(`${c.code}:pol`);
      const drift = dims.find((a) => a?.marker === "drift");
      // Specific in-flight issues rank above the generic "never assessed" bulk.
      if (drift) tasks.push({ control: c.code, name: c.title, type: "re-attest-drift", reason: `${drift.dimension.toUpperCase()} evidence drifted — re-attest`, priority: 88 });
      if (!impl) tasks.push({ control: c.code, name: c.title, type: "rate-implemented", reason: "No Implemented rating yet — needs initial assessment", priority: 50 });
      else if (impl.marker === "gap") tasks.push({ control: c.code, name: c.title, type: "remediate-coverage", reason: "Coverage gap → scored NC; restore collection (clock-starter)", priority: 84 });
      else if (impl.marker === "aws") tasks.push({ control: c.code, name: c.title, type: "confirm-aws", reason: "AWS-suggested rating awaiting confirmation", priority: 70 });
      if (impl && !pol) tasks.push({ control: c.code, name: c.title, type: "document-policy", reason: "Implemented but no Policy evidence (PRISMA dependency)", priority: 46 });
    }
    const now = Date.now();
    for (const e of excs) {
      if (e.status === "pending") tasks.push({ control: e.controlCode, name: `Exception: ${e.reason.slice(0, 60)}`, type: "approve-exception", reason: "Exception awaiting approval (SoD: needs a different approver)", priority: 78 });
      else if (e.status === "approved" && e.expiresAt && e.expiresAt.getTime() - now < 14 * 864e5)
        tasks.push({ control: e.controlCode, name: `Exception expiring`, type: "exception-expiring", reason: `Risk acceptance expires ${e.expiresAt.toISOString().slice(0, 10)}`, priority: 72 });
    }
    tasks.sort((a, b) => b.priority - a.priority);
    return { count: tasks.length, tasks: tasks.slice(0, 80) };
  });

  // Evidence library.
  app.get("/api/evidence", async () => {
    const rows = await db.select().from(s.evidenceItems).orderBy(asc(s.evidenceItems.controlCode));
    return { count: rows.length, evidence: rows };
  });

  // Exceptions list.
  app.get("/api/exceptions", async () => {
    const rows = await db.select().from(s.exceptions).orderBy(desc(s.exceptions.createdAt));
    const users = await db.select().from(s.users);
    const name = (id: number | null) => users.find((u) => u.id === id)?.name ?? null;
    return { count: rows.length, exceptions: rows.map((e) => ({ ...e, requestedByName: name(e.requestedBy), approvedByName: name(e.approvedBy) })) };
  });

  // Request an exception.
  app.post<{ Body: { control: string; dimension?: string; reason: string; expiresAt?: string } }>("/api/exception", async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    if (!canWrite(user.role)) return reply.code(403).send({ error: "forbidden" });
    const { control, dimension, reason, expiresAt } = req.body;
    if (!reason) return reply.code(400).send({ error: "reason required" });
    const [row] = await db
      .insert(s.exceptions)
      .values({ controlCode: control, dimension: dimension ?? null, reason, status: "pending", requestedBy: user.id, expiresAt: expiresAt ? new Date(expiresAt) : null })
      .returning();
    await db.insert(s.auditLog).values({ actorId: user.id, action: "exception-request", targetType: "control", targetId: control, payload: { id: row.id } });
    return { ok: true, exception: row };
  });

  // Approve / reject an exception — SoD: approver must differ from requester.
  app.post<{ Params: { id: string }; Body: { decision: "approve" | "reject" } }>("/api/exception/:id/decide", async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    if (user.role !== "admin" && user.role !== "compliance_manager") return reply.code(403).send({ error: "only admin/compliance_manager can decide exceptions" });
    const id = Number(req.params.id);
    const exc = (await db.select().from(s.exceptions).where(eq(s.exceptions.id, id)).limit(1))[0];
    if (!exc) return reply.code(404).send({ error: "not found" });
    if (exc.requestedBy === user.id) return reply.code(403).send({ error: "separation of duties: the requester cannot approve their own exception" });
    if (!(await hasFreshStepUp(req))) return reply.code(403).send({ error: "re-authentication required", code: "step_up_required" });
    const status = req.body.decision === "approve" ? "approved" : "rejected";
    const [row] = await db.update(s.exceptions).set({ status, approvedBy: user.id, decidedAt: new Date() }).where(eq(s.exceptions.id, id)).returning();
    await db.insert(s.auditLog).values({ actorId: user.id, action: `exception-${status}`, targetType: "control", targetId: exc.controlCode, payload: { id } });
    return { ok: true, exception: row };
  });

  // Reverse roll-up: framework requirements ← mapped controls' status, + gap report.
  app.get<{ Querystring: { framework?: string } }>("/api/requirements", async (req) => {
    return computeRequirements(req.query.framework === "iso27001" ? "iso27001" : "soc2");
  });

  // Auditor evidence package — the report you hand an assessor. Viewing is open
  // (UI gates it behind login); exporting (?export=1) is a sensitive action:
  // requires auth + a fresh step-up and is audit-logged.
  app.get<{ Querystring: { framework?: string; export?: string } }>("/api/report", async (req, reply) => {
    const me = await currentUser(req);
    const fw = req.query.framework === "iso27001" ? "iso27001" : "soc2";
    const fwName = fw === "iso27001" ? "ISO/IEC 27001:2022" : "SOC 2 (TSC 2017)";
    const isExport = req.query.export === "1" || req.query.export === "true";
    if (isExport) {
      if (!me) return reply.code(401).send({ error: "unauthenticated" });
      if (!(await hasFreshStepUp(req))) return reply.code(403).send({ error: "re-authentication required", code: "step_up_required" });
      await db.insert(s.auditLog).values({ actorId: me.id, action: "report-export", targetType: "framework", targetId: fw });
    }
    const reqData = await computeRequirements(fw);
    const [att, scoreMap, ctrls, evidence, maps, excs] = await Promise.all([
      latestAttestations(),
      controlScoreMap(),
      db.select().from(s.controls).orderBy(asc(s.controls.code)),
      db.select().from(s.evidenceItems),
      db
        .select({ control: s.mappings.controlCode, code: s.requirements.code })
        .from(s.mappings)
        .innerJoin(s.requirements, eq(s.mappings.requirementId, s.requirements.id))
        .where(eq(s.requirements.frameworkId, fw)),
      db.select().from(s.exceptions),
    ]);
    const xwalk = new Map<string, string[]>();
    for (const m of maps) {
      const arr = xwalk.get(m.control) ?? xwalk.set(m.control, []).get(m.control)!;
      arr.push(m.code);
    }
    // controls that contribute to this framework, with ratings + evidence
    const controls = ctrls
      .filter((c) => xwalk.has(c.code))
      .map((c) => ({
        code: c.code,
        title: c.title,
        score: scoreMap.get(c.code) ?? null,
        crosswalk: (xwalk.get(c.code) ?? []).sort(),
        ratings: DIMENSIONS.map((d) => {
          const a = att.get(`${c.code}:${d}`);
          return { dim: d, rating: a?.rating ?? null, marker: a?.marker ?? null, source: a?.source ?? null };
        }),
        evidence: evidence.filter((e) => e.controlCode === c.code).map((e) => ({ title: e.title, kind: e.kind, sourceType: e.sourceType, contentHash: e.contentHash, drifted: e.drifted })),
      }));
    return {
      meta: {
        org: "autocomply",
        framework: fwName,
        period: { start: "2026-02-20", end: "2026-05-21", days: 90 },
        generatedAt: new Date().toISOString(),
        generatedBy: me?.name ?? "system",
      },
      readiness: reqData.summary,
      requirements: reqData.requirements,
      controls,
      gaps: reqData.requirements.filter((r) => r.status === "gap").map((r) => ({ code: r.code, title: r.title, kind: r.kind })),
      exceptions: excs.map((e) => ({ control: e.controlCode, reason: e.reason, status: e.status, expiresAt: e.expiresAt })),
    };
  });

  // Computed notifications feed (what a real notifier would send).
  app.get("/api/notifications", async () => {
    const [att, evidence, excs] = await Promise.all([
      latestAttestations(),
      db.select().from(s.evidenceItems),
      db.select().from(s.exceptions),
    ]);
    const items: any[] = [];
    for (const ev of evidence) if (ev.drifted) items.push({ kind: "drift", text: `${ev.controlCode} — ${ev.kind} doc drifted; re-attest needed`, severity: "warn" });
    for (const [key, a] of att) if (a.marker === "gap") items.push({ kind: "coverage-gap", text: `${key.split(":")[0]} — coverage gap → scored NC`, severity: "bad" });
    const now = Date.now();
    for (const e of excs) {
      if (e.status === "pending") items.push({ kind: "exception-pending", text: `${e.controlCode} — exception awaiting approval`, severity: "info" });
      else if (e.status === "approved" && e.expiresAt && e.expiresAt.getTime() - now < 14 * 864e5) items.push({ kind: "exception-expiring", text: `${e.controlCode} — risk acceptance expires ${e.expiresAt.toISOString().slice(0, 10)}`, severity: "warn" });
    }
    return { count: items.length, items };
  });

  // ---- integrations / collector health ----
  app.get("/api/integrations", async () => {
    const [checks, runs, findings, evidence, fwRows, reqRows, ctrlRows, mapRows, lastExport] = await Promise.all([
      db.select().from(s.checks),
      db.select().from(s.checkRuns).orderBy(desc(s.checkRuns.startedAt)),
      db.select().from(s.automatedFindings),
      db.select().from(s.evidenceItems),
      db.select({ id: s.frameworks.id }).from(s.frameworks),
      db.select({ id: s.requirements.id }).from(s.requirements),
      db.select({ code: s.controls.code }).from(s.controls),
      db.select({ id: s.mappings.id }).from(s.mappings),
      lastCatalogExportAt(),
    ]);
    const latestRun = new Map<string, (typeof runs)[number]>();
    for (const r of runs) if (!latestRun.has(r.checkKey)) latestRun.set(r.checkKey, r);
    const findingsByRun = new Map<number, { total: number; pass: number }>();
    for (const f of findings) {
      const e = findingsByRun.get(f.checkRunId) ?? { total: 0, pass: 0 };
      e.total++;
      if (f.result === "pass") e.pass++;
      findingsByRun.set(f.checkRunId, e);
    }
    const kinds = new Map<string, { checks: number; findings: number; pass: number; lastRun: Date | null; statuses: string[]; coverageOk: number }>();
    for (const c of checks) {
      const k = kinds.get(c.sourceKind) ?? { checks: 0, findings: 0, pass: 0, lastRun: null, statuses: [], coverageOk: 0 };
      k.checks++;
      const run = latestRun.get(c.key);
      if (run) {
        k.statuses.push(run.status);
        if (run.status === "complete") k.coverageOk++;
        if (!k.lastRun || run.startedAt > k.lastRun) k.lastRun = run.startedAt;
        const fb = findingsByRun.get(run.id);
        if (fb) {
          k.findings += fb.total;
          k.pass += fb.pass;
        }
      }
      kinds.set(c.sourceKind, k);
    }
    const connectors = [...kinds.entries()].map(([kind, k]) => ({
      name: kind,
      type: "aws" as const,
      checks: k.checks,
      lastRun: k.lastRun,
      status: k.statuses.every((x) => x === "complete") ? "healthy" : "degraded",
      findings: k.findings,
      passRate: k.findings ? Math.round((k.pass / k.findings) * 100) : null,
      coverage: `${k.coverageOk}/${k.checks} checks complete`,
    }));
    const docs = evidence.filter((e) => e.sourceType === "doc");
    connectors.push({
      name: "document sources",
      type: "doc" as any,
      checks: docs.length,
      lastRun: docs.reduce<Date | null>((m, e) => (!m || e.collectedAt > m ? e.collectedAt : m), null),
      status: docs.some((e) => e.drifted) ? "degraded" : "healthy",
      findings: docs.length,
      passRate: docs.length ? Math.round(((docs.length - docs.filter((e) => e.drifted).length) / docs.length) * 100) : null,
      coverage: `${docs.filter((e) => e.drifted).length} drifted`,
    });
    // GRCen catalog export (read-only projection consumed by the sibling tool).
    const catalog = {
      frameworks: fwRows.length,
      requirements: reqRows.length,
      controls: ctrlRows.length,
      satisfies: mapRows.length,
      lastExport,
    };
    return { connectors, catalog };
  });

  // ---- controls (CCF) library ----
  app.get("/api/controls", async () => {
    const [cats, ctrls, objs, maps, scoreMap] = await Promise.all([
      db.select().from(s.controlCategories).orderBy(asc(s.controlCategories.id)),
      db.select().from(s.controls).orderBy(asc(s.controls.code)),
      db.select().from(s.controlObjectives),
      db
        .select({ control: s.mappings.controlCode, fw: s.requirements.frameworkId })
        .from(s.mappings)
        .innerJoin(s.requirements, eq(s.mappings.requirementId, s.requirements.id)),
      controlScoreMap(),
    ]);
    const objTitle = new Map(objs.map((o) => [o.code, o.title]));
    const xw = new Map<string, { soc2: number; iso27001: number }>();
    for (const m of maps) {
      const e = xw.get(m.control) ?? { soc2: 0, iso27001: 0 };
      (e as any)[m.fw]++;
      xw.set(m.control, e);
    }
    return {
      categories: cats,
      controls: ctrls.map((c) => ({
        code: c.code,
        title: c.title,
        category: c.categoryId,
        objective: c.objectiveCode ? `${c.objectiveCode} ${objTitle.get(c.objectiveCode) ?? ""}`.trim() : null,
        score: scoreMap.get(c.code) ?? null,
        soc2: xw.get(c.code)?.soc2 ?? 0,
        iso27001: xw.get(c.code)?.iso27001 ?? 0,
      })),
    };
  });

  // ---- GRCen catalog export (read-only projection; see GRCEN_CATALOG_EXPORT.md) ----
  app.get("/api/catalog", async (req) => {
    const { catalog, droppedSatisfies } = await buildCatalog(new Date().toISOString());
    if (droppedSatisfies > 0) {
      app.log.warn(`catalog export dropped ${droppedSatisfies} mapping(s) to unknown requirements`);
    }
    const me = await currentUser(req);
    await recordCatalogExport(me?.id ?? null, "api");
    return catalog;
  });

  // ---- assessment periods ----
  app.get("/api/periods", async () => {
    const rows = await db.select().from(s.assessmentPeriods).orderBy(desc(s.assessmentPeriods.startDate));
    return { periods: rows };
  });
  app.post<{ Body: { name: string; framework: string; tier?: string; startDate: string; endDate: string; tscCategories?: string[] } }>("/api/periods", async (req, reply) => {
    const me = await currentUser(req);
    if (!me || (me.role !== "admin" && me.role !== "compliance_manager")) return reply.code(403).send({ error: "forbidden" });
    const b = req.body;
    if (!b.name || !b.framework || !b.startDate || !b.endDate) return reply.code(400).send({ error: "missing fields" });
    const [row] = await db
      .insert(s.assessmentPeriods)
      .values({ name: b.name, framework: b.framework, tier: b.tier ?? null, startDate: new Date(b.startDate), endDate: new Date(b.endDate), status: "planning", tscCategories: b.tscCategories ?? null })
      .returning();
    await db.insert(s.auditLog).values({ actorId: me.id, action: "period-create", targetType: "period", targetId: String(row.id) });
    return { ok: true, period: row };
  });
  app.post<{ Params: { id: string }; Body: { status: string } }>("/api/periods/:id/status", async (req, reply) => {
    const me = await currentUser(req);
    if (!me || (me.role !== "admin" && me.role !== "compliance_manager")) return reply.code(403).send({ error: "forbidden" });
    if (!["planning", "active", "closed"].includes(req.body.status)) return reply.code(400).send({ error: "bad status" });
    const [row] = await db.update(s.assessmentPeriods).set({ status: req.body.status }).where(eq(s.assessmentPeriods.id, Number(req.params.id))).returning();
    return { ok: true, period: row };
  });

  // ---- admin: users + assignments ----
  app.get("/api/users", async (req, reply) => {
    const me = await currentUser(req);
    if (!me || (me.role !== "admin" && me.role !== "compliance_manager")) return reply.code(403).send({ error: "forbidden" });
    const users = await db.select().from(s.users).orderBy(asc(s.users.id));
    const assigns = await db.select().from(s.controlAssignments);
    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        expiresAt: u.expiresAt,
        assignments: assigns.filter((a) => a.userId === u.id).map((a) => a.controlCode).sort(),
      })),
    };
  });

  app.post<{ Params: { id: string }; Body: { role: string } }>("/api/users/:id/role", async (req, reply) => {
    const me = await currentUser(req);
    if (!me || me.role !== "admin") return reply.code(403).send({ error: "only admin can change roles" });
    const roles = ["admin", "compliance_manager", "control_owner", "auditor", "viewer"];
    if (!roles.includes(req.body.role)) return reply.code(400).send({ error: "bad role" });
    const [row] = await db.update(s.users).set({ role: req.body.role }).where(eq(s.users.id, Number(req.params.id))).returning();
    await db.insert(s.auditLog).values({ actorId: me.id, action: "role-change", targetType: "user", targetId: String(req.params.id), payload: { role: req.body.role } });
    return { ok: true, user: { id: row.id, role: row.role } };
  });

  app.post<{ Body: { userId: number; control: string } }>("/api/assign", async (req, reply) => {
    const me = await currentUser(req);
    if (!me || (me.role !== "admin" && me.role !== "compliance_manager")) return reply.code(403).send({ error: "forbidden" });
    const { userId, control } = req.body;
    const existing = await db.select().from(s.controlAssignments).where(and(eq(s.controlAssignments.userId, userId), eq(s.controlAssignments.controlCode, control)));
    if (existing.length === 0) await db.insert(s.controlAssignments).values({ userId, controlCode: control });
    await db.insert(s.auditLog).values({ actorId: me.id, action: "assign", targetType: "control", targetId: control, payload: { userId } });
    return { ok: true };
  });

  app.post<{ Body: { userId: number; control: string } }>("/api/unassign", async (req, reply) => {
    const me = await currentUser(req);
    if (!me || (me.role !== "admin" && me.role !== "compliance_manager")) return reply.code(403).send({ error: "forbidden" });
    const { userId, control } = req.body;
    await db.delete(s.controlAssignments).where(and(eq(s.controlAssignments.userId, userId), eq(s.controlAssignments.controlCode, control)));
    await db.insert(s.auditLog).values({ actorId: me.id, action: "unassign", targetType: "control", targetId: control, payload: { userId } });
    return { ok: true };
  });

  return app;
}
