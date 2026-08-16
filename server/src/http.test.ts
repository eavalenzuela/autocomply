// HTTP-level tests for the authorization rules.
//
// Everything these cover was previously verified only by someone running curl
// by hand: the global auth gate, the role write matrix, control-owner
// assignment scoping, separation of duties on exception approval, step-up
// re-authentication, and that a machine credential cannot pass step-up. The
// suite tested a scoring function, a rate limiter and the catalog — none of the
// rules that decide who may change the compliance record.
//
// Runs against a disposable database (see scripts/prepare-test-db.sh), because
// verifying "can this role attest?" requires actually attesting.
//
//   ADMIN_DATABASE_URL=... ./server/scripts/prepare-test-db.sh
//   DATABASE_URL=<test db> npm --prefix server run test:http
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { db, pool } from "./db/index";
import * as s from "./db/schema";
import { hashPassword } from "./auth";

const PW = "test-password-123";
const U = {
  admin: "t-admin@test.local",
  cm: "t-cm@test.local",
  owner: "t-owner@test.local",
  viewer: "t-viewer@test.local",
};

let app: FastifyInstance;
let ownedControl: string;
let otherControl: string;

// The login throttle is per-IP, and app.inject presents the same address for
// every call, so a suite with this many logins would exhaust one bucket and
// start failing on 429 — an artifact of the harness, not of the product. Each
// login gets its own source address, as separate people would have. The
// limiter's own behaviour is covered by ratelimit.test.ts.
let ipCounter = 0;
const freshAddress = () => `203.0.113.${(ipCounter++ % 250) + 1}`;

/** Log in and return the session cookie value, or null if login was refused. */
async function login(email: string, password = PW): Promise<string | null> {
  const res = await app.inject({
    method: "POST",
    url: "/api/login",
    remoteAddress: freshAddress(),
    payload: { email, password },
  });
  if (res.statusCode !== 200) return null;
  const c = res.cookies.find((x: any) => x.name === "ac_session");
  return (c as any)?.value ?? null;
}

const auth = (cookie: string | null) => (cookie ? { cookie: `ac_session=${cookie}` } : {});

/** Log in and satisfy step-up, for the routes that require recent re-auth. */
async function loginStepped(email: string): Promise<string> {
  const cookie = await login(email);
  assert.ok(cookie, `${email} could not log in`);
  const res = await app.inject({
    method: "POST",
    url: "/api/step-up",
    headers: auth(cookie),
    remoteAddress: freshAddress(),
    payload: { password: PW },
  });
  assert.equal(res.statusCode, 200, "step-up should succeed for a valid password");
  return cookie!;
}

before(async () => {
  app = await buildApp();

  // Users with known passwords. Upserted rather than assumed so the suite does
  // not depend on whatever the seed happened to create.
  for (const [role, email] of [
    ["admin", U.admin],
    ["compliance_manager", U.cm],
    ["control_owner", U.owner],
    ["viewer", U.viewer],
  ] as const) {
    const existing = (await db.select().from(s.users).where(eq(s.users.email, email)).limit(1))[0];
    if (existing) {
      await db
        .update(s.users)
        .set({ passwordHash: hashPassword(PW), role, deactivatedAt: null })
        .where(eq(s.users.id, existing.id));
    } else {
      await db.insert(s.users).values({ email, name: `test ${role}`, role, passwordHash: hashPassword(PW) });
    }
  }

  // Two real controls: one assigned to the owner, one deliberately not.
  const controls = await db.select({ code: s.controls.code }).from(s.controls).limit(2);
  assert.ok(controls.length >= 2, "test database needs a seeded catalog");
  ownedControl = controls[0].code;
  otherControl = controls[1].code;

  const owner = (await db.select().from(s.users).where(eq(s.users.email, U.owner)).limit(1))[0];
  await db.delete(s.controlAssignments).where(eq(s.controlAssignments.userId, owner.id));
  await db.insert(s.controlAssignments).values({ userId: owner.id, controlCode: ownedControl });
});

after(async () => {
  await app?.close();
  await pool.end();
});

/* ── the global auth gate ─────────────────────────────────────────────────── */

test("unauthenticated callers cannot read the organisation's posture", async () => {
  for (const url of ["/api/matrix", "/api/requirements?framework=soc2", "/api/evidence", "/api/users"]) {
    const res = await app.inject({ method: "GET", url });
    assert.equal(res.statusCode, 401, `${url} should require authentication`);
  }
});

test("the login/bootstrap allowlist stays reachable without a session", async () => {
  assert.equal((await app.inject({ method: "GET", url: "/api/health" })).statusCode, 200);
  // /api/me answers "no user" rather than 401 — it is how the SPA bootstraps.
  assert.equal((await app.inject({ method: "GET", url: "/api/me" })).statusCode, 200);
});

test("a bad password is refused and a good one is not", async () => {
  assert.equal(await login(U.admin, "wrong-password"), null);
  assert.ok(await login(U.admin));
});

/* ── the role write matrix ────────────────────────────────────────────────── */

test("viewer cannot write, at any of the write surfaces", async () => {
  const cookie = await loginStepped(U.viewer);
  const attempts: [string, string, any][] = [
    ["POST", "/api/attest", { control: ownedControl, dimension: "pol", rating: "fc" }],
    ["POST", "/api/exception", { control: ownedControl, reason: "because" }],
    ["POST", "/api/evidence", { control: ownedControl, dimension: "pol", title: "x", content: "y" }],
    ["POST", "/api/assign", { control: ownedControl, userId: 1 }],
  ];
  for (const [method, url, payload] of attempts) {
    const res = await app.inject({ method: method as any, url, headers: auth(cookie), payload });
    assert.equal(res.statusCode, 403, `viewer should be refused ${method} ${url}, got ${res.statusCode}`);
  }
});

test("only an admin can change roles or create users", async () => {
  const cm = await loginStepped(U.cm);
  const target = (await db.select().from(s.users).where(eq(s.users.email, U.viewer)).limit(1))[0];
  assert.equal(
    (await app.inject({ method: "POST", url: `/api/users/${target.id}/role`, headers: auth(cm), payload: { role: "admin" } }))
      .statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ method: "POST", url: "/api/users", headers: auth(cm), payload: { email: "nope@test.local", name: "n" } }))
      .statusCode,
    403,
  );
});

/* ── control-owner assignment scoping ─────────────────────────────────────── */

test("a control owner may attest only their assigned controls", async () => {
  const cookie = await loginStepped(U.owner);
  const ok = await app.inject({
    method: "POST",
    url: "/api/attest",
    headers: auth(cookie),
    payload: { control: ownedControl, dimension: "pol", rating: "mc", justification: "assigned" },
  });
  assert.equal(ok.statusCode, 200, `owner should be able to attest ${ownedControl}`);

  const denied = await app.inject({
    method: "POST",
    url: "/api/attest",
    headers: auth(cookie),
    payload: { control: otherControl, dimension: "pol", rating: "fc", justification: "not mine" },
  });
  assert.equal(denied.statusCode, 403, `owner should NOT be able to attest ${otherControl}`);
});

/* ── step-up re-authentication ────────────────────────────────────────────── */

test("a sensitive action needs recent re-authentication", async () => {
  const cookie = await login(U.cm); // logged in, but has NOT stepped up
  const before = await app.inject({
    method: "POST",
    url: "/api/attest",
    headers: auth(cookie),
    payload: { control: ownedControl, dimension: "proc", rating: "pc" },
  });
  assert.equal(before.statusCode, 403);
  assert.equal(before.json().code, "step_up_required", "the SPA keys its retry off this code");

  const stepped = await app.inject({
    method: "POST",
    url: "/api/step-up",
    headers: auth(cookie),
    remoteAddress: freshAddress(),
    payload: { password: PW },
  });
  assert.equal(stepped.statusCode, 200);

  const after2 = await app.inject({
    method: "POST",
    url: "/api/attest",
    headers: auth(cookie),
    payload: { control: ownedControl, dimension: "proc", rating: "pc" },
  });
  assert.equal(after2.statusCode, 200, "the same request should succeed once stepped up");
});

test("step-up rejects the wrong password", async () => {
  const cookie = await login(U.cm);
  const res = await app.inject({ method: "POST", url: "/api/step-up", headers: auth(cookie), remoteAddress: freshAddress(), payload: { password: "nope" } });
  assert.equal(res.statusCode, 401);
});

test("an API token cannot pass step-up, however privileged", async () => {
  // Regression for the check that used to return true whenever there was no
  // session cookie — which every Bearer token satisfies.
  const admin = await loginStepped(U.admin);
  const minted = await app.inject({
    method: "POST",
    url: "/api/tokens",
    headers: auth(admin),
    payload: { name: `http-test-${Date.now()}`, role: "admin" },
  });
  assert.equal(minted.statusCode, 200, "admin should be able to mint a token after stepping up");
  const token = minted.json().token as string;

  const res = await app.inject({
    method: "POST",
    url: "/api/attest",
    headers: { authorization: `Bearer ${token}` },
    payload: { control: ownedControl, dimension: "impl", rating: "fc" },
  });
  assert.equal(res.statusCode, 403, "a token must not be able to attest");

  // ...but a token keeps the read paths a machine integration needs.
  const read = await app.inject({ method: "GET", url: "/api/catalog", headers: { authorization: `Bearer ${token}` } });
  assert.equal(read.statusCode, 200, "machine read paths must keep working");
});

/* ── separation of duties ─────────────────────────────────────────────────── */

test("the requester of an exception cannot approve it", async () => {
  const cm = await loginStepped(U.cm);
  const created = await app.inject({
    method: "POST",
    url: "/api/exception",
    headers: auth(cm),
    payload: { control: ownedControl, reason: "compensating control in place" },
  });
  assert.equal(created.statusCode, 200);
  const id = created.json().exception.id;

  const self = await app.inject({
    method: "POST",
    url: `/api/exception/${id}/decide`,
    headers: auth(cm),
    payload: { decision: "approve" },
  });
  assert.equal(self.statusCode, 403, "separation of duties: requester must not approve their own exception");

  const other = await app.inject({
    method: "POST",
    url: `/api/exception/${id}/decide`,
    headers: auth(await loginStepped(U.admin)),
    payload: { decision: "approve" },
  });
  assert.equal(other.statusCode, 200, "a different approver should be able to decide it");
});

/* ── deactivation ─────────────────────────────────────────────────────────── */

test("deactivating a user stops their live session immediately", async () => {
  const victim = await login(U.viewer);
  assert.equal((await app.inject({ method: "GET", url: "/api/matrix", headers: auth(victim) })).statusCode, 200);

  const target = (await db.select().from(s.users).where(eq(s.users.email, U.viewer)).limit(1))[0];
  const admin = await loginStepped(U.admin);
  const off = await app.inject({
    method: "POST",
    url: `/api/users/${target.id}/active`,
    headers: auth(admin),
    payload: { active: false },
  });
  assert.equal(off.statusCode, 200);

  assert.equal(
    (await app.inject({ method: "GET", url: "/api/matrix", headers: auth(victim) })).statusCode,
    401,
    "deactivation must mean 'cannot act', not merely 'cannot log in again'",
  );
  assert.equal(await login(U.viewer), null, "and they cannot log back in");

  // restore, so the suite is re-runnable
  await app.inject({
    method: "POST",
    url: `/api/users/${target.id}/active`,
    headers: auth(admin),
    payload: { active: true },
  });
});

/* ── input validation ─────────────────────────────────────────────────────── */

test("malformed input is refused at the edge, without leaking internals", async () => {
  const cookie = await loginStepped(U.admin);
  const res = await app.inject({
    method: "POST",
    url: "/api/soa/99999999999",
    headers: auth(cookie),
    payload: { status: "implemented" },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.match(body.error, /reqId/);
  assert.doesNotMatch(JSON.stringify(body), /select |from "|params:/i, "an error must not carry the query");
});

test("machine provenance cannot be forged through the attest body", async () => {
  const cookie = await loginStepped(U.admin);
  const res = await app.inject({
    method: "POST",
    url: "/api/attest",
    headers: auth(cookie),
    payload: { control: ownedControl, dimension: "meas", rating: "sc", justification: "forge", marker: "aws" },
  });
  assert.equal(res.statusCode, 200);
  const row = (
    await db
      .select()
      .from(s.attestations)
      .where(eq(s.attestations.controlCode, ownedControl))
      .orderBy(s.attestations.id)
  ).at(-1)!;
  assert.equal(row.source, "human");
  assert.equal(row.marker, null, "a human attestation must never carry machine provenance");
});

// ---------------------------------------------------------------------------
// Assessment period lifecycle.
//
// Closing was terminal and the UI closed a period on one unconfirmed click of
// its status badge, so the only mistake the product made easiest to commit was
// also the only one it made impossible to undo. Reopening is now allowed, and
// these tests pin the conditions that keep it honest rather than the mere fact
// that it works.
// ---------------------------------------------------------------------------

/** A closed period to experiment on, created fresh so tests do not share state. */
async function makeClosedPeriod(name: string): Promise<number> {
  const cookie = await login(U.admin);
  const created = await app.inject({
    method: "POST",
    url: "/api/periods",
    headers: auth(cookie),
    payload: { name, framework: "soc2", startDate: "2030-01-01", endDate: "2030-12-31" },
  });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().period.id as number;
  const closed = await app.inject({
    method: "POST",
    url: `/api/periods/${id}/status`,
    headers: auth(cookie),
    payload: { status: "closed" },
  });
  assert.equal(closed.statusCode, 200, closed.body);
  return id;
}

test("a period can be scoped to any adopted catalog, not a hardcoded three", async () => {
  const cookie = await login(U.admin);
  // The schema enum was ["soc2","iso27001"] while the form offered nist80053,
  // so the baseline-only option could never actually be created.
  const res = await app.inject({
    method: "POST",
    url: "/api/periods",
    headers: auth(cookie),
    payload: { name: "baseline probe", framework: "nist80053", tier: "moderate", startDate: "2031-01-01", endDate: "2031-12-31" },
  });
  assert.equal(res.statusCode, 200, res.body);
  await db.delete(s.assessmentPeriods).where(eq(s.assessmentPeriods.id, res.json().period.id));
});

test("a framework that is not adopted is refused with a reason, not an enum error", async () => {
  const cookie = await login(U.admin);
  const res = await app.inject({
    method: "POST",
    url: "/api/periods",
    headers: auth(cookie),
    payload: { name: "nope", framework: "not-a-framework", startDate: "2031-01-01", endDate: "2031-12-31" },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /not adopted/);
});

test("reopening a closed period requires a reason", async () => {
  const id = await makeClosedPeriod("reopen-needs-reason");
  const cookie = await login(U.admin);
  for (const payload of [{ status: "active" }, { status: "active", reason: "   " }, { status: "active", reason: "oops" }]) {
    const res = await app.inject({ method: "POST", url: `/api/periods/${id}/status`, headers: auth(cookie), payload });
    assert.equal(res.statusCode, 400, `should refuse ${JSON.stringify(payload)}`);
  }
  const still = (await db.select().from(s.assessmentPeriods).where(eq(s.assessmentPeriods.id, id)))[0];
  assert.equal(still.status, "closed", "a refused reopen must not change the period");
  await db.delete(s.assessmentPeriods).where(eq(s.assessmentPeriods.id, id));
});

test("a compliance manager can close a period but not reopen one", async () => {
  const id = await makeClosedPeriod("reopen-is-admin-only");
  const cm = await login(U.cm);
  const res = await app.inject({
    method: "POST",
    url: `/api/periods/${id}/status`,
    headers: auth(cm),
    payload: { status: "active", reason: "closed the wrong period by mistake" },
  });
  assert.equal(res.statusCode, 403, "reopening is narrower than closing");
  await db.delete(s.assessmentPeriods).where(eq(s.assessmentPeriods.id, id));
});

test("a reopen is recorded on the period and does not erase the close", async () => {
  const id = await makeClosedPeriod("reopen-leaves-a-trace");
  const before = (await db.select().from(s.assessmentPeriods).where(eq(s.assessmentPeriods.id, id)))[0];
  assert.ok(before.closedAt, "closing should stamp closedAt");

  // One active period at a time still holds, so clear the way first.
  const others = await db.select().from(s.assessmentPeriods).where(eq(s.assessmentPeriods.status, "active"));
  for (const o of others) {
    if (o.id !== id) await db.update(s.assessmentPeriods).set({ status: "planning" }).where(eq(s.assessmentPeriods.id, o.id));
  }

  const cookie = await login(U.admin);
  const res = await app.inject({
    method: "POST",
    url: `/api/periods/${id}/status`,
    headers: auth(cookie),
    payload: { status: "active", reason: "closed a month early by mistake" },
  });
  assert.equal(res.statusCode, 200, res.body);

  const after = (await db.select().from(s.assessmentPeriods).where(eq(s.assessmentPeriods.id, id)))[0];
  assert.equal(after.status, "active");
  assert.equal(after.reopenCount, 1);
  assert.match(after.reopenReason ?? "", /closed a month early/);
  assert.ok(after.reopenedAt, "the reopen should be stamped");
  assert.deepEqual(after.closedAt, before.closedAt, "the close must survive the reopen");
  assert.deepEqual(after.scopeSnapshot, before.scopeSnapshot, "the frozen scope must survive the reopen");

  const logged = await db
    .select()
    .from(s.auditLog)
    .where(eq(s.auditLog.action, "period-reopen"))
    .orderBy(s.auditLog.id);
  const entry = logged.at(-1);
  assert.ok(entry, "a reopen must appear in the audit log under its own action name");
  assert.equal(entry!.targetId, String(id));

  for (const o of others) {
    if (o.id !== id) await db.update(s.assessmentPeriods).set({ status: "active" }).where(eq(s.assessmentPeriods.id, o.id));
  }
  await db.delete(s.assessmentPeriods).where(eq(s.assessmentPeriods.id, id));
});

test("a closed period still cannot be returned to planning", async () => {
  const id = await makeClosedPeriod("no-un-running-history");
  const cookie = await login(U.admin);
  const res = await app.inject({
    method: "POST",
    url: `/api/periods/${id}/status`,
    headers: auth(cookie),
    payload: { status: "planning", reason: "pretend it never happened" },
  });
  assert.equal(res.statusCode, 409, "a period that ran cannot become one that never ran");
  await db.delete(s.assessmentPeriods).where(eq(s.assessmentPeriods.id, id));
});

test("reopening cannot smuggle in a second active period for the same framework", async () => {
  // Uniqueness is per framework, so the rival here shares soc2 with the period
  // being reopened. Two concurrent SOC 2 windows are meaningless; a SOC 2 window
  // beside a CSF one is not, and is covered by the test below.
  const id = await makeClosedPeriod("reopen-respects-one-active");
  const cookie = await login(U.admin);
  const rival = await app.inject({
    method: "POST",
    url: "/api/periods",
    headers: auth(cookie),
    payload: { name: "reopen-rival", framework: "soc2", startDate: "2033-01-01", endDate: "2033-12-31" },
  });
  const rivalId = rival.json().period.id as number;

  const parked = await db.select().from(s.assessmentPeriods).where(eq(s.assessmentPeriods.status, "active"));
  for (const p of parked) await db.update(s.assessmentPeriods).set({ status: "planning" }).where(eq(s.assessmentPeriods.id, p.id));
  await db.update(s.assessmentPeriods).set({ status: "active" }).where(eq(s.assessmentPeriods.id, rivalId));

  const res = await app.inject({
    method: "POST",
    url: `/api/periods/${id}/status`,
    headers: auth(cookie),
    payload: { status: "active", reason: "reopening while another period runs" },
  });
  assert.equal(res.statusCode, 409, "a reopen must not create a second active period");
  const untouched = (await db.select().from(s.assessmentPeriods).where(eq(s.assessmentPeriods.id, id)))[0];
  assert.equal(untouched.status, "closed");
  assert.equal(untouched.reopenCount, 0, "a refused reopen must not be counted");

  await db.delete(s.assessmentPeriods).where(eq(s.assessmentPeriods.id, rivalId));
  await db.delete(s.assessmentPeriods).where(eq(s.assessmentPeriods.id, id));
  for (const p of parked) await db.update(s.assessmentPeriods).set({ status: "active" }).where(eq(s.assessmentPeriods.id, p.id));
});

test("assessment windows for different frameworks can overlap", async () => {
  // The rule used to be one active period in total, so starting a CSF
  // assessment meant closing a SOC 2 observation window that was still running.
  // Real programmes overlap; only same-framework windows are exclusive.
  const cookie = await login(U.admin);
  const made: number[] = [];
  const parked = await db.select().from(s.assessmentPeriods).where(eq(s.assessmentPeriods.status, "active"));
  for (const p of parked) await db.update(s.assessmentPeriods).set({ status: "planning" }).where(eq(s.assessmentPeriods.id, p.id));

  const adopted = (await db.select({ id: s.frameworks.id }).from(s.frameworks).where(eq(s.frameworks.enabled, true))).map((f) => f.id);
  assert.ok(adopted.length >= 2, "this test needs two adopted frameworks");
  const [fwA, fwB] = adopted;

  try {
    for (const fw of [fwA, fwB]) {
      const created = await app.inject({
        method: "POST",
        url: "/api/periods",
        headers: auth(cookie),
        payload: { name: `overlap-${fw}`, framework: fw, startDate: "2034-01-01", endDate: "2034-12-31" },
      });
      assert.equal(created.statusCode, 200, created.body);
      const id = created.json().period.id as number;
      made.push(id);
      const act = await app.inject({
        method: "POST",
        url: `/api/periods/${id}/status`,
        headers: auth(cookie),
        payload: { status: "active" },
      });
      assert.equal(act.statusCode, 200, `${fw} should be able to run alongside the others: ${act.body}`);
    }

    const active = await db.select().from(s.assessmentPeriods).where(eq(s.assessmentPeriods.status, "active"));
    assert.equal(active.length, 2, "both windows should be open at once");

    // ...but a second window for a framework that already has one is refused,
    // and the message should say the restriction is per framework.
    const dupe = await app.inject({
      method: "POST",
      url: "/api/periods",
      headers: auth(cookie),
      payload: { name: "overlap-again", framework: fwA, startDate: "2035-01-01", endDate: "2035-12-31" },
    });
    const dupeId = dupe.json().period.id as number;
    made.push(dupeId);
    const res = await app.inject({
      method: "POST",
      url: `/api/periods/${dupeId}/status`,
      headers: auth(cookie),
      payload: { status: "active" },
    });
    assert.equal(res.statusCode, 409);
    assert.match(res.json().error, /other frameworks can run at the same time/i);
  } finally {
    for (const id of made) await db.delete(s.assessmentPeriods).where(eq(s.assessmentPeriods.id, id));
    for (const p of parked) await db.update(s.assessmentPeriods).set({ status: "active" }).where(eq(s.assessmentPeriods.id, p.id));
  }
});

test("the database refuses two active windows for one framework, not just the route", async () => {
  // The route check is read-then-write and two concurrent requests could both
  // pass it. The partial unique index is the actual guarantee.
  const parked = await db.select().from(s.assessmentPeriods).where(eq(s.assessmentPeriods.status, "active"));
  for (const p of parked) await db.update(s.assessmentPeriods).set({ status: "planning" }).where(eq(s.assessmentPeriods.id, p.id));
  const ids: number[] = [];
  try {
    for (const n of ["idx-a", "idx-b"]) {
      const [row] = await db
        .insert(s.assessmentPeriods)
        .values({ name: n, framework: "iso27001", startDate: new Date("2036-01-01"), endDate: new Date("2036-12-31"), status: "planning" })
        .returning();
      ids.push(row.id);
    }
    await db.update(s.assessmentPeriods).set({ status: "active" }).where(eq(s.assessmentPeriods.id, ids[0]));
    let rejected: any = null;
    try {
      await db.update(s.assessmentPeriods).set({ status: "active" }).where(eq(s.assessmentPeriods.id, ids[1]));
    } catch (e) {
      rejected = e;
    }
    assert.ok(rejected, "the index, not the route, is what makes this impossible");
    // The driver wraps the failure, so the constraint name is on the cause.
    const detail = `${rejected?.cause?.message ?? ""} ${rejected?.cause?.constraint ?? ""}`;
    assert.match(detail, /one_active_per_framework|unique/i, `unexpected rejection: ${detail}`);
    const still = (await db.select().from(s.assessmentPeriods).where(eq(s.assessmentPeriods.id, ids[1])))[0];
    assert.equal(still.status, "planning", "the refused row must be unchanged");
  } finally {
    for (const id of ids) await db.delete(s.assessmentPeriods).where(eq(s.assessmentPeriods.id, id));
    for (const p of parked) await db.update(s.assessmentPeriods).set({ status: "active" }).where(eq(s.assessmentPeriods.id, p.id));
  }
});

test("a report is stamped with its own framework's window, not whichever is active", async () => {
  // With one active period this was harmless. With overlapping windows it meant
  // a SOC 2 report could carry a CSF observation period in its meta block — a
  // wrong date range on the document an auditor is handed.
  const cookie = await loginStepped(U.admin);
  const parked = await db.select().from(s.assessmentPeriods).where(eq(s.assessmentPeriods.status, "active"));
  for (const p of parked) await db.update(s.assessmentPeriods).set({ status: "planning" }).where(eq(s.assessmentPeriods.id, p.id));

  const windows = [
    { fw: "soc2", start: "2040-01-01", end: "2040-06-30" },
    { fw: "iso27001", start: "2041-02-01", end: "2041-11-30" },
  ];
  const ids: number[] = [];
  try {
    for (const w of windows) {
      const [row] = await db
        .insert(s.assessmentPeriods)
        .values({ name: `stamp-${w.fw}`, framework: w.fw, startDate: new Date(w.start), endDate: new Date(w.end), status: "active" })
        .returning();
      ids.push(row.id);
    }
    for (const w of windows) {
      const res = await app.inject({ method: "GET", url: `/api/report?framework=${w.fw}`, headers: auth(cookie) });
      assert.equal(res.statusCode, 200, res.body);
      const meta = res.json().meta;
      assert.equal(meta.period.start, w.start, `${w.fw} report should carry the ${w.fw} window`);
      assert.equal(meta.period.end, w.end, `${w.fw} report should carry the ${w.fw} window`);
    }
  } finally {
    for (const id of ids) await db.delete(s.assessmentPeriods).where(eq(s.assessmentPeriods.id, id));
    for (const p of parked) await db.update(s.assessmentPeriods).set({ status: "active" }).where(eq(s.assessmentPeriods.id, p.id));
  }
});
