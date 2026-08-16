CREATE TABLE "attestation_evidence" (
	"attestation_id" integer NOT NULL,
	"snapshot_id" integer NOT NULL,
	CONSTRAINT "attestation_evidence_attestation_id_snapshot_id_pk" PRIMARY KEY("attestation_id","snapshot_id")
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"evidence_id" integer NOT NULL,
	"content_hash" varchar(80) NOT NULL,
	"bytes" integer NOT NULL,
	"content_type" varchar(128),
	"content" text,
	"source_url" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fetched_by" integer,
	"supersedes" integer
);
--> statement-breakpoint
ALTER TABLE "attestation_evidence" ADD CONSTRAINT "attestation_evidence_attestation_id_attestations_id_fk" FOREIGN KEY ("attestation_id") REFERENCES "public"."attestations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestation_evidence" ADD CONSTRAINT "attestation_evidence_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_evidence_id_evidence_items_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_fetched_by_users_id_fk" FOREIGN KEY ("fetched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;