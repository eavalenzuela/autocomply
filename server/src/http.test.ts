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
