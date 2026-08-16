ALTER TABLE "assessment_periods" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assessment_periods" ADD COLUMN "scope_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "attestations" ADD COLUMN "period_id" integer;