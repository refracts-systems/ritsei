-- owner: onboarding
-- reviewed: 2026-11-19
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: stage CSV import batches, their per-record rows, and the source identity map that
--   keeps a repeat import from creating a record twice (ADR-0115). New schema, no backfill.

CREATE SCHEMA "onboarding";
--> statement-breakpoint
CREATE TYPE "onboarding"."import_batch_status" AS ENUM('staged', 'rehearsed', 'applied');--> statement-breakpoint
CREATE TYPE "onboarding"."import_object_kind" AS ENUM('party');--> statement-breakpoint
CREATE TYPE "onboarding"."import_row_status" AS ENUM('pending', 'invalid', 'applied');--> statement-breakpoint
CREATE TABLE "onboarding"."import_batches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"source_instance" text NOT NULL,
	"source_version" text,
	"object_kind" "onboarding"."import_object_kind" NOT NULL,
	"file_checksum" text NOT NULL,
	"mapping_revision" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"status" "onboarding"."import_batch_status" DEFAULT 'staged'::"onboarding"."import_batch_status" NOT NULL,
	"row_count" integer NOT NULL,
	"rehearsal" jsonb,
	"rehearsed_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "import_batches_file_key" UNIQUE("tenant_id","source_instance","object_kind","file_checksum","mapping_revision"),
	CONSTRAINT "import_batches_source_instance_check" CHECK ("source_instance" = btrim("source_instance") and "source_instance" ~ '[^[:space:]]'),
	CONSTRAINT "import_batches_file_checksum_check" CHECK ("file_checksum" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "import_batches_row_count_check" CHECK ("row_count" >= 0),
	CONSTRAINT "import_batches_rehearsed_check" CHECK (("status" = 'staged') = ("rehearsed_at" is null and "rehearsal" is null)),
	CONSTRAINT "import_batches_applied_check" CHECK (("status" = 'applied') = ("applied_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "onboarding"."import_rows" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"source_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"fields" jsonb NOT NULL,
	"status" "onboarding"."import_row_status" DEFAULT 'pending'::"onboarding"."import_row_status" NOT NULL,
	"errors" jsonb DEFAULT '[]' NOT NULL,
	"native_id" uuid,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_rows_batch_row_key" UNIQUE("batch_id","row_number"),
	CONSTRAINT "import_rows_row_number_check" CHECK ("row_number" >= 1),
	CONSTRAINT "import_rows_content_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "import_rows_errors_check" CHECK (jsonb_typeof("errors") = 'array'),
	CONSTRAINT "import_rows_invalid_check" CHECK (("status" = 'invalid') = (jsonb_array_length("errors") > 0)),
	CONSTRAINT "import_rows_applied_check" CHECK (("status" = 'applied') = ("native_id" is not null and "applied_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "onboarding"."source_identities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"source_instance" text NOT NULL,
	"object_kind" "onboarding"."import_object_kind" NOT NULL,
	"source_id" text NOT NULL,
	"native_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"batch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_identities_source_key" UNIQUE("tenant_id","source_instance","object_kind","source_id"),
	CONSTRAINT "source_identities_native_key" UNIQUE("tenant_id","source_instance","object_kind","native_id"),
	CONSTRAINT "source_identities_source_id_check" CHECK ("source_id" ~ '[^[:space:]]'),
	CONSTRAINT "source_identities_content_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "import_rows_batch_status_idx" ON "onboarding"."import_rows" ("batch_id","status","row_number");--> statement-breakpoint
ALTER TABLE "onboarding"."import_batches" ADD CONSTRAINT "import_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "onboarding"."import_rows" ADD CONSTRAINT "import_rows_batch_fkey" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "onboarding"."import_batches"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "onboarding"."source_identities" ADD CONSTRAINT "source_identities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "onboarding"."source_identities" ADD CONSTRAINT "source_identities_batch_fkey" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "onboarding"."import_batches"("tenant_id","id");