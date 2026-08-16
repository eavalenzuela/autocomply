-- Closing an assessment period was terminal, and the UI closed one on a single
-- unconfirmed click of its status badge. Irreversible plus one click is a trap,
-- and the only remedy offered ("create a new period") fragments the record.
--
-- Reopening is now possible but never silent: it is admin-only, requires a
-- reason, and leaves closed_at and scope_snapshot in place so the row still
-- shows what the close covered.
ALTER TABLE "assessment_periods" ADD COLUMN "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assessment_periods" ADD COLUMN "reopen_reason" text;--> statement-breakpoint
ALTER TABLE "assessment_periods" ADD COLUMN "reopen_count" integer DEFAULT 0 NOT NULL;
