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
export interface CurrentUser { id: number; email: string; name: string; role: Role; }

const WRITE_ROLES: Role[] = ["admin", "compliance_manager", "control_owner"];
const SESSION_TTL_MS = 12 * 3600 * 1000;
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
    if (u && !(u.expiresAt && u.expiresAt.getTime() < Date.now())) return { id: u.id, email: u.email, name: u.name, role: u.role as Role };
  }
  // 2) dev/script fallback header
  const email = req.headers["x-user-email"] as string | undefined;
  if (email) {
    const u = (await db.select().from(s.users).where(eq(s.users.email, email)).limit(1))[0];
    if (u && !(u.expiresAt && u.expiresAt.getTime() < Date.now())) return { id: u.id, email: u.email, name: u.name, role: u.role as Role };
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
