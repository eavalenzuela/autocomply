// autocomply — Drizzle (Postgres) schema.
// Covers: structural CCF library, frameworks/crosswalk, auth baseline (P0),
// and evidence/attestation/checks (P1).
import {
  pgTable,
  varchar,
  text,
  integer,
  serial,
  boolean,
  timestamp,
  jsonb,
  numeric,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

/* ===== Structural CCF library ===== */

export const controlCategories = pgTable("control_categories", {
  id: varchar("id", { length: 8 }).primaryKey(), // 800-53 family, "AC".."SR"
  title: text("title").notNull(),
});

export const controlObjectives = pgTable("control_objectives", {
  code: varchar("code", { length: 16 }).primaryKey(), // base control, "AC-2"
  title: text("title").notNull(),
  categoryId: varchar("category_id", { length: 8 })
    .notNull()
    .references(() => controlCategories.id),
});

export const controls = pgTable("controls", {
  code: varchar("code", { length: 16 }).primaryKey(), // "AC-2" | "AC-2(1)"
  title: text("title").notNull(),
  categoryId: varchar("category_id", { length: 8 })
    .notNull()
    .references(() => controlCategories.id),
  objectiveCode: varchar("objective_code", { length: 16 }).references(() => controlObjectives.code),
  weight: numeric("weight").notNull().default("1.0"), // prioritization-only
  owner: integer("owner").references(() => users.id),
});

// 800-53 Low/Moderate/High baseline membership (cumulative). Drives the tier scoping.
export const controlBaselines = pgTable(
  "control_baselines",
  {
    controlCode: varchar("control_code", { length: 16 })
      .notNull()
      .references(() => controls.code),
    baseline: varchar("baseline", { length: 12 }).notNull(), // low | moderate | high
  },
  (t) => ({ pk: primaryKey({ columns: [t.controlCode, t.baseline] }) }),
);

/* ===== Frameworks + crosswalk ===== */

export const frameworks = pgTable("frameworks", {
  id: varchar("id", { length: 32 }).primaryKey(), // "soc2" | "iso27001" | "csf2" | ...
  name: text("name").notNull(),
  version: text("version"),
  // Opt-in, deliberately. A catalog being present in the repo is not consent to
  // assess against it: an organisation that has not adopted CSF should not find
  // its dashboard reporting a CSF readiness figure. Loading is a build concern,
  // enablement is a runtime decision.
  enabled: boolean("enabled").notNull().default(false),
  // Provenance travels with the data rather than living in a YAML comment,
  // because the licence is the binding constraint on what may ship and whoever
  // audits this instance will ask where each catalog came from.
  licence: text("licence"),
  sourceUrl: text("source_url"),
});

export const requirements = pgTable(
  "requirements",
  {
    id: serial("id").primaryKey(),
    frameworkId: varchar("framework_id", { length: 32 })
      .notNull()
      .references(() => frameworks.id),
    code: varchar("code", { length: 32 }).notNull(),
    title: text("title"),
    kind: varchar("kind", { length: 24 }).notNull(), // soc2-criterion | iso-clause | iso-annexa
    extra: jsonb("extra"),
  },
  (t) => ({ uq: uniqueIndex("req_fw_code").on(t.frameworkId, t.code) }),
);

export const mappings = pgTable("mappings", {
  id: serial("id").primaryKey(),
  controlCode: varchar("control_code", { length: 16 })
    .notNull()
    .references(() => controls.code),
  requirementId: integer("requirement_id")
    .notNull()
    .references(() => requirements.id),
  relationship: varchar("relationship", { length: 16 }).notNull(), // equivalent|superset|subset|partial|related
  confidence: varchar("confidence", { length: 8 }).notNull(), // high|medium|low
  source: varchar("source", { length: 24 }).notNull(), // manual|olir-derived
  note: text("note"),
});

/* ===== Auth baseline (P0) ===== */
// Roles: admin | compliance_manager | control_owner | auditor | viewer

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  role: varchar("role", { length: 24 }).notNull().default("viewer"),
  authProvider: varchar("auth_provider", { length: 16 }).notNull().default("local"), // local | github | google
  expiresAt: timestamp("expires_at", { withTimezone: true }), // for time-boxed auditors
  // Deactivation, not deletion. The audit trail references users by id and is
  // append-only; deleting the row would leave the record pointing at nobody.
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Single-use, time-boxed links for setting a password — both the initial invite
// and a reset. Only the hash is stored, as with api_tokens: a leaked database
// should not hand out working links, and an admin who can read the table should
// not be able to silently assume someone else's account.
//
// This exists because there was no way to create a user at all outside the seed
// script. A deployment therefore had no path to a first login, and no path to a
// second person.
export const userInvites = pgTable("user_invites", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  purpose: varchar("purpose", { length: 16 }).notNull(), // invite | reset
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  token: varchar("token", { length: 64 }).primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  steppedUpAt: timestamp("stepped_up_at", { withTimezone: true }), // last step-up re-auth; gates sensitive actions
});

export const controlAssignments = pgTable("control_assignments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  controlCode: varchar("control_code", { length: 16 })
    .notNull()
    .references(() => controls.code),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  actorId: integer("actor_id"),
  // A machine credential is its own principal. Without this, an API token's
  // actions were recorded under the human who created it — the trail could not
  // distinguish "Alice did this" from "a token Alice made months ago did this",
  // which is the first question asked of an audit log after an incident.
  actorTokenId: integer("actor_token_id"),
  // Where the action came from. An audit entry that cannot place an action is
  // hard to act on and impossible to corroborate against other systems.
  ip: varchar("ip", { length: 64 }),
  userAgent: varchar("user_agent", { length: 256 }),
  sessionId: varchar("session_id", { length: 64 }),
  action: varchar("action", { length: 64 }).notNull(),
  targetType: varchar("target_type", { length: 32 }),
  targetId: varchar("target_id", { length: 64 }),
  payload: jsonb("payload"),
});

// Scoped API tokens for machine callers (e.g. GRCen catalog sync, CI). Only the
// sha256 hash is stored; the plaintext is shown once at creation. A token resolves
// to a CurrentUser with `role` (its scope) in auth.currentUser.
export const apiTokens = pgTable("api_tokens", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
  role: varchar("role", { length: 24 }).notNull().default("viewer"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revoked: boolean("revoked").notNull().default(false),
});

/* ===== Evidence + attestation (P1) ===== */
// Dimensions: pol | proc | impl | meas | mang
// Ratings:    nc | sc | pc | mc | fc

export const evidenceItems = pgTable("evidence_items", {
  id: serial("id").primaryKey(),
  controlCode: varchar("control_code", { length: 16 })
    .notNull()
    .references(() => controls.code),
  dimension: varchar("dimension", { length: 8 }).notNull(),
  title: text("title").notNull(),
  sourceType: varchar("source_type", { length: 32 }).notNull(), // doc | aws | manual
  liveUrl: text("live_url"),
  kind: varchar("kind", { length: 24 }), // policy|procedure|config|metric|screenshot
  contentHash: varchar("content_hash", { length: 80 }), // snapshot hash (immutable proof)
  priorHash: varchar("prior_hash", { length: 80 }), // last hash before a drift event
  drifted: boolean("drifted").notNull().default(false), // source content changed since attestation
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
});

// Immutable point-in-time capture of an evidence item (DESIGN.md:460). Evidence
// is the mutable pointer — title, live URL, which control it speaks to. A
// Snapshot is what was actually fetched, when, by whom, and its hash over the
// real bytes. A new hash for the same evidence is a drift event.
//
// DESIGN.md puts the bytes in S3. A self-hosted single-node deployment has no
// S3, so captures are stored inline here and `bytes` records the true size
// either way. What must not vary is that `contentHash` is computed over content
// genuinely retrieved: the hash this codebase shipped was sha256 of the
// control's own code, which proved nothing about any document.
export const snapshots = pgTable("snapshots", {
  id: serial("id").primaryKey(),
  evidenceId: integer("evidence_id")
    .notNull()
    .references(() => evidenceItems.id),
  contentHash: varchar("content_hash", { length: 80 }).notNull(),
  bytes: integer("bytes").notNull(),
  contentType: varchar("content_type", { length: 128 }),
  content: text("content"),
  sourceUrl: text("source_url"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  fetchedBy: integer("fetched_by").references(() => users.id),
  // The snapshot this one replaced, so a drift chain is walkable.
  supersedes: integer("supersedes"),
});

// An attestation pins the exact snapshots it was made against (DESIGN.md:470).
// This replaces attestations.evidence_refs, an unconstrained jsonb blob pointing
// at mutable rows: a rating "backed by evidence" could silently come to mean
// something the attestor never saw. Pinning makes drift detectable — a newer
// snapshot the attestation does not pin is precisely the re-attest trigger.
export const attestationEvidence = pgTable(
  "attestation_evidence",
  {
    attestationId: integer("attestation_id")
      .notNull()
      .references(() => attestations.id),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => snapshots.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.attestationId, t.snapshotId] }) }),
);

/* ===== ISO 27001 Statement of Applicability ===== */
// One entry per ISO Annex A control (an iso27001 / iso-annexa requirement): is it
// applicable, the implementation status, and the justification an assessor reads.
export const soaEntries = pgTable("soa_entries", {
  requirementId: integer("requirement_id")
    .primaryKey()
    .references(() => requirements.id),
  applicable: boolean("applicable").notNull().default(true),
  status: varchar("status", { length: 16 }).notNull().default("planned"), // implemented | partial | planned | na
  justification: text("justification"),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ===== Assessment periods (P4 scoping) ===== */

/**
 * Which assessment windows a rating falls inside.
 *
 * Replaces attestations.period_id, which could hold one id and was written but
 * never read. Overlapping windows are ordinary, so membership is many-to-many:
 * a rating made in March 2026 belongs to every window then open that covers the
 * date. Rows accrue as attestations are written, and closing a period sweeps up
 * anything in its window that predates the link (an attestation written while
 * the period was still in planning, or before it was created at all), so a
 * closed period's membership is complete as well as fixed.
 */
export const attestationPeriods = pgTable(
  "attestation_periods",
  {
    attestationId: integer("attestation_id")
      .notNull()
      .references(() => attestations.id),
    periodId: integer("period_id")
      .notNull()
      .references(() => assessmentPeriods.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.attestationId, t.periodId] }) }),
);

export const assessmentPeriods = pgTable("assessment_periods", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  framework: varchar("framework", { length: 32 }).notNull(), // nist80053 | soc2 | iso27001
  tier: varchar("tier", { length: 12 }), // low | moderate | high (800-53 baseline)
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }).notNull(),
  status: varchar("status", { length: 12 }).notNull().default("active"), // planning | active | closed
  tscCategories: jsonb("tsc_categories"), // SOC 2 opt-in categories
  closedAt: timestamp("closed_at", { withTimezone: true }),
  // The control codes that were in scope when the period closed. "Closed" has
  // to mean the assessment stopped moving; without a frozen scope set, editing
  // a baseline later silently rewrites what a finished assessment covered.
  scopeSnapshot: jsonb("scope_snapshot"),
  // Reopening a closed period is allowed but never invisible. closedAt and
  // scopeSnapshot are deliberately NOT cleared on reopen: they are the record
  // of what the close covered, and a reopened period that looks like it was
  // never closed is worse than one that cannot reopen at all.
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  reopenReason: text("reopen_reason"),
  reopenCount: integer("reopen_count").notNull().default(0),
  // NOTE: a partial unique index (framework) WHERE status = 'active' enforces
  // one open window per framework — see 0007_periods_per_framework.sql. Drizzle
  // cannot express a partial index here, so it lives in the migration only.
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ===== Exceptions / risk acceptance (P2) ===== */
// Separation of duties: requestedBy must differ from approvedBy (enforced in the API).

export const exceptions = pgTable("exceptions", {
  id: serial("id").primaryKey(),
  controlCode: varchar("control_code", { length: 16 })
    .notNull()
    .references(() => controls.code),
  dimension: varchar("dimension", { length: 8 }), // null = whole control
  reason: text("reason").notNull(),
  status: varchar("status", { length: 12 }).notNull().default("pending"), // pending|approved|rejected|expired
  requestedBy: integer("requested_by").references(() => users.id),
  approvedBy: integer("approved_by").references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

// Append-only. Current rating for a (control, dimension) = latest by createdAt.
export const attestations = pgTable("attestations", {
  id: serial("id").primaryKey(),
  controlCode: varchar("control_code", { length: 16 })
    .notNull()
    .references(() => controls.code),
  dimension: varchar("dimension", { length: 8 }).notNull(),
  rating: varchar("rating", { length: 4 }).notNull(),
  justification: text("justification"),
  evidenceRefs: jsonb("evidence_refs"), // array of {type, id}
  // NOTE: the single period_id column that used to sit here is gone. Assessment
  // windows overlap, so one rating routinely belongs to several at once — a SOC
  // 2 observation window and a CSF assessment running over the same months — and
  // a scalar column can only ever name one of them. See attestation_periods.
  marker: varchar("marker", { length: 8 }), // aws | drift | gap | null
  actorId: integer("actor_id").references(() => users.id),
  source: varchar("source", { length: 16 }).notNull().default("human"), // human | aws-suggested
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ===== Checks / collection (P1) ===== */

export const checks = pgTable("checks", {
  key: varchar("key", { length: 64 }).primaryKey(),
  title: text("title").notNull(),
  sourceKind: varchar("source_kind", { length: 32 }).notNull(), // aws-config | security-hub | custom-collector
  controlCode: varchar("control_code", { length: 16 })
    .notNull()
    .references(() => controls.code),
  dimension: varchar("dimension", { length: 8 }).notNull().default("impl"),
  rubric: jsonb("rubric"), // pass-rate thresholds → suggested rating
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const checkRuns = pgTable("check_runs", {
  id: serial("id").primaryKey(),
  checkKey: varchar("check_key", { length: 64 })
    .notNull()
    .references(() => checks.key),
  status: varchar("status", { length: 12 }).notNull(), // complete | partial | failed
  scopeExpected: integer("scope_expected").notNull().default(0),
  scopeObserved: integer("scope_observed").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const automatedFindings = pgTable("automated_findings", {
  id: serial("id").primaryKey(),
  checkRunId: integer("check_run_id")
    .notNull()
    .references(() => checkRuns.id),
  resource: varchar("resource", { length: 256 }).notNull(),
  result: varchar("result", { length: 16 }).notNull(), // pass|fail|not_applicable|error|indeterminate
  observedValue: text("observed_value"),
  expectedValue: text("expected_value"),
  rawHash: varchar("raw_hash", { length: 80 }),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
});
