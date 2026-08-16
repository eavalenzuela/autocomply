// Auth (P3). Real local-account sessions: scrypt password hashing + a session
// token in an httpOnly cookie. The `x-user-email` header remains as a dev/script
// fallback when there's no session. SSO (SAML/OIDC) + SCIM plug in here later as
// additional ways to resolve a CurrentUser / provision sessions.
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { db } from "./db/index";
import * as s from "./db/schema";

export type Role = "admin" | "compliance_manager" | "control_owner" | "auditor" | "viewer";
export interface CurrentUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  authProvider: string;
  /** Set when the caller authenticated with an API token — the token is the
   *  acting principal, `id` is only the human who owns it. */
  tokenId?: number;
}

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

/* ---- scoped API tokens ---- */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function generateApiToken(): { token: string; hash: string } {
  const token = `act_${randomBytes(24).toString("hex")}`;
  return { token, hash: hashToken(token) };
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

// Delete expired session rows. currentUser already ignores them (the join filters
// on expiresAt), but nothing removed the rows, so the table grew forever. The
// server runs this on an interval; safe to call any time.
export async function sweepExpiredSessions(): Promise<number> {
  const gone = await db.delete(s.sessions).where(lt(s.sessions.expiresAt, new Date())).returning({ token: s.sessions.token });
  return gone.length;
}

// Revoke every session for `userId` except `keepToken` — used after a password
// change so a stolen session elsewhere doesn't survive the credential rotation.
export async function revokeOtherSessions(userId: number, keepToken: string | undefined): Promise<number> {
  const where = keepToken
    ? and(eq(s.sessions.userId, userId), ne(s.sessions.token, keepToken))
    : eq(s.sessions.userId, userId);
  const gone = await db.delete(s.sessions).where(where).returning({ token: s.sessions.token });
  return gone.length;
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
  // Fail CLOSED. This used to return true when there was no interactive session,
  // which meant every non-cookie caller — any Bearer API token — passed the
  // step-up check without ever re-authenticating, on exactly the actions
  // step-up exists to protect (attest, approve, export). A machine credential
  // cannot re-enter a password, so it cannot satisfy step-up; the honest answer
  // is that it does not get these actions, not that the check is waived.
  if (!token) return false;
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
  // 2) scoped API bearer token (machine callers: GRCen catalog sync, CI, scripts).
  // Works in production (unlike the dev header) — resolves to the token's scoped role.
  const authz = req.headers["authorization"] as string | undefined;
  if (authz?.startsWith("Bearer ")) {
    const th = hashToken(authz.slice(7).trim());
    const t = (await db.select().from(s.apiTokens).where(eq(s.apiTokens.tokenHash, th)).limit(1))[0];
    if (t && !t.revoked && t.createdBy != null && !(t.expiresAt && t.expiresAt.getTime() < Date.now())) {
      void db.update(s.apiTokens).set({ lastUsedAt: new Date() }).where(eq(s.apiTokens.id, t.id)); // best-effort
      return {
        id: t.createdBy,
        tokenId: t.id,
        email: `token:${t.name}`,
        name: `API token: ${t.name}`,
        role: t.role as Role,
        authProvider: "token",
      };
    }
  }
  // 3) dev/script fallback header — DISABLED in production (it would let any
  // caller assume an identity with no password). Dev/test convenience only.
  const email = process.env.NODE_ENV !== "production" ? (req.headers["x-user-email"] as string | undefined) : undefined;
  if (email) {
    const u = (await db.select().from(s.users).where(eq(s.users.email, email)).limit(1))[0];
    if (u && !(u.expiresAt && u.expiresAt.getTime() < Date.now())) return { id: u.id, email: u.email, name: u.name, role: u.role as Role, authProvider: u.authProvider };
  }
  return null;
}

/**
 * Whether session cookies carry the Secure flag.
 *
 * Derived from the public origin rather than NODE_ENV. A Secure cookie is
 * silently discarded by the browser over plain HTTP, so keying this off
 * NODE_ENV made every non-TLS deployment impossible to log into -- the login
 * request succeeded, the cookie was dropped, and nothing logged an error.
 * OAUTH_BASE_URL already declares the origin users actually reach (it drives
 * OAuth redirects and CORS), so it decides this too.
 *
 * Falls back to the NODE_ENV check when OAUTH_BASE_URL is unset or unparseable,
 * which keeps the safe default for deployments that never set it.
 */
export function useSecureCookies(): boolean {
  const base = process.env.OAUTH_BASE_URL;
  if (!base) return process.env.NODE_ENV === "production";
  try {
    return new URL(base).protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  (reply as any).setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies(), maxAge: SESSION_TTL_MS / 1000 });
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
