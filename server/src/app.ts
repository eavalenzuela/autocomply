import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { db } from "./db/index";
import * as s from "./db/schema";
import { controlScore, ratingToGrade, COVERAGE_FLOOR, DIMENSIONS, type Dimension, type Rating } from "./scoring";
import { recordAudit, recordSecurityEvent } from "./audit";
import {
  idParam, codeParam, loginBody, stepUpBody, passwordBody, attestBody, exceptionBody,
  decideBody, soaBody, roleBody, tokenBody, assignBody, frameworkQuery, periodBody,
  periodStatusBody,
} from "./schemas";
import { RateLimiter } from "./ratelimit";
import {
  currentUser,
  canWrite,
  canWriteControl,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  revokeOtherSessions,
  setSessionCookie,
  clearSessionCookie,
  hasFreshStepUp,
  recordStepUp,
  sessionToken,
  generateApiToken,
  STEP_UP_TTL_MS,
  SESSION_COOKIE,
} from "./auth";
import { registerOAuth } from "./oauth";
import { buildCatalog, recordCatalogExport, lastCatalogExportAt, deriveCrosswalks } from "./catalog";
import { deliverNotifications, type NotifyEvent } from "./notify";

const RATINGS: Rating[] = ["nc", "sc", "pc", "mc", "fc"];

// latest attestation per (controlCode, dimension). Postgres DISTINCT ON pulls
// exactly one row per key in the database instead of shipping the whole
// append-only table over the wire and deduping in JS on every request.
// (id is the tiebreaker for same-timestamp inserts.)
async function latestAttestations() {
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
async function controlExists(code: string | undefined): Promise<boolean> {
  if (!code) return false;
  const rows = await db.select({ code: s.controls.code }).from(s.controls).where(eq(s.controls.code, code)).limit(1);
  return rows.length > 0;
}

const REL_W: Record<string, number> = { equivalent: 1, superset: 1, subset: 0.6, partial: 0.6, related: 0.3 };

const FW_LABEL: Record<string, string> = { nist80053: "NIST 800-53 Rev 5", soc2: "SOC 2", iso27001: "ISO 27001" };

// The org's current assessment window. Prefer an active period (the live cycle),
// else the most recent. Drives the report/header period instead of hardcoded dates.
async function currentPeriod() {
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

// In-scope control set for an 800-53 tier (low|moderate|high). Baselines are stored
// cumulatively, so membership in `tier` already includes the lower tiers. A null tier
// (e.g. a non-NIST active period, or none) means no scoping — all controls in scope.
async function inScopeCodes(tier: string | null | undefined): Promise<Set<string> | null> {
  if (!tier) return null;
  const rows = await db.select({ code: s.controlBaselines.controlCode }).from(s.controlBaselines).where(eq(s.controlBaselines.baseline, tier));
  return new Set(rows.map((r) => r.code));
}

function ownerInitials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

// A family fails its certification gate if a single in-scope assessed control falls below
// Partially-Compliant (50) — averages alone let strong policy/process dimensions mask a
// control whose Implemented dimension is non-compliant (e.g. a coverage gap → NC).
const GATE_FLOOR = 50;

// Brute-force throttle for the credential-bearing endpoints (login / step-up /
// password change): 10 attempts / 5 min / IP. Self-pruning — see ratelimit.ts.
const authLimiter = new RateLimiter(10, 5 * 60_000);

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
  // Logging was off entirely, which made every other failure in this service
  // invisible: no request line, no error, no trace of a rejected login. Set
  // LOG_LEVEL=silent to opt out (the test suite does).
  const app = Fastify({
    logger:
      process.env.LOG_LEVEL === "silent"
        ? false
        : {
            level: process.env.LOG_LEVEL ?? "info",
            // Never log the things that would turn the log into a credential store.
            redact: {
              paths: [
                "req.headers.cookie",
                "req.headers.authorization",
                'res.headers["set-cookie"]',
              ],
              remove: true,
            },
          },
    trustProxy: true,
  });

  // Unhandled throws previously fell through to Fastify's default, which returns
  // the error message to the caller. Drizzle's messages embed the full statement
  // and its bound parameters, so a malformed id handed the caller the query. Log
  // the detail; return a generic body.
  app.setErrorHandler((err: any, req, reply) => {
    const status = err?.statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err, method: req.method, url: req.url }, "request failed");
      return reply.code(500).send({ error: "internal error" });
    }
    // 4xx raised by Fastify itself (bad JSON, validation) — safe to pass through,
    // still worth recording.
    req.log.warn({ method: req.method, url: req.url, status, msg: err?.message }, "request rejected");
    return reply.code(status).send({ error: err?.message ?? "bad request" });
  });
  // Same-origin in production (frontend + API both behind Caddy). Reflect the
  // configured origin when set, else any origin (dev). Cookies need credentials.
  const corsOrigin = process.env.OAUTH_BASE_URL ? [process.env.OAUTH_BASE_URL] : true;
  await app.register(cors, { origin: corsOrigin, credentials: true });
  await app.register(cookie);
  registerOAuth(app);

  // Global auth gate: every /api route requires a logged-in user except the
  // login/session-bootstrap allowlist. Write routes keep their own finer-grained
  // role/scope checks; this just stops anonymous reads of the org's posture.
  const PUBLIC_PATHS = new Set(["/api/health", "/api/login", "/api/logout", "/api/me"]);
  app.addHook("preHandler", async (req, reply) => {
    const path = req.url.split("?")[0];
    if (!path.startsWith("/api/")) return;
    if (PUBLIC_PATHS.has(path) || path.startsWith("/api/auth/")) return;
    if (!(await currentUser(req))) return reply.code(401).send({ error: "unauthenticated" });
  });

  // Real health check: ping the database so the deploy stack's probes actually
  // mean something. 503 (not ok) when Postgres is unreachable.
  app.get("/api/health", async (req, reply) => {
    const t0 = Date.now();
    try {
      await db.execute(sql`select 1`);
      return { ok: true, db: true, latencyMs: Date.now() - t0, ts: new Date().toISOString() };
    } catch {
      return reply.code(503).send({ ok: false, db: false, ts: new Date().toISOString() });
    }
  });

  // ---- auth ----
  app.post<{ Body: { email: string; password: string } }>("/api/login", { schema: { body: loginBody } }, async (req, reply) => {
    const { email, password } = req.body ?? {};
    // Denials are audited too. A trail that records only successful logins
    // cannot show a brute-force attempt, a credential-stuffing run, or an
    // account being probed — the events most worth having afterwards.
    if (!authLimiter.allow(`login:${req.ip}`)) {
      await recordSecurityEvent(req, null, {
        action: "login-throttled",
        targetType: "user",
        targetId: typeof email === "string" ? email.slice(0, 64) : null,
      });
      return reply.code(429).send({ error: "too many attempts — try again in a few minutes" });
    }
    const u = (await db.select().from(s.users).where(eq(s.users.email, email)).limit(1))[0];
    if (!u || !verifyPassword(password, u.passwordHash)) {
      await recordSecurityEvent(req, u ?? null, {
        action: "login-failed",
        targetType: "user",
        targetId: typeof email === "string" ? email.slice(0, 64) : null,
        // Distinguishes "no such account" from "wrong password" for the
        // operator without telling the caller which it was.
        payload: { reason: u ? "bad-password" : "unknown-account" },
      });
      return reply.code(401).send({ error: "invalid credentials" });
    }
    if (u.expiresAt && u.expiresAt.getTime() < Date.now()) {
      await recordSecurityEvent(req, u, { action: "login-denied", targetType: "user", targetId: u.email, payload: { reason: "expired" } });
      return reply.code(403).send({ error: "account expired" });
    }
    const token = await createSession(u.id);
    setSessionCookie(reply, token);
    await recordAudit(db, req, u, { action: "login", targetType: "user", targetId: u.email });
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
  app.post<{ Body: { password: string } }>("/api/step-up", { schema: { body: stepUpBody } }, async (req, reply) => {
    if (!authLimiter.allow(`stepup:${req.ip}`))
      return reply.code(429).send({ error: "too many attempts — try again in a few minutes" });
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const token = sessionToken(req);
    if (!token) return reply.code(400).send({ error: "step-up requires an interactive session" });
    const u = (await db.select().from(s.users).where(eq(s.users.id, user.id)).limit(1))[0];
    if (!u?.passwordHash) return reply.code(400).send({ error: "step-up requires re-authentication with your identity provider" });
    if (!verifyPassword(req.body?.password ?? "", u.passwordHash)) return reply.code(401).send({ error: "incorrect password" });
    await recordStepUp(token);
    await recordAudit(db, req, user, { action: "step-up", targetType: "session" });
    return { ok: true, expiresInMs: STEP_UP_TTL_MS };
  });

  // Local-account password change. Verifies the current password, enforces a
  // minimum length (NIST 800-63B floor), and revokes the user's other sessions so
  // a stolen session elsewhere doesn't survive the rotation. SSO accounts manage
  // credentials at their IdP.
  const MIN_PASSWORD_LEN = 8;
  app.post<{ Body: { currentPassword: string; newPassword: string } }>("/api/me/password", { schema: { body: passwordBody } }, async (req, reply) => {
    if (!authLimiter.allow(`pwchange:${req.ip}`))
      return reply.code(429).send({ error: "too many attempts — try again in a few minutes" });
    const me = await currentUser(req);
    if (!me) return reply.code(401).send({ error: "unauthenticated" });
    const u = (await db.select().from(s.users).where(eq(s.users.id, me.id)).limit(1))[0];
    if (!u?.passwordHash || u.authProvider !== "local")
      return reply.code(400).send({ error: "password change is only available for local accounts" });
    const { currentPassword, newPassword } = req.body ?? {};
    if (!verifyPassword(currentPassword ?? "", u.passwordHash)) return reply.code(401).send({ error: "current password is incorrect" });
    if (!newPassword || newPassword.length < MIN_PASSWORD_LEN)
      return reply.code(400).send({ error: `new password must be at least ${MIN_PASSWORD_LEN} characters` });
    if (newPassword === currentPassword) return reply.code(400).send({ error: "new password must differ from the current one" });
    await db.update(s.users).set({ passwordHash: hashPassword(newPassword) }).where(eq(s.users.id, u.id));
    const revoked = await revokeOtherSessions(u.id, sessionToken(req));
    await recordAudit(db, req, u, { action: "password-change", targetType: "user", targetId: u.email, payload: { revokedSessions: revoked } });
    return { ok: true, revokedSessions: revoked };
  });

  app.get("/api/matrix", async () => {
    const [cats, ctrls, maps, fw, evidence, period, assigns, userRows] = await Promise.all([
      db.select().from(s.controlCategories).orderBy(asc(s.controlCategories.id)),
      db.select().from(s.controls).orderBy(asc(s.controls.code)),
      db
        .select({ controlCode: s.mappings.controlCode, code: s.requirements.code })
        .from(s.mappings)
        .innerJoin(s.requirements, eq(s.mappings.requirementId, s.requirements.id)),
      db.select().from(s.frameworks),
      db.select({ controlCode: s.evidenceItems.controlCode, collectedAt: s.evidenceItems.collectedAt, drifted: s.evidenceItems.drifted, sourceType: s.evidenceItems.sourceType }).from(s.evidenceItems),
      currentPeriod(),
      db.select().from(s.controlAssignments),
      db.select({ id: s.users.id, name: s.users.name }).from(s.users),
    ]);
    const att = await latestAttestations();
    const scope = await inScopeCodes(period?.tier); // null = no tier scoping

    const xwalk = new Map<string, string[]>();
    for (const m of maps) {
      const arr = xwalk.get(m.controlCode);
      if (arr) arr.push(m.code);
      else xwalk.set(m.controlCode, [m.code]);
    }

    // Owner per control, from real control_assignments (first assignee) — previously
    // hardcoded null, so the matrix Owner column never populated.
    const userName = new Map(userRows.map((u) => [u.id, u.name]));
    const ownerByControl = new Map<string, { initials: string; name: string }>();
    for (const a of assigns) {
      if (ownerByControl.has(a.controlCode)) continue;
      const name = userName.get(a.userId);
      if (name) ownerByControl.set(a.controlCode, { initials: ownerInitials(name), name });
    }

    // Freshest evidence (max collectedAt) + drift + per-control doc count. Fills the
    // matrix "Freshest evidence" column, the "└ N docs" note, and the stale/drift lenses.
    const now = Date.now();
    const evByControl = new Map<string, { collectedAt: Date; anyDrift: boolean; docs: number }>();
    for (const e of evidence) {
      const cur = evByControl.get(e.controlCode);
      const isDoc = e.sourceType === "doc";
      if (!cur) evByControl.set(e.controlCode, { collectedAt: e.collectedAt, anyDrift: e.drifted, docs: isDoc ? 1 : 0 });
      else {
        if (e.collectedAt > cur.collectedAt) cur.collectedAt = e.collectedAt;
        if (e.drifted) cur.anyDrift = true;
        if (isDoc) cur.docs++;
      }
    }
    const evidenceFor = (code: string) => {
      const ev = evByControl.get(code);
      if (!ev) return { age: null, tag: null, label: null };
      const ageDays = Math.max(0, Math.round((now - ev.collectedAt.getTime()) / 864e5));
      return { age: `${ageDays}d`, tag: ev.anyDrift ? "drift" : null, label: ev.anyDrift ? "drift" : null };
    };

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
        evidence: evidenceFor(c.code),
        docs: evByControl.get(c.code)?.docs ?? 0,
        owner: ownerByControl.get(c.code) ?? null,
        inScope: scope ? scope.has(c.code) : true,
        flag: att.get(`${c.code}:impl`)?.marker === "gap" ? "coverage-as-nc" : undefined,
      });
    }

    const domains = cats.map((cat, i) => {
      const all = byCat.get(cat.id) ?? [];
      // Scores + gates are computed over IN-SCOPE controls only (the active period's tier).
      const inScope = all.filter((c) => c.inScope);
      const scored = inScope.map((c) => c.score).filter((x): x is number => x != null);
      // Family mean over EVERY in-scope control, unassessed counting as 0. It
      // previously averaged only the assessed ones, so a family with 3 of 39
      // controls rated reported the posture of those 3 as the family's gate —
      // the certification decision surface, computed from 8% of the family.
      const score = inScope.length
        ? Math.round(inScope.reduce((a, c) => a + (c.score ?? 0), 0) / inScope.length)
        : null;
      // Posture over just the assessed controls, for display beside coverage.
      const assessedOnly = scored.length
        ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length)
        : null;
      const gate = score != null ? Math.round((score / 20) * 10) / 10 : null; // 0–5 scale (family mean)
      const weakest = scored.length ? Math.min(...scored) : null;
      const coverage = inScope.length ? scored.length / inScope.length : 0;
      // Real certification gate: fail if the family mean is sub-par OR any single in-scope
      // assessed control is below the maturity floor (an average can't hide a weak control).
      const gateFail = gate != null && (gate < 3.0 || (weakest != null && weakest < GATE_FLOOR));
      // A gate that fails because nobody looked is a different problem from one
      // that fails because the control is weak, and DESIGN.md requires them to
      // stay visibly distinct ("collection broke" vs "control broke").
      const gateFailReason = !gateFail ? null : coverage < COVERAGE_FLOOR ? "coverage" : "posture";
      return {
        id: cat.id,
        name: cat.title,
        score,
        assessedOnly,
        assessed: scored.length,
        total: inScope.length,
        coverage: inScope.length ? Math.round(coverage * 100) : 0,
        gateFailReason,
        gate,
        gateFail,
        weakest,
        scopeTotal: scope ? inScope.length : all.length,
        owner: null,
        open: i === 0,
        controls: all,
      };
    });

    const inScopeTotal = scope ? ctrls.filter((c) => scope.has(c.code)).length : ctrls.length;
    return {
      summary: {
        controlsTotal: ctrls.length,
        inScopeTotal,
        tier: period?.tier ?? null,
        categories: cats.length,
        frameworks: fw.map((f) => f.id),
        mappingLinks: maps.length,
        period,
      },
      domains,
    };
  });

  // Control detail for the drawer. The category/history/evidence/crosswalk
  // queries are independent of one another, so they run in parallel.
  app.get<{ Params: { code: string } }>("/api/control/:code", { schema: { params: codeParam } }, async (req, reply) => {
    const code = req.params.code;
    const ctrl = (await db.select().from(s.controls).where(eq(s.controls.code, code)).limit(1))[0];
    if (!ctrl) return reply.code(404).send({ error: "not found" });
    const [cat, history, evidence, maps] = await Promise.all([
      db.select().from(s.controlCategories).where(eq(s.controlCategories.id, ctrl.categoryId)).limit(1).then((r) => r[0]),
      db.select().from(s.attestations).where(eq(s.attestations.controlCode, code)).orderBy(desc(s.attestations.createdAt)),
      db.select().from(s.evidenceItems).where(eq(s.evidenceItems.controlCode, code)),
      db
        .select({ code: s.requirements.code, framework: s.requirements.frameworkId, relationship: s.mappings.relationship, confidence: s.mappings.confidence })
        .from(s.mappings)
        .innerJoin(s.requirements, eq(s.mappings.requirementId, s.requirements.id))
        .where(eq(s.mappings.controlCode, code)),
    ]);
    return { control: { id: ctrl.code, name: ctrl.title, domain: `${cat?.id} · ${cat?.title}` }, crosswalk: maps, attestations: history, evidence };
  });

  // Create an attestation (append-only). RBAC + assignment-scoping enforced.
  // `marker` is deliberately absent from this body type. It records machine
  // provenance (aws = collector suggestion, gap = coverage gap, drift = source
  // changed) and the worklist and matrix both read it as such — so accepting it
  // from a writer let a hand-entered rating claim to have come from a collector.
  // It is server-derived: a human attestation carries no marker.
  app.post<{ Body: { control: string; dimension: Dimension; rating: Rating; justification?: string } }>(
    "/api/attest",
    { schema: { body: attestBody } },
    async (req, reply) => {
      const user = await currentUser(req);
      if (!user) return reply.code(401).send({ error: "unauthenticated" });
      const { control, dimension, rating, justification } = req.body;
      if (!DIMENSIONS.includes(dimension)) return reply.code(400).send({ error: "bad dimension" });
      if (!RATINGS.includes(rating)) return reply.code(400).send({ error: "bad rating" });
      if (!(await controlExists(control))) return reply.code(404).send({ error: "unknown control" });
      if (!(await canWriteControl(user, control))) return reply.code(403).send({ error: "forbidden (role or assignment scope)" });
      if (!(await hasFreshStepUp(req))) return reply.code(403).send({ error: "re-authentication required", code: "step_up_required" });

      const row = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(s.attestations)
          .values({ controlCode: control, dimension, rating, justification: justification ?? null, marker: null, actorId: user.id, source: "human" })
          .returning();
        await recordAudit(tx, req, user, {
          action: "attest",
          targetType: "control",
          targetId: `${control}:${dimension}`,
          payload: { rating },
        });
        return inserted;
      });
      return { ok: true, attestation: row };
    },
  );

  // Worklist v2 — composed, prioritized tasks (clock-starters, drift, coverage
  // gaps, AWS confirm, maturity dependencies, expiring/pending exceptions).
  app.get("/api/worklist", async () => {
    const [ctrls, att, excs, period] = await Promise.all([
      db.select().from(s.controls).orderBy(asc(s.controls.code)),
      latestAttestations(),
      db.select().from(s.exceptions),
      currentPeriod(),
    ]);
    const scope = await inScopeCodes(period?.tier);
    const tasks: any[] = [];
    // Only the active period's in-scope controls generate assessment work — an
    // out-of-scope control isn't part of this assessment, so it isn't a task.
    for (const c of ctrls) {
      if (scope && !scope.has(c.code)) continue;
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
      else if (e.status === "expired")
        tasks.push({ control: e.controlCode, name: `Exception lapsed: ${e.reason.slice(0, 60)}`, type: "exception-lapsed", reason: `Risk acceptance expired ${e.expiresAt?.toISOString().slice(0, 10) ?? ""} — remediate or file a new request`, priority: 82 });
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
  app.post<{ Body: { control: string; dimension?: string; reason: string; expiresAt?: string } }>("/api/exception", { schema: { body: exceptionBody } }, async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    if (!canWrite(user.role)) return reply.code(403).send({ error: "forbidden" });
    const { control, dimension, reason, expiresAt } = req.body;
    if (!reason?.trim()) return reply.code(400).send({ error: "reason required" });
    if (!(await controlExists(control))) return reply.code(404).send({ error: "unknown control" });
    if (dimension && !DIMENSIONS.includes(dimension as Dimension)) return reply.code(400).send({ error: "bad dimension" });
    const expires = expiresAt ? new Date(expiresAt) : null;
    if (expires && Number.isNaN(expires.getTime())) return reply.code(400).send({ error: "unparseable expiresAt" });
    const [row] = await db
      .insert(s.exceptions)
      .values({ controlCode: control, dimension: dimension ?? null, reason: reason.trim(), status: "pending", requestedBy: user.id, expiresAt: expires })
      .returning();
    await recordAudit(db, req, user, { action: "exception-request", targetType: "control", targetId: control, payload: { id: row.id } });
    return { ok: true, exception: row };
  });

  // Approve / reject an exception — SoD: approver must differ from requester.
  app.post<{ Params: { id: string }; Body: { decision: "approve" | "reject" } }>("/api/exception/:id/decide", { schema: { params: idParam("id"), body: decideBody } }, async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    if (user.role !== "admin" && user.role !== "compliance_manager") return reply.code(403).send({ error: "only admin/compliance_manager can decide exceptions" });
    const id = Number(req.params.id);
    const exc = (await db.select().from(s.exceptions).where(eq(s.exceptions.id, id)).limit(1))[0];
    if (!exc) return reply.code(404).send({ error: "not found" });
    if (exc.requestedBy === user.id) return reply.code(403).send({ error: "separation of duties: the requester cannot approve their own exception" });
    if (!(await hasFreshStepUp(req))) return reply.code(403).send({ error: "re-authentication required", code: "step_up_required" });
    const status = req.body.decision === "approve" ? "approved" : "rejected";
    // One transaction, and the entry is only written if the update actually
    // moved a row. Previously the audit insert was unconditional and separate:
    // if the exception vanished between the read above and this write, the log
    // recorded a decision that never happened.
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(s.exceptions)
        .set({ status, approvedBy: user.id, decidedAt: new Date() })
        .where(eq(s.exceptions.id, id))
        .returning();
      if (!updated) return null;
      await recordAudit(tx, req, user, {
        action: `exception-${status}`,
        targetType: "control",
        targetId: exc.controlCode,
        payload: { id },
      });
      return updated;
    });
    if (!row) return reply.code(409).send({ error: "exception changed before the decision was applied" });
    return { ok: true, exception: row };
  });

  // Reverse roll-up: framework requirements ← mapped controls' status, + gap report.
  app.get<{ Querystring: { framework?: string } }>("/api/requirements", async (req) => {
    return computeRequirements(req.query.framework === "iso27001" ? "iso27001" : "soc2");
  });

  // ISO 27001 Statement of Applicability — every Annex A control with its
  // applicability decision, status, justification, and crosswalk-derived coverage.
  app.get("/api/soa", async () => {
    const [reqs, entries, iso] = await Promise.all([
      db.select().from(s.requirements).where(and(eq(s.requirements.frameworkId, "iso27001"), eq(s.requirements.kind, "iso-annexa"))).orderBy(asc(s.requirements.code)),
      db.select().from(s.soaEntries),
      computeRequirements("iso27001"),
    ]);
    const entryByReq = new Map(entries.map((e) => [e.requirementId, e]));
    const covByCode = new Map(iso.requirements.map((r) => [r.code, { status: r.status, score: r.score, mapped: r.mapped }]));
    const rows = reqs.map((r) => {
      const e = entryByReq.get(r.id);
      const extra = (r.extra ?? {}) as { theme?: string; new_2022?: boolean };
      return {
        requirementId: r.id,
        code: r.code,
        title: r.title,
        theme: extra.theme ?? null,
        new2022: extra.new_2022 ?? false,
        // Undecided is null, not true. This defaulted to applicable:true /
        // status:"planned", so every Annex A control nobody had ruled on was
        // exported as an affirmative applicability decision — 93 of them here,
        // attributed to no one, in a document an ISO auditor reads as claims.
        applicable: e?.applicable ?? null,
        status: e ? e.status : "unset",
        justification: e?.justification ?? null,
        coverage: covByCode.get(r.code) ?? null,
      };
    });
    const summary = {
      total: rows.length,
      applicable: rows.filter((r) => r.applicable === true).length,
      excluded: rows.filter((r) => r.applicable === false).length,
      undecided: rows.filter((r) => r.applicable == null).length,
      documented: rows.filter((r) => r.justification && r.justification.trim()).length,
      implemented: rows.filter((r) => r.status === "implemented").length,
    };
    return { summary, entries: rows };
  });

  // Upsert one SoA entry (admin / compliance_manager).
  app.post<{ Params: { reqId: string }; Body: { applicable?: boolean; status?: string; justification?: string } }>("/api/soa/:reqId", { schema: { params: idParam("reqId"), body: soaBody } }, async (req, reply) => {
    const me = await currentUser(req);
    if (!me || (me.role !== "admin" && me.role !== "compliance_manager")) return reply.code(403).send({ error: "forbidden" });
    const reqId = Number(req.params.reqId);
    const reqRow = (await db.select().from(s.requirements).where(eq(s.requirements.id, reqId)).limit(1))[0];
    if (!reqRow || reqRow.kind !== "iso-annexa") return reply.code(404).send({ error: "not an ISO Annex A control" });
    const b = req.body ?? {};
    const statuses = ["implemented", "partial", "planned", "na"];
    const existing = (await db.select().from(s.soaEntries).where(eq(s.soaEntries.requirementId, reqId)).limit(1))[0];
    const values = {
      requirementId: reqId,
      applicable: b.applicable ?? existing?.applicable ?? true,
      status: b.status && statuses.includes(b.status) ? b.status : existing?.status ?? "planned",
      justification: b.justification ?? existing?.justification ?? null,
      updatedBy: me.id,
      updatedAt: new Date(),
    };
    if (existing) await db.update(s.soaEntries).set(values).where(eq(s.soaEntries.requirementId, reqId));
    else await db.insert(s.soaEntries).values(values);
    await recordAudit(db, req, me, { action: "soa-update", targetType: "requirement", targetId: String(reqId), payload: { applicable: values.applicable, status: values.status } });
    return { ok: true };
  });

  // Auditor evidence package — the report you hand an assessor. Viewing is open
  // (UI gates it behind login); exporting (?export=1) is a sensitive action:
  // requires auth + a fresh step-up and is audit-logged.
  app.get<{ Querystring: { framework?: string; export?: string } }>("/api/report", { schema: { querystring: frameworkQuery } }, async (req, reply) => {
    const me = await currentUser(req);
    const fw = req.query.framework === "iso27001" ? "iso27001" : "soc2";
    const fwName = fw === "iso27001" ? "ISO/IEC 27001:2022" : "SOC 2 (TSC 2017)";
    const isExport = req.query.export === "1" || req.query.export === "true";
    // Gate the DATA, not the ceremony. All of this used to sit inside
    // `if (isExport)`, so dropping the query parameter returned a byte-identical
    // 165KB report — readiness, every requirement, every control, gaps and
    // exceptions — with no step-up and no audit entry. The flag decided whether
    // the caller was recorded, not whether they were entitled, which made the
    // trail a record of who asked politely.
    if (!me) return reply.code(401).send({ error: "unauthenticated" });
    if (!(await hasFreshStepUp(req)))
      return reply.code(403).send({ error: "re-authentication required", code: "step_up_required" });
    // Every detailed response is recorded; the flag now only distinguishes a
    // download from an on-screen read.
    // Recorded after the report is actually assembled, below — logging the read
    // before doing the work would leave an entry for a response that never
    // reached anyone if assembly threw.
    const reqData = await computeRequirements(fw);
    const [att, scoreMap, ctrls, evidence, maps, excs, period] = await Promise.all([
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
      currentPeriod(),
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
    const body = {
      meta: {
        org: process.env.ORG_NAME || "autocomply",
        framework: fwName,
        period: period
          ? { start: period.start, end: period.end, days: period.days }
          : { start: "—", end: "—", days: 0 },
        generatedAt: new Date().toISOString(),
        generatedBy: me?.name ?? "system",
      },
      readiness: reqData.summary,
      requirements: reqData.requirements,
      controls,
      gaps: reqData.requirements.filter((r) => r.status === "gap").map((r) => ({ code: r.code, title: r.title, kind: r.kind })),
      exceptions: excs.map((e) => ({ control: e.controlCode, reason: e.reason, status: e.status, expiresAt: e.expiresAt })),
    };
    // Recorded now that the report exists: an entry here means a caller actually
    // received this data. Coverage rides in the payload so the trail says what
    // was disclosed, not merely that something was.
    await recordAudit(db, req, me, {
      action: isExport ? "report-export" : "report-view",
      targetType: "framework",
      targetId: fw,
      payload: { export: isExport, readiness: reqData.summary.readiness, coverage: reqData.summary.coverage },
    });
    return body;
  });

  // Computed notifications feed (what a real notifier sends). Shared by the pull
  // endpoint and the on-demand outbound delivery.
  async function computeNotifications(): Promise<NotifyEvent[]> {
    const [att, evidence, excs] = await Promise.all([
      latestAttestations(),
      db.select().from(s.evidenceItems),
      db.select().from(s.exceptions),
    ]);
    const items: NotifyEvent[] = [];
    for (const ev of evidence) if (ev.drifted) items.push({ kind: "drift", text: `${ev.controlCode} — ${ev.kind} doc drifted; re-attest needed`, severity: "warn" });
    for (const [key, a] of att) if (a.marker === "gap") items.push({ kind: "coverage-gap", text: `${key.split(":")[0]} — coverage gap → scored NC`, severity: "bad" });
    const now = Date.now();
    for (const e of excs) {
      if (e.status === "pending") items.push({ kind: "exception-pending", text: `${e.controlCode} — exception awaiting approval`, severity: "info" });
      else if (e.status === "approved" && e.expiresAt && e.expiresAt.getTime() - now < 14 * 864e5) items.push({ kind: "exception-expiring", text: `${e.controlCode} — risk acceptance expires ${e.expiresAt.toISOString().slice(0, 10)}`, severity: "warn" });
      else if (e.status === "expired") items.push({ kind: "exception-lapsed", text: `${e.controlCode} — risk acceptance expired ${e.expiresAt?.toISOString().slice(0, 10) ?? ""}; remediate or renew`, severity: "bad" });
    }
    return items;
  }
  app.get("/api/notifications", async () => {
    const items = await computeNotifications();
    return { count: items.length, items };
  });

  // Push the current notification feed to the configured outbound webhook
  // (NOTIFY_WEBHOOK_URL) on demand — admin only. No-op (delivered: 0) if unset.
  app.post("/api/notifications/deliver", async (req, reply) => {
    const me = await currentUser(req);
    if (!me || me.role !== "admin") return reply.code(403).send({ error: "only admin can trigger delivery" });
    const items = await computeNotifications();
    const delivered = await deliverNotifications(items, new Date().toISOString());
    await recordAudit(db, req, me, { action: "notify-deliver", targetType: "system", payload: { delivered, total: items.length } });
    return { ok: true, configured: !!process.env.NOTIFY_WEBHOOK_URL, total: items.length, delivered };
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
      db
        .select({
          control: s.mappings.controlCode,
          frameworkId: s.requirements.frameworkId,
          code: s.requirements.code,
          relationship: s.mappings.relationship,
          confidence: s.mappings.confidence,
        })
        .from(s.mappings)
        .innerJoin(s.requirements, eq(s.mappings.requirementId, s.requirements.id)),
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
    // crosswalks is the count of derived cross-framework requirement↔requirement
    // links — same derivation buildCatalog ships in the export.
    const crosswalks = deriveCrosswalks(
      mapRows.map((m) => ({
        control: m.control,
        ref: `${m.frameworkId}:${m.code}`,
        fw: m.frameworkId,
        relationship: m.relationship,
        confidence: m.confidence,
      })),
    ).length;
    const catalog = {
      frameworks: fwRows.length,
      requirements: reqRows.length,
      controls: ctrlRows.length,
      satisfies: mapRows.length,
      crosswalks,
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
      // console, not app.log — Fastify is built with logger:false, so app.log is
      // a no-op and this operator-relevant warning would silently vanish.
      console.warn(`[catalog] export dropped ${droppedSatisfies} mapping(s) to unknown requirements`);
    }
    const me = await currentUser(req);
    await recordCatalogExport(me ?? null, "api", undefined, req);
    return catalog;
  });

  // ---- assessment periods ----
  app.get("/api/periods", async () => {
    const rows = await db.select().from(s.assessmentPeriods).orderBy(desc(s.assessmentPeriods.startDate));
    return { periods: rows };
  });
  const PERIOD_FRAMEWORKS = ["nist80053", "soc2", "iso27001"];
  const PERIOD_TIERS = ["low", "moderate", "high"];
  app.post<{ Body: { name: string; framework: string; tier?: string; startDate: string; endDate: string; tscCategories?: string[] } }>("/api/periods", { schema: { body: periodBody } }, async (req, reply) => {
    const me = await currentUser(req);
    if (!me || (me.role !== "admin" && me.role !== "compliance_manager")) return reply.code(403).send({ error: "forbidden" });
    const b = req.body;
    if (!b.name?.trim() || !b.framework || !b.startDate || !b.endDate) return reply.code(400).send({ error: "missing fields" });
    if (!PERIOD_FRAMEWORKS.includes(b.framework)) return reply.code(400).send({ error: "unknown framework" });
    if (b.tier && !PERIOD_TIERS.includes(b.tier)) return reply.code(400).send({ error: "bad tier" });
    // The active period drives scoping + reporting, so garbage dates here would
    // silently corrupt everything downstream — validate before insert.
    const start = new Date(b.startDate);
    const end = new Date(b.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return reply.code(400).send({ error: "unparseable date" });
    if (end.getTime() <= start.getTime()) return reply.code(400).send({ error: "endDate must be after startDate" });
    const [row] = await db
      .insert(s.assessmentPeriods)
      .values({ name: b.name.trim(), framework: b.framework, tier: b.tier ?? null, startDate: start, endDate: end, status: "planning", tscCategories: b.tscCategories ?? null })
      .returning();
    await recordAudit(db, req, me, { action: "period-create", targetType: "period", targetId: String(row.id) });
    return { ok: true, period: row };
  });
  app.post<{ Params: { id: string }; Body: { status: string } }>("/api/periods/:id/status", { schema: { params: idParam("id"), body: periodStatusBody } }, async (req, reply) => {
    const me = await currentUser(req);
    if (!me || (me.role !== "admin" && me.role !== "compliance_manager")) return reply.code(403).send({ error: "forbidden" });
    if (!["planning", "active", "closed"].includes(req.body.status)) return reply.code(400).send({ error: "bad status" });
    const id = Number(req.params.id);
    const existing = (await db.select().from(s.assessmentPeriods).where(eq(s.assessmentPeriods.id, id)).limit(1))[0];
    if (!existing) return reply.code(404).send({ error: "not found" });
    const [row] = await db.update(s.assessmentPeriods).set({ status: req.body.status }).where(eq(s.assessmentPeriods.id, id)).returning();
    // Status transitions change what's in scope — they belong in the audit trail
    // just like creation.
    await recordAudit(db, req, me, { action: "period-status", targetType: "period", targetId: String(id), payload: { from: existing.status, to: req.body.status } });
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

  app.post<{ Params: { id: string }; Body: { role: string } }>("/api/users/:id/role", { schema: { params: idParam("id"), body: roleBody } }, async (req, reply) => {
    const me = await currentUser(req);
    if (!me || me.role !== "admin") return reply.code(403).send({ error: "only admin can change roles" });
    const roles = ["admin", "compliance_manager", "control_owner", "auditor", "viewer"];
    if (!roles.includes(req.body.role)) return reply.code(400).send({ error: "bad role" });
    const [row] = await db.update(s.users).set({ role: req.body.role }).where(eq(s.users.id, Number(req.params.id))).returning();
    await recordAudit(db, req, me, { action: "role-change", targetType: "user", targetId: String(req.params.id), payload: { role: req.body.role } });
    return { ok: true, user: { id: row.id, role: row.role } };
  });

  app.post<{ Body: { userId: number; control: string } }>("/api/assign", { schema: { body: assignBody } }, async (req, reply) => {
    const me = await currentUser(req);
    if (!me || (me.role !== "admin" && me.role !== "compliance_manager")) return reply.code(403).send({ error: "forbidden" });
    const { userId, control } = req.body;
    if (!(await controlExists(control))) return reply.code(404).send({ error: "unknown control" });
    const target = (await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, userId)).limit(1))[0];
    if (!target) return reply.code(404).send({ error: "unknown user" });
    const existing = await db.select().from(s.controlAssignments).where(and(eq(s.controlAssignments.userId, userId), eq(s.controlAssignments.controlCode, control)));
    if (existing.length === 0) await db.insert(s.controlAssignments).values({ userId, controlCode: control });
    await recordAudit(db, req, me, { action: "assign", targetType: "control", targetId: control, payload: { userId } });
    return { ok: true };
  });

  app.post<{ Body: { userId: number; control: string } }>("/api/unassign", { schema: { body: assignBody } }, async (req, reply) => {
    const me = await currentUser(req);
    if (!me || (me.role !== "admin" && me.role !== "compliance_manager")) return reply.code(403).send({ error: "forbidden" });
    const { userId, control } = req.body;
    await db.delete(s.controlAssignments).where(and(eq(s.controlAssignments.userId, userId), eq(s.controlAssignments.controlCode, control)));
    await recordAudit(db, req, me, { action: "unassign", targetType: "control", targetId: control, payload: { userId } });
    return { ok: true };
  });

  // ---- audit log (admin / auditor) ----
  // Read side of the append-only audit trail: everything writes to it, and until
  // now nothing could read it back. Paginated, newest-first, optional action filter.
  app.get<{ Querystring: { limit?: string; offset?: string; action?: string } }>("/api/audit", async (req, reply) => {
    const me = await currentUser(req);
    if (!me || (me.role !== "admin" && me.role !== "auditor")) return reply.code(403).send({ error: "only admin/auditor can read the audit log" });
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const action = req.query.action?.trim();
    const where = action ? eq(s.auditLog.action, action) : undefined;
    const [rows, totals] = await Promise.all([
      db
        .select({
          id: s.auditLog.id,
          ts: s.auditLog.ts,
          action: s.auditLog.action,
          targetType: s.auditLog.targetType,
          targetId: s.auditLog.targetId,
          payload: s.auditLog.payload,
          actor: s.users.email,
        })
        .from(s.auditLog)
        .leftJoin(s.users, eq(s.auditLog.actorId, s.users.id))
        .where(where)
        .orderBy(desc(s.auditLog.ts), desc(s.auditLog.id))
        .limit(limit)
        .offset(offset),
      db.select({ n: count() }).from(s.auditLog).where(where),
    ]);
    return { total: totals[0]?.n ?? 0, limit, offset, entries: rows };
  });

  // ---- scoped API tokens (admin) — bearer creds for machine callers (GRCen sync, CI) ----
  app.get("/api/tokens", async (req, reply) => {
    const me = await currentUser(req);
    if (!me || me.role !== "admin") return reply.code(403).send({ error: "only admin can manage API tokens" });
    const rows = await db.select().from(s.apiTokens).orderBy(desc(s.apiTokens.createdAt));
    return { tokens: rows.map((t) => ({ id: t.id, name: t.name, role: t.role, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, expiresAt: t.expiresAt, revoked: t.revoked })) };
  });
  app.post<{ Body: { name: string; role?: string; expiresAt?: string } }>("/api/tokens", { schema: { body: tokenBody } }, async (req, reply) => {
    const me = await currentUser(req);
    if (!me || me.role !== "admin") return reply.code(403).send({ error: "only admin can manage API tokens" });
    // Minting a credential is at least as sensitive as the actions that credential
    // can perform, so it carries the same step-up requirement. Without this, a
    // hijacked session could mint a token and use it to act indefinitely.
    if (!(await hasFreshStepUp(req)))
      return reply.code(403).send({ error: "re-authentication required", code: "step_up_required" });
    const roles = ["admin", "compliance_manager", "control_owner", "auditor", "viewer"];
    const role = req.body.role && roles.includes(req.body.role) ? req.body.role : "viewer";
    if (!req.body.name?.trim()) return reply.code(400).send({ error: "name required" });
    const { token, hash } = generateApiToken();
    const [row] = await db
      .insert(s.apiTokens)
      .values({ name: req.body.name.trim(), tokenHash: hash, role, createdBy: me.id, expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null })
      .returning();
    await recordAudit(db, req, me, { action: "token-create", targetType: "api_token", targetId: String(row.id), payload: { role } });
    // Plaintext is returned ONCE — only the sha256 hash is stored.
    return { ok: true, token, id: row.id, name: row.name, role: row.role };
  });
  app.post<{ Params: { id: string } }>("/api/tokens/:id/revoke", { schema: { params: idParam("id") } }, async (req, reply) => {
    const me = await currentUser(req);
    if (!me || me.role !== "admin") return reply.code(403).send({ error: "only admin can manage API tokens" });
    await db.update(s.apiTokens).set({ revoked: true }).where(eq(s.apiTokens.id, Number(req.params.id)));
    await recordAudit(db, req, me, { action: "token-revoke", targetType: "api_token", targetId: req.params.id });
    return { ok: true };
  });

  return app;
}
