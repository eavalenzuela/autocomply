// Simulated document-evidence seeding (P2). Adds linked policy/procedure docs
// (with snapshot hashes) for the AWS-fed controls and the matching human
// Policy/Process attestations, plus a couple of exceptions for the demo. A real
// version fetches from Drive/Confluence/etc. and snapshots + hashes the content.
import "dotenv/config";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../db/index";
import * as s from "../db/schema";

const DOC_CONTROLS = ["10.f", "01.q", "09.aa", "09.af", "01.r", "10.p", "09.l"];

function hash(seed: string) {
  return createHash("sha256").update(seed).digest("hex").slice(0, 32);
}

async function main() {
  const owner = (await db.select().from(s.users).where(eq(s.users.email, "owner@autocomply.local")).limit(1))[0];
  const cm = (await db.select().from(s.users).where(eq(s.users.email, "cm@autocomply.local")).limit(1))[0];

  // idempotent: clear doc evidence + human attestations + exceptions
  await db.delete(s.evidenceItems);
  await db.delete(s.attestations).where(eq(s.attestations.source, "human"));
  await db.delete(s.exceptions);

  for (const code of DOC_CONTROLS) {
    for (const [dim, kind, rating, url] of [
      ["pol", "policy", "fc", "https://confluence.local/policies/" + code],
      ["proc", "procedure", "mc", "https://confluence.local/procedures/" + code],
    ] as const) {
      await db.insert(s.evidenceItems).values({
        controlCode: code,
        dimension: dim,
        title: `${kind === "policy" ? "Policy" : "Procedure"} doc — ${code}`,
        sourceType: "doc",
        liveUrl: url,
        kind,
        contentHash: hash(`${code}:${dim}:v1`),
      });
      await db.insert(s.attestations).values({
        controlCode: code,
        dimension: dim,
        rating,
        justification: `Backed by linked ${kind} doc (snapshot hashed)`,
        evidenceRefs: [{ type: "doc", url }],
        actorId: owner?.id ?? null,
        source: "human",
      });
    }
  }

  // Exceptions: one approved+expiring-soon, one pending (SoD: requester ≠ approver).
  const soon = new Date(Date.now() + 5 * 24 * 3600 * 1000);
  await db.insert(s.exceptions).values([
    {
      controlCode: "09.l",
      dimension: "impl",
      reason: "Legacy EBS volumes scheduled for migration in Q3; backup policy waived until then.",
      status: "approved",
      requestedBy: owner?.id ?? null,
      approvedBy: cm?.id ?? null,
      expiresAt: soon,
      decidedAt: new Date(),
    },
    {
      controlCode: "10.p",
      dimension: "impl",
      reason: "One non-prod account pending GuardDuty rollout.",
      status: "pending",
      requestedBy: owner?.id ?? null,
    },
  ]);

  console.log(`seeded docs+attestations for ${DOC_CONTROLS.length} controls (pol/proc) + 2 exceptions`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
