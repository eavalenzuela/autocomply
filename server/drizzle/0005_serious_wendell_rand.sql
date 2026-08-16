ALTER TABLE "frameworks" ADD COLUMN "enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "frameworks" ADD COLUMN "licence" text;--> statement-breakpoint
ALTER TABLE "frameworks" ADD COLUMN "source_url" text;--> statement-breakpoint
-- Backfill: the two frameworks already in use stay enabled, so adding the
-- column does not silently switch off a running instance. New catalogs arrive
-- disabled and are turned on deliberately.
UPDATE "frameworks" SET "enabled" = true WHERE "id" IN ('soc2', 'iso27001');
