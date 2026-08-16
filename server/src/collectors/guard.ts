// Destructive-run guard for the simulated collectors.
//
// Both simulate.ts and simulate-docs.ts begin by clearing tables so they can be
// re-run idempotently. That is fine against a scratch database and catastrophic
// against one someone has been using: simulate-docs deletes every evidence item,
// every human-authored attestation and every exception, with no confirmation and
// no backup. The Evidence page used to tell the operator to run exactly that.
//
// So: refuse to run whenever the database holds work a human did. Set
// ALLOW_DESTRUCTIVE=1 to override deliberately.
import { eq, count } from "drizzle-orm";
import { db } from "../db/index";
import * as s from "../db/schema";

export async function assertSafeToReset(script: string): Promise<void> {
  if (process.env.ALLOW_DESTRUCTIVE === "1") return;

  const [humanAttestations, exceptions, evidence] = await Promise.all([
    db.select({ n: count() }).from(s.attestations).where(eq(s.attestations.source, "human")),
    db.select({ n: count() }).from(s.exceptions),
    db.select({ n: count() }).from(s.evidenceItems),
  ]);

  const counts = {
    "human attestations": Number(humanAttestations[0]?.n ?? 0),
    exceptions: Number(exceptions[0]?.n ?? 0),
    "evidence items": Number(evidence[0]?.n ?? 0),
  };
  const present = Object.entries(counts).filter(([, n]) => n > 0);
  if (present.length === 0) return;

  const summary = present.map(([label, n]) => `${n} ${label}`).join(", ");
  console.error(
    `\n${script}: refusing to run — this database contains ${summary}.\n\n` +
      `This script clears those tables before reseeding, and there is no undo.\n` +
      `If this database is genuinely disposable, re-run with ALLOW_DESTRUCTIVE=1.\n`,
  );
  process.exit(1);
}
