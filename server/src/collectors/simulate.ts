// Simulated AWS collector — exercises the P1 collection pipeline without AWS
// creds. Creates Checks, CheckRuns (with completeness), AutomatedFindings, then
// applies each Check's rubric to suggest an Implemented-dimension attestation
// (marker "aws"). A real collector swaps the find-generation for assume-role +
// Security Hub / Config / SDK calls; everything downstream is identical.
import "dotenv/config";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../db/index";
import * as s from "../db/schema";
import { RATING_PCT, type Rating } from "../scoring";

interface SimCheck {
  key: string;
  title: string;
  sourceKind: string;
  control: string;
  resources: number;
  passRate: number; // fraction of resources that pass
  coverage: number; // fraction of expected days/resources actually collected
}

const CHECKS: SimCheck[] = [
  { key: "s3-default-encryption", title: "S3 buckets enforce encryption at rest", sourceKind: "aws-config", control: "SC-28", resources: 42, passRate: 1.0, coverage: 1.0 },
  { key: "iam-mfa-enabled", title: "IAM users have MFA enabled", sourceKind: "security-hub", control: "IA-2", resources: 30, passRate: 0.93, coverage: 1.0 },
  { key: "cloudtrail-enabled", title: "CloudTrail logging enabled in all regions", sourceKind: "aws-config", control: "AU-2", resources: 17, passRate: 1.0, coverage: 1.0 },
  { key: "ntp-managed", title: "Instances use managed time sync", sourceKind: "custom-collector", control: "AU-8", resources: 88, passRate: 1.0, coverage: 1.0 },
  { key: "iam-password-policy", title: "Account password policy meets baseline (90-day window)", sourceKind: "aws-config", control: "IA-5", resources: 90, passRate: 1.0, coverage: 0.8 }, // 72/90 days → coverage gap → NC
  { key: "guardduty-enabled", title: "GuardDuty enabled", sourceKind: "security-hub", control: "SI-4", resources: 6, passRate: 0.83, coverage: 1.0 },
  { key: "ebs-backups", title: "EBS volumes have backup policy", sourceKind: "aws-config", control: "CP-9", resources: 51, passRate: 0.71, coverage: 1.0 },
];

// rubric: pass-rate → suggested rating; coverage below threshold forces NC + gap
function rubric(passRate: number, coverageOk: boolean): { rating: Rating; marker: "aws" | "gap" } {
  if (!coverageOk) return { rating: "nc", marker: "gap" };
  let rating: Rating;
  if (passRate >= 0.95) rating = "fc";
  else if (passRate >= 0.8) rating = "mc";
  else if (passRate >= 0.6) rating = "pc";
  else if (passRate >= 0.4) rating = "sc";
  else rating = "nc";
  return { rating, marker: "aws" };
}

async function main() {
  const collector = (await db.select().from(s.users).where(eq(s.users.email, "admin@autocomply.local")).limit(1))[0];

  // reset prior simulated runs (idempotent re-run)
  await db.delete(s.automatedFindings);
  await db.delete(s.checkRuns);
  await db.delete(s.checks);
  await db.delete(s.attestations).where(eq(s.attestations.source, "aws-suggested"));

  for (const c of CHECKS) {
    await db.insert(s.checks).values({
      key: c.key,
      title: c.title,
      sourceKind: c.sourceKind,
      controlCode: c.control,
      dimension: "impl",
      rubric: { thresholds: { fc: 0.95, mc: 0.8, pc: 0.6, sc: 0.4 } },
    });

    const expected = c.resources;
    const observed = Math.round(c.resources * c.coverage);
    const coverageOk = observed >= Math.ceil(expected * 0.95);
    const [run] = await db
      .insert(s.checkRuns)
      .values({ checkKey: c.key, status: coverageOk ? "complete" : "partial", scopeExpected: expected, scopeObserved: observed, finishedAt: new Date() })
      .returning();

    const passes = Math.round(observed * c.passRate);
    const findings = Array.from({ length: observed }, (_, i) => {
      const pass = i < passes;
      const resource = `arn:aws:resource/${c.key}/${i}`;
      return {
        checkRunId: run.id,
        resource,
        result: pass ? "pass" : "fail",
        observedValue: pass ? "compliant" : "non-compliant",
        expectedValue: "compliant",
        rawHash: createHash("sha256").update(`${resource}:${pass}`).digest("hex").slice(0, 32),
      };
    });
    if (findings.length) await db.insert(s.automatedFindings).values(findings);

    const { rating, marker } = rubric(c.passRate, coverageOk);
    await db.insert(s.attestations).values({
      controlCode: c.control,
      dimension: "impl",
      rating,
      justification: `AWS-suggested from ${c.sourceKind}: ${passes}/${observed} resources pass` + (coverageOk ? "" : `; coverage ${observed}/${expected} → NC`),
      evidenceRefs: [{ type: "check_run", id: run.id }],
      marker,
      actorId: collector?.id ?? null,
      source: "aws-suggested",
    });
    await db.insert(s.auditLog).values({ actorId: collector?.id ?? null, action: "aws-collect", targetType: "control", targetId: `${c.control}:impl`, payload: { check: c.key, rating, marker, passRate: c.passRate } });

    console.log(`  ${c.control}.impl ← ${rating.toUpperCase()} (${marker})  [${c.key}: ${passes}/${observed} pass, cov ${observed}/${expected}]`);
  }

  console.log(`\nsimulated ${CHECKS.length} checks → AWS-suggested attestations on Implemented.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
