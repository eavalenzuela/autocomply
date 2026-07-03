// Monitoring tick (P2). Continuous-monitoring job: re-checks document evidence
// for drift (content hash changed at the source → flag + mark the backing
// attestation so it surfaces as a re-attest task). A real scheduler runs this
// on an interval; here it's a manual/dev job. Drift on a fixed doc keeps the
// demo deterministic.
import "dotenv/config";
import { createHash } from "node:crypto";
import { and, desc, eq, isNotNull, lt } from "drizzle-orm";
import { db, pool } from "../db/index";
import * as s from "../db/schema";
import { deliverNotifications, type NotifyEvent } from "../notify";

function hash(seed: string) {
  return createHash("sha256").update(seed).digest("hex").slice(0, 32);
}

// Deterministic demo: the Policy doc behind 01.q "changed at the source".
const DRIFTED: { control: string; dim: string }[] = [{ control: "IA-2", dim: "pol" }];

// Exception auto-expiry: flip approved risk acceptances whose expiry date has
// lapsed to `expired`. The schema has documented the status since P2 but nothing
// ever set it, so an approved exception silently outlived its own deadline.
// Audit-logged per transition; returns the events for webhook delivery.
export async function expireLapsedExceptions(events: NotifyEvent[]): Promise<number> {
  const lapsed = await db
    .select()
    .from(s.exceptions)
    .where(and(eq(s.exceptions.status, "approved"), isNotNull(s.exceptions.expiresAt), lt(s.exceptions.expiresAt, new Date())));
  for (const e of lapsed) {
    await db.update(s.exceptions).set({ status: "expired" }).where(eq(s.exceptions.id, e.id));
    await db.insert(s.auditLog).values({ action: "exception-expired", targetType: "control", targetId: e.controlCode, payload: { id: e.id, expiresAt: e.expiresAt } });
    console.log(`  exception expired: ${e.controlCode} #${e.id} (risk acceptance lapsed ${e.expiresAt?.toISOString().slice(0, 10)})`);
    events.push({ kind: "exception-lapsed", text: `${e.controlCode} — risk acceptance expired ${e.expiresAt?.toISOString().slice(0, 10)}; remediate or renew`, severity: "bad" });
  }
  return lapsed.length;
}

// Reusable tick — also called on an interval by the server when MONITOR_INTERVAL_MS is set.
export async function runMonitorTick(): Promise<number> {
  let drifts = 0;
  const events: NotifyEvent[] = [];
  for (const d of DRIFTED) {
    const ev = (
      await db
        .select()
        .from(s.evidenceItems)
        .where(and(eq(s.evidenceItems.controlCode, d.control), eq(s.evidenceItems.dimension, d.dim)))
        .limit(1)
    )[0];
    if (!ev) continue;
    const newHash = hash(`${d.control}:${d.dim}:v2`); // source content changed
    if (newHash === ev.contentHash) continue;

    await db.update(s.evidenceItems).set({ priorHash: ev.contentHash, contentHash: newHash, drifted: true }).where(eq(s.evidenceItems.id, ev.id));

    // mark the latest attestation for this (control, dim) as drifted → re-attest
    const latest = (
      await db
        .select()
        .from(s.attestations)
        .where(and(eq(s.attestations.controlCode, d.control), eq(s.attestations.dimension, d.dim)))
        .orderBy(desc(s.attestations.createdAt))
        .limit(1)
    )[0];
    if (latest) await db.update(s.attestations).set({ marker: "drift" }).where(eq(s.attestations.id, latest.id));

    await db.insert(s.auditLog).values({ action: "drift-detected", targetType: "control", targetId: `${d.control}:${d.dim}`, payload: { priorHash: ev.contentHash, newHash } });
    console.log(`  drift: ${d.control}.${d.dim} doc changed (${ev.contentHash} → ${newHash}) — re-attest flagged`);
    events.push({ kind: "drift", text: `${d.control} ${d.dim.toUpperCase()} document drifted — re-attest needed`, severity: "warn" });
    drifts++;
  }
  // Risk acceptances past their expiry flip to `expired` (and surface in the
  // worklist / notifications as remediation tasks).
  const lapsed = await expireLapsedExceptions(events);

  // Push drift + expiry events to the configured outbound webhook (no-op if unset).
  const delivered = await deliverNotifications(events, new Date().toISOString());
  if (delivered > 0) console.log(`  [notify] delivered ${delivered} event(s) to webhook`);
  return drifts + lapsed;
}

async function main() {
  const findings = await runMonitorTick();
  console.log(`monitor tick complete — ${findings} monitoring event(s).`);
  await pool.end();
}

// Run as a script only when invoked directly (not when imported by the server).
if (process.argv[1] && process.argv[1].endsWith("monitor.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
