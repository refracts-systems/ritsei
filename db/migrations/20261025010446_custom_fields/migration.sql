-- owners: custom_fields
-- reviewed: 2026-10-25
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: store the custom field definitions a tenant adds to documents whose owners released
--   the extension point, and the values on those documents (ADR-0109). New schema, no backfill.

CREATE SCHEMA "custom_fields";
--> statement-breakpoint
CREATE TYPE "custom_fields"."custom_field_kind" AS ENUM('text', 'number', 'date', 'boolean', 'choice');--> statement-breakpoint
CREATE TABLE "custom_fields"."custom_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"kind" "custom_fields"."custom_field_kind" NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"choices" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_definitions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "custom_field_definitions_key" UNIQUE("tenant_id","document_type","key"),
	CONSTRAINT "custom_field_definitions_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "custom_field_definitions_document_type_check" CHECK ("document_type" ~ '^[a-z][a-z0-9_]*[.][a-z][a-z0-9_]*$'),
	CONSTRAINT "custom_field_definitions_label_check" CHECK ("label" ~ '[^[:space:]]'),
	CONSTRAINT "custom_field_definitions_choices_check" CHECK (("kind" = 'choice') = ("choices" is not null and jsonb_typeof("choices") = 'array' and jsonb_array_length("choices") > 0))
);
--> statement-breakpoint
CREATE TABLE "custom_fields"."custom_field_values" (
	"tenant_id" uuid,
	"document_type" text,
	"document_id" uuid,
	"key" text,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_values_pkey" PRIMARY KEY("tenant_id","document_type","document_id","key")
);
--> statement-breakpoint
ALTER TABLE "custom_fields"."custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "custom_fields"."custom_field_values" ADD CONSTRAINT "custom_field_values_definition_fkey" FOREIGN KEY ("tenant_id","document_type","key") REFERENCES "custom_fields"."custom_field_definitions"("tenant_id","document_type","key") ON DELETE RESTRICT;