CREATE TABLE "resumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"content_markdown" text DEFAULT '' NOT NULL,
	"theme_key" text DEFAULT 'classic' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resumes_version_positive" CHECK ("resumes"."version" > 0),
	CONSTRAINT "resumes_classic_theme" CHECK ("resumes"."theme_key" = 'classic')
);
