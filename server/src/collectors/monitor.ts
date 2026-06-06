// Monitoring tick (P2). Continuous-monitoring job: re-checks document evidence
// for drift (content hash changed at the source → flag + mark the backing
// attestation so it surfaces as a re-attest task). A real scheduler runs this
// on an interval; here it's a manual/dev job. Drift on a fixed doc keeps the
// demo deterministic.
import "dotenv/config";
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, pool } from "../db/index";
import * as s from "../db/schema";

function hash(seed: string) {
  return createHash("sha256").update(seed).digest("hex").slice(0, 32);
}

// Deterministic demo: the Policy doc behind 01.q "changed at the source".
const DRIFTED: { control: string; dim: string }[] = [{ control: "IA-2", dim: "pol" }];

// Reusable tick — also called on an interval by the server when MONITOR_INTERVAL_MS is set.
export async function runMonitorTick(): Promise<number> {
  let drifts = 0;
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
    drifts++;
  }
  return drifts;
}

async function main() {
  const drifts = await runMonitorTick();
  console.log(`monitor tick complete — ${drifts} drift event(s).`);
  await pool.end();
}

// Run as a script only when invoked directly (not when imported by the server).
if (process.argv[1] && process.argv[1].endsWith("monitor.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
