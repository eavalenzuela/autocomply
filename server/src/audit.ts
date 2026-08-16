// Audit trail writes.
//
// Two rules this module exists to enforce, both of which the previous inline
// `db.insert(s.auditLog).values({...})` calls broke:
//
//   1. An entry records WHO, from WHERE, not just a user id. A token's actions
//      were logged under the human who created it, so the trail could not tell
//      an operator apart from a credential they minted months earlier.
//
//   2. An entry is written in the SAME transaction as the mutation it describes,
//      and only after that mutation is confirmed to have touched a row. The old
//      calls were separate statements issued afterwards, so a failure between
//      the two lost the entry, and a write that matched nothing still logged as
//      though it had happened.
import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { db } from "./db/index";
import * as s from "./db/schema";
import { sessionToken } from "./auth";

/**
 * Anything that can act. Deliberately structural rather than `CurrentUser`:
 * some routes have only the database row for the user they just verified, and
 * an audit entry should never be skipped because the caller held the wrong
 * shape of the same identity.
 */
export type AuditActor = { id: number; tokenId?: number } | null;

/** Either the pool handle or a transaction handle from `db.transaction`. */
export type DbHandle = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AuditEvent {
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  payload?: unknown;
}

/**
 * A stable, non-reversible handle for the session behind an action.
 *
 * The raw session token is a bearer credential; writing it into the audit log
 * would mean anyone who can read the trail can assume the sessions in it. A
 * truncated hash correlates entries from one session without being usable to
 * resume it.
 */
function sessionHandle(req: FastifyRequest): string | null {
  const tok = sessionToken(req);
  if (!tok) return null;
  return createHash("sha256").update(tok).digest("hex").slice(0, 32);
}

/** Request-derived context common to every entry. */
export function auditContext(req: FastifyRequest, user: AuditActor) {
  const ua = req.headers["user-agent"];
  return {
    actorId: user?.id ?? null,
    actorTokenId: user?.tokenId ?? null,
    ip: req.ip ?? null,
    userAgent: typeof ua === "string" ? ua.slice(0, 256) : null,
    sessionId: sessionHandle(req),
  };
}

/**
 * Record an audited action. Pass the transaction handle that performed the
 * mutation so the entry commits or rolls back with it.
 */
export async function recordAudit(
  tx: DbHandle,
  req: FastifyRequest,
  user: AuditActor,
  event: AuditEvent,
): Promise<void> {
  await tx.insert(s.auditLog).values({
    ...auditContext(req, user),
    action: event.action,
    targetType: event.targetType ?? null,
    targetId: event.targetId ?? null,
    payload: (event.payload ?? null) as any,
  });
}

/**
 * Record a security event — a rejected login, a denied action, a throttled
 * caller. These have no mutation to ride along with, so they are written on
 * their own connection and deliberately never throw: failing to log a denial
 * must not turn a 401 into a 500.
 */
export async function recordSecurityEvent(
  req: FastifyRequest,
  user: AuditActor,
  event: AuditEvent,
): Promise<void> {
  try {
    await recordAudit(db, req, user, event);
  } catch (err) {
    req.log?.error({ err, action: event.action }, "failed to record security event");
  }
}
