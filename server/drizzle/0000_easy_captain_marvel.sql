CREATE TABLE "api_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"role" varchar(24) DEFAULT 'viewer' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "assessment_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"framework" varchar(32) NOT NULL,
	"tier" varchar(12),
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"tsc_categories" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attestations" (
	"id" serial PRIMARY KEY NOT NULL,
	"control_code" varchar(16) NOT NULL,
	"dimension" varchar(8) NOT NULL,
	"rating" varchar(4) NOT NULL,
	"justification" text,
	"evidence_refs" jsonb,
	"marker" varchar(8),
	"actor_id" integer,
	"source" varchar(16) DEFAULT 'human' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" integer,
	"actor_token_id" integer,
	"ip" varchar(64),
	"user_agent" varchar(256),
	"session_id" varchar(64),
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32),
	"target_id" varchar(64),
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "automated_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"check_run_id" integer NOT NULL,
	"resource" varchar(256) NOT NULL,
	"result" varchar(16) NOT NULL,
	"observed_value" text,
	"expected_value" text,
	"raw_hash" varchar(80),
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"check_key" varchar(64) NOT NULL,
	"status" varchar(12) NOT NULL,
	"scope_expected" integer DEFAULT 0 NOT NULL,
	"scope_observed" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "checks" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"source_kind" varchar(32) NOT NULL,
	"control_code" varchar(16) NOT NULL,
	"dimension" varchar(8) DEFAULT 'impl' NOT NULL,
	"rubric" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"control_code" varchar(16) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_baselines" (
	"control_code" varchar(16) NOT NULL,
	"baseline" varchar(12) NOT NULL,
	CONSTRAINT "control_baselines_control_code_baseline_pk" PRIMARY KEY("control_code","baseline")
);
--> statement-breakpoint
CREATE TABLE "control_categories" (
	"id" varchar(8) PRIMARY KEY NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_objectives" (
	"code" varchar(16) PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category_id" varchar(8) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "controls" (
	"code" varchar(16) PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category_id" varchar(8) NOT NULL,
	"objective_code" varchar(16),
	"weight" numeric DEFAULT '1.0' NOT NULL,
	"owner" integer
);
--> statement-breakpoint
CREATE TABLE "evidence_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"control_code" varchar(16) NOT NULL,
	"dimension" varchar(8) NOT NULL,
	"title" text NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"live_url" text,
	"kind" varchar(24),
	"content_hash" varchar(80),
	"prior_hash" varchar(80),
	"drifted" boolean DEFAULT false NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"control_code" varchar(16) NOT NULL,
	"dimension" varchar(8),
	"reason" text NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"requested_by" integer,
	"approved_by" integer,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "frameworks" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" text
);
--> statement-breakpoint
CREATE TABLE "mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"control_code" varchar(16) NOT NULL,
	"requirement_id" integer NOT NULL,
	"relationship" varchar(16) NOT NULL,
	"confidence" varchar(8) NOT NULL,
	"source" varchar(24) NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" serial PRIMARY KEY NOT NULL,
	"framework_id" varchar(32) NOT NULL,
	"code" varchar(32) NOT NULL,
	"title" text,
	"kind" varchar(24) NOT NULL,
	"extra" jsonb
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"stepped_up_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "soa_entries" (
	"requirement_id" integer PRIMARY KEY NOT NULL,
	"applicable" boolean DEFAULT true NOT NULL,
	"status" varchar(16) DEFAULT 'planned' NOT NULL,
	"justification" text,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"role" varchar(24) DEFAULT 'viewer' NOT NULL,
	"auth_provider" varchar(16) DEFAULT 'local' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_control_code_controls_code_fk" FOREIGN KEY ("control_code") REFERENCES "public"."controls"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automated_findings" ADD CONSTRAINT "automated_findings_check_run_id_check_runs_id_fk" FOREIGN KEY ("check_run_id") REFERENCES "public"."check_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_runs" ADD CONSTRAINT "check_runs_check_key_checks_key_fk" FOREIGN KEY ("check_key") REFERENCES "public"."checks"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_control_code_controls_code_fk" FOREIGN KEY ("control_code") REFERENCES "public"."controls"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_assignments" ADD CONSTRAINT "control_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_assignments" ADD CONSTRAINT "control_assignments_control_code_controls_code_fk" FOREIGN KEY ("control_code") REFERENCES "public"."controls"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_baselines" ADD CONSTRAINT "control_baselines_control_code_controls_code_fk" FOREIGN KEY ("control_code") REFERENCES "public"."controls"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_objectives" ADD CONSTRAINT "control_objectives_category_id_control_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."control_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controls" ADD CONSTRAINT "controls_category_id_control_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."control_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controls" ADD CONSTRAINT "controls_objective_code_control_objectives_code_fk" FOREIGN KEY ("objective_code") REFERENCES "public"."control_objectives"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controls" ADD CONSTRAINT "controls_owner_users_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_control_code_controls_code_fk" FOREIGN KEY ("control_code") REFERENCES "public"."controls"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_control_code_controls_code_fk" FOREIGN KEY ("control_code") REFERENCES "public"."controls"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_control_code_controls_code_fk" FOREIGN KEY ("control_code") REFERENCES "public"."controls"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_framework_id_frameworks_id_fk" FOREIGN KEY ("framework_id") REFERENCES "public"."frameworks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soa_entries" ADD CONSTRAINT "soa_entries_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soa_entries" ADD CONSTRAINT "soa_entries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "req_fw_code" ON "requirements" USING btree ("framework_id","code");