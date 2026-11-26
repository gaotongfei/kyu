CREATE TABLE "collection_boards" (
	"source" text PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_status" text NOT NULL,
	"last_message" text
);
--> statement-breakpoint
CREATE TABLE "collection_jobs" (
	"source" text NOT NULL,
	"source_job_id" text NOT NULL,
	"provider" text NOT NULL,
	"title" text NOT NULL,
	"company" text NOT NULL,
	"location_text" text NOT NULL,
	"payload" jsonb NOT NULL,
	"matched_search_ids" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"inactive_at" timestamp with time zone,
	CONSTRAINT "collection_jobs_source_source_job_id_pk" PRIMARY KEY("source","source_job_id")
);
--> statement-breakpoint
CREATE TABLE "collection_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"account" text NOT NULL,
	"period" text NOT NULL,
	"search_id" text NOT NULL,
	"reserved" integer NOT NULL,
	"returned" integer,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "collection_reservation_bound" CHECK ("collection_reservations"."reserved" BETWEEN 1 AND 100 AND ("collection_reservations"."returned" IS NULL OR "collection_reservations"."returned" BETWEEN 0 AND "collection_reservations"."reserved"))
);
--> statement-breakpoint
CREATE TABLE "collection_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"config" jsonb NOT NULL,
	"report" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_suppressions" (
	"source" text NOT NULL,
	"source_job_id" text NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "collection_suppressions_source_source_job_id_pk" PRIMARY KEY("source","source_job_id")
);
--> statement-breakpoint
CREATE TABLE "collection_usage" (
	"account" text NOT NULL,
	"period" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "collection_usage_account_period_pk" PRIMARY KEY("account","period"),
	CONSTRAINT "collection_usage_free_cap" CHECK ("collection_usage"."used" >= 0 AND "collection_usage"."used" <= 500)
);
--> statement-breakpoint
ALTER TABLE "collection_reservations" ADD CONSTRAINT "collection_reservations_run_id_collection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."collection_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_jobs_observed_idx" ON "collection_jobs" USING btree ("active","last_observed_at","source","source_job_id");--> statement-breakpoint
CREATE INDEX "collection_runs_started_idx" ON "collection_runs" USING btree ("started_at");