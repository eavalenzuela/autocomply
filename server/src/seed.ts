// Seed the DB from data/*.yaml via the loader. Idempotent: clears then inserts.
import "dotenv/config";
import { db, pool } from "./db/index";
import * as s from "./db/schema";
import { loadAll } from "./loader";
import { hashPassword } from "./auth";

const PW = hashPassword("autocomply"); // all demo users share this password

async function main() {
  const data = loadAll();

  // Clear in FK-safe order.
  await db.delete(s.automatedFindings);
  await db.delete(s.checkRuns);
  await db.delete(s.checks);
  await db.delete(s.exceptions);
  await db.delete(s.assessmentPeriods);
  await db.delete(s.attestations);
  await db.delete(s.evidenceItems);
  await db.delete(s.auditLog);
  await db.delete(s.sessions);
  await db.delete(s.controlAssignments);
  await db.delete(s.mappings);
  await db.delete(s.requirements);
  await db.delete(s.frameworks);
  await db.delete(s.controlBaselines);
  await db.delete(s.controls);
  await db.delete(s.controlObjectives);
  await db.delete(s.controlCategories);
  await db.delete(s.users);

  // Seed users (all share password "autocomply"). Auditor is time-boxed.
  const auditorExpiry = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const userRows = await db
    .insert(s.users)
    .values([
      { email: "admin@autocomply.local", name: "Admin", role: "admin", passwordHash: PW },
      { email: "cm@autocomply.local", name: "Compliance Manager", role: "compliance_manager", passwordHash: PW },
      { email: "owner@autocomply.local", name: "Control Owner", role: "control_owner", passwordHash: PW },
      { email: "auditor@autocomply.local", name: "External Auditor", role: "auditor", passwordHash: PW, expiresAt: auditorExpiry },
      { email: "viewer@autocomply.local", name: "Exec Viewer", role: "viewer", passwordHash: PW },
    ])
    .returning();
  const admin = userRows[0];
  const owner = userRows.find((u) => u.role === "control_owner")!;

  await db.insert(s.controlCategories).values(data.categories);
  await db.insert(s.controlObjectives).values(data.objectives);
  await db.insert(s.controls).values(
    data.controls.map((c) => ({
      code: c.code,
      title: c.title,
      categoryId: c.categoryId,
      objectiveCode: c.objectiveCode,
    })),
  );
  await db.insert(s.controlBaselines).values(data.baselines);
  // Assign a few controls to the Control Owner (demonstrates write-scoping).
  await db.insert(s.controlAssignments).values(["AC-1", "AC-2", "AU-6", "SC-7"].map((c) => ({ userId: owner.id, controlCode: c })));

  await db.insert(s.frameworks).values(data.frameworks);

  await db.insert(s.assessmentPeriods).values([
    { name: "NIST 800-53 Rev 5 — Moderate baseline 2026", framework: "nist80053", tier: "moderate", startDate: new Date("2026-02-20"), endDate: new Date("2026-05-21"), status: "active" },
    { name: "SOC 2 Type II — 2026 H1", framework: "soc2", startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), status: "planning", tscCategories: ["security", "availability", "confidentiality"] },
  ]);

  const reqRows = await db
    .insert(s.requirements)
    .values(data.requirements.map((r) => ({ frameworkId: r.frameworkId, code: r.code, title: r.title, kind: r.kind, extra: r.extra })))
    .returning();
  const reqId = new Map<string, number>();
  for (const r of reqRows) reqId.set(`${r.frameworkId}:${r.code}`, r.id);

  const mappingRows = data.mappings.map((m) => {
    const id = reqId.get(`${m.frameworkId}:${m.requirement}`);
    if (!id) throw new Error(`seed: unmapped requirement ${m.frameworkId}:${m.requirement} (control ${m.control})`);
    return { controlCode: m.control, requirementId: id, relationship: m.relationship, confidence: m.confidence, source: m.source, note: null };
  });
  await db.insert(s.mappings).values(mappingRows);

  await db.insert(s.auditLog).values({ actorId: admin.id, action: "seed", targetType: "system", targetId: "bootstrap", payload: { controls: data.controls.length } });

  console.log(
    `seeded: ${data.categories.length} categories, ${data.objectives.length} objectives, ` +
      `${data.controls.length} controls, ${data.frameworks.length} frameworks, ` +
      `${reqRows.length} requirements, ${mappingRows.length} mappings, ${userRows.length} users (pw: autocomply), 4 owner assignments`,
  );
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
