CREATE TABLE "ai_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"host_id" uuid NOT NULL,
	"settings" jsonb NOT NULL,
	"credentials" jsonb NOT NULL,
	"key_check" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_singleton" CHECK ("ai_settings"."id" = 1)
);
