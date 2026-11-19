-- owners: billing
-- reviewed: 2026-11-19
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: retain the bytes of documents issued by the incumbent system as evidence, apart from
--   rendered invoice artifacts, with the hash and size recomputed by the database (ADR-0120).
--   New table, no backfill.

CREATE TABLE "billing"."imported_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid,
	"source_system" text NOT NULL,
	"source_reference" text NOT NULL,
	"filename" text NOT NULL,
	"media_type" text NOT NULL,
	"content_hash" text NOT NULL,
	"byte_size" integer NOT NULL,
	"content" bytea NOT NULL,
	"imported_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "imported_artifacts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "imported_artifacts_source_key" UNIQUE("tenant_id","source_system","source_reference"),
	CONSTRAINT "imported_artifacts_source_check" CHECK ("source_system" ~ '^[a-z][a-z0-9._-]*$' and
      "source_reference" ~ '[^[:space:]]' and char_length("source_reference") <= 256),
	CONSTRAINT "imported_artifacts_filename_check" CHECK ("filename" ~ '[^[:space:]]' and char_length("filename") <= 255 and
      strpos("filename", '/') = 0 and strpos("filename", chr(92)) = 0 and
      "filename" !~ '[[:cntrl:]]'),
	CONSTRAINT "imported_artifacts_media_type_check" CHECK ("media_type" ~ '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$' and
      char_length("media_type") <= 127),
	CONSTRAINT "imported_artifacts_hash_check" CHECK ("content_hash" = encode(sha256("content"), 'hex')),
	CONSTRAINT "imported_artifacts_size_check" CHECK ("byte_size" = octet_length("content") and
      "byte_size" between 1 and 10485760)
);
--> statement-breakpoint
CREATE INDEX "imported_artifacts_invoice_idx" ON "billing"."imported_artifacts" ("tenant_id","invoice_id");--> statement-breakpoint
ALTER TABLE "billing"."imported_artifacts" ADD CONSTRAINT "imported_artifacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id");--> statement-breakpoint
ALTER TABLE "billing"."imported_artifacts" ADD CONSTRAINT "imported_artifacts_invoice_fkey" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "billing"."invoices"("tenant_id","id");