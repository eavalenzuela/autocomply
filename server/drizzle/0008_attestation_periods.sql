-- attestations.period_id could name exactly one assessment window, and was
-- written on every attestation and read by nothing. Neither half survives
-- contact with how programmes actually run: windows overlap, so a rating made
-- in March belongs to the SOC 2 observation period AND the CSF assessment
-- running across the same months, and a scalar column has to pick one.
--
-- Membership becomes many-to-many. The existing stamps are preserved as the
-- first row of each attestation's membership before the column is dropped, so
-- nothing recorded is lost.
CREATE TABLE IF NOT EXISTS "attestation_periods" (
  "attestation_id" integer NOT NULL REFERENCES "attestations"("id"),
  "period_id" integer NOT NULL REFERENCES "assessment_periods"("id"),
  CONSTRAINT "attestation_periods_pk" PRIMARY KEY ("attestation_id", "period_id")
);--> statement-breakpoint
INSERT INTO "attestation_periods" ("attestation_id", "period_id")
  SELECT "id", "period_id" FROM "attestations" WHERE "period_id" IS NOT NULL
  ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attestation_periods_period_idx" ON "attestation_periods" ("period_id");--> statement-breakpoint
ALTER TABLE "attestations" DROP COLUMN IF EXISTS "period_id";
