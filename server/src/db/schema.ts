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
} from "drizzle-orm/pg-core";

/* ===== Structural CCF library ===== */

export const controlCategories = pgTable("control_categories", {
  id: varchar("id", { length: 8 }).primaryKey(), // "00".."13"
  title: text("title").notNull(),
});

export const controlObjectives = pgTable("control_objectives", {
  code: varchar("code", { length: 16 }).primaryKey(), // "01.02"
  title: text("title").notNull(),
  categoryId: varchar("category_id", { length: 8 })
    .notNull()
    .references(() => controlCategories.id),
});

export const assessmentDomains = pgTable("assessment_domains", {
  id: varchar("id", { length: 8 }).primaryKey(), // 19 scoring domains (populated on MyCSF ingest)
  title: text("title").notNull(),
});

export const controls = pgTable("controls", {
  code: varchar("code", { length: 16 }).primaryKey(), // "01.a"
  title: text("title").notNull(),
  categoryId: varchar("category_id", { length: 8 })
    .notNull()
    .references(() => controlCategories.id),
  objectiveCode: varchar("objective_code", { length: 16 }).references(() => controlObjectives.code),
  assessmentDomainId: varchar("assessment_domain_id", { length: 8 }), // tbd until MyCSF ingest
  weight: numeric("weight").notNull().default("1.0"), // prioritization-only
  owner: integer("owner").references(() => users.id),
  hitrustRef: varchar("hitrust_ref", { length: 32 }), // filled on MyCSF ingest
});

/* ===== Frameworks + crosswalk ===== */

export const frameworks = pgTable("frameworks", {
  id: varchar("id", { length: 32 }).primaryKey(), // "soc2" | "iso27001"
  name: text("name").notNull(),
  version: text("version"),
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
  source: varchar("source", { length: 24 }).notNull(), // manual|lineage-derived|mycsf-ingest
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  token: varchar("token", { length: 64 }).primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
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
  action: varchar("action", { length: 64 }).notNull(),
  targetType: varchar("target_type", { length: 32 }),
  targetId: varchar("target_id", { length: 64 }),
  payload: jsonb("payload"),
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

/* ===== Assessment periods (P4 scoping) ===== */

export const assessmentPeriods = pgTable("assessment_periods", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  framework: varchar("framework", { length: 32 }).notNull(), // hitrust | soc2 | iso27001
  tier: varchar("tier", { length: 8 }), // e1 | i1 | r2 (hitrust)
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }).notNull(),
  status: varchar("status", { length: 12 }).notNull().default("active"), // planning | active | closed
  tscCategories: jsonb("tsc_categories"), // SOC 2 opt-in categories
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
