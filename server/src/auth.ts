// Auth (P3). Real local-account sessions: scrypt password hashing + a session
// token in an httpOnly cookie. The `x-user-email` header remains as a dev/script
// fallback when there's no session. SSO (SAML/OIDC) + SCIM plug in here later as
// additional ways to resolve a CurrentUser / provision sessions.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { and, eq, gt } from "drizzle-orm";
import { db } from "./db/index";
import * as s from "./db/schema";

export type Role = "admin" | "compliance_manager" | "control_owner" | "auditor" | "viewer";
export interface CurrentUser { id: number; email: string; name: string; role: Role; authProvider: string; }

const WRITE_ROLES: Role[] = ["admin", "compliance_manager", "control_owner"];
const SESSION_TTL_MS = 12 * 3600 * 1000;
// Step-up re-auth window: sensitive actions (attest / approve / export) require a
// re-verified password within this window of the action.
export const STEP_UP_TTL_MS = 5 * 60 * 1000;
export const SESSION_COOKIE = "ac_session";

/* ---- passwords (scrypt) ---- */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}
export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/* ---- sessions ---- */
export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.insert(s.sessions).values({ token, userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
  return token;
}
export async function destroySession(token: string): Promise<void> {
  await db.delete(s.sessions).where(eq(s.sessions.token, token));
}

/* ---- step-up re-auth ---- */

// The active session token (cookie only — the header fallback has no session).
export function sessionToken(req: FastifyRequest): string | undefined {
  return (req as any).cookies?.[SESSION_COOKIE] as string | undefined;
}

// Record a successful step-up re-auth on the active session.
export async function recordStepUp(token: string): Promise<void> {
  await db.update(s.sessions).set({ steppedUpAt: new Date() }).where(eq(s.sessions.token, token));
}

// Step-up gate for sensitive actions. Returns true if the caller may proceed:
//   - dev/script callers (no session cookie, e.g. x-user-email) are exempt;
//   - session callers must have re-authenticated within STEP_UP_TTL_MS.
export async function hasFreshStepUp(req: FastifyRequest): Promise<boolean> {
  const token = sessionToken(req);
  if (!token) return true; // dev/script path — no interactive session to step up
  const row = (
    await db.select({ at: s.sessions.steppedUpAt }).from(s.sessions).where(eq(s.sessions.token, token)).limit(1)
  )[0];
  const at = row?.at;
  return !!at && Date.now() - at.getTime() < STEP_UP_TTL_MS;
}

export async function currentUser(req: FastifyRequest): Promise<CurrentUser | null> {
  // 1) session cookie
  const token = (req as any).cookies?.[SESSION_COOKIE] as string | undefined;
  if (token) {
    const rows = await db
      .select({ u: s.users })
      .from(s.sessions)
      .innerJoin(s.users, eq(s.sessions.userId, s.users.id))
      .where(and(eq(s.sessions.token, token), gt(s.sessions.expiresAt, new Date())))
      .limit(1);
    const u = rows[0]?.u;
    if (u && !(u.expiresAt && u.expiresAt.getTime() < Date.now())) return { id: u.id, email: u.email, name: u.name, role: u.role as Role, authProvider: u.authProvider };
  }
  // 2) dev/script fallback header
  const email = req.headers["x-user-email"] as string | undefined;
  if (email) {
    const u = (await db.select().from(s.users).where(eq(s.users.email, email)).limit(1))[0];
    if (u && !(u.expiresAt && u.expiresAt.getTime() < Date.now())) return { id: u.id, email: u.email, name: u.name, role: u.role as Role, authProvider: u.authProvider };
  }
  return null;
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  (reply as any).setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS / 1000 });
}
export function clearSessionCookie(reply: FastifyReply) {
  (reply as any).clearCookie(SESSION_COOKIE, { path: "/" });
}

export function canWrite(role: Role): boolean {
  return WRITE_ROLES.includes(role);
}

/** Control Owners may only write to controls assigned to them. */
export async function canWriteControl(user: CurrentUser, controlCode: string): Promise<boolean> {
  if (!canWrite(user.role)) return false;
  if (user.role !== "control_owner") return true;
  const rows = await db.select().from(s.controlAssignments).where(eq(s.controlAssignments.userId, user.id));
  return rows.some((r) => r.controlCode === controlCode);
}
