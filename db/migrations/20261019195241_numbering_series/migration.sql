-- owner: numbering
-- reviewed: 2026-10-20
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: gapless document number series per legal entity, document type, and fiscal year (ADR-0095)

CREATE SCHEMA "numbering";
--> statement-breakpoint
CREATE TABLE "numbering"."issued_numbers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"value" bigint NOT NULL,
	"number" text NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issued_numbers_series_value_key" UNIQUE("series_id","value"),
	CONSTRAINT "issued_numbers_series_document_key" UNIQUE("series_id","document_id"),
	CONSTRAINT "issued_numbers_tenant_series_number_key" UNIQUE("tenant_id","series_id","number"),
	CONSTRAINT "issued_numbers_value_check" CHECK ("value" >= 1)
);
--> statement-breakpoint
CREATE TABLE "numbering"."number_series" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"scope_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"period_key" text NOT NULL,
	"prefix" text NOT NULL,
	"padding" integer NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "number_series_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "number_series_scope_type_period_key" UNIQUE("tenant_id","scope_id","document_type","period_key"),
	CONSTRAINT "number_series_document_type_check" CHECK ("document_type" ~ '^[a-z][a-z0-9_.]*$'),
	CONSTRAINT "number_series_period_key_check" CHECK ("period_key" ~ '^[0-9]{4}$'),
	CONSTRAINT "number_series_prefix_check" CHECK ("prefix" = btrim("prefix") and length("prefix") <= 32),
	CONSTRAINT "number_series_padding_check" CHECK ("padding" between 1 and 12),
	CONSTRAINT "number_series_next_value_check" CHECK ("next_value" >= 1)
);
--> statement-breakpoint
ALTER TABLE "numbering"."issued_numbers" ADD CONSTRAINT "issued_numbers_series_fkey" FOREIGN KEY ("tenant_id","series_id") REFERENCES "numbering"."number_series"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "numbering"."number_series" ADD CONSTRAINT "number_series_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;