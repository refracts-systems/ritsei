-- owners: billing
-- reviewed: 2026-11-04
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: preserve versioned invoice render inputs and their single verified PDF (ADR-0112).

CREATE TABLE "billing"."invoice_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"ast_id" uuid NOT NULL,
	"render_fingerprint" text NOT NULL,
	"content_hash" text NOT NULL,
	"content" bytea NOT NULL,
	"page_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_artifacts_invoice_key" UNIQUE("tenant_id","invoice_id"),
	CONSTRAINT "invoice_artifacts_pages_check" CHECK ("page_count" > 0),
	CONSTRAINT "invoice_artifacts_content_check" CHECK (octet_length("content") >= 5 and octet_length("content") <= 50000000 and
      substring("content" from 1 for 5) = decode('255044462d', 'hex') and
      "content_hash" = encode(sha256("content"), 'hex'))
);
--> statement-breakpoint
CREATE TABLE "billing"."invoice_render_inputs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_kind" "billing"."invoice_kind" DEFAULT 'customer_invoice'::"billing"."invoice_kind" NOT NULL,
	"snapshot_checksum" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"ast_id" uuid NOT NULL,
	"ast_checksum" text NOT NULL,
	"ast" jsonb NOT NULL,
	"render_fingerprint" text NOT NULL,
	"render_request" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_render_inputs_invoice_key" UNIQUE("tenant_id","invoice_id"),
	CONSTRAINT "invoice_render_inputs_artifact_fkey_key" UNIQUE("tenant_id","invoice_id","id","ast_id","render_fingerprint"),
	CONSTRAINT "invoice_render_inputs_kind_check" CHECK ("invoice_kind" = 'customer_invoice'),
	CONSTRAINT "invoice_render_inputs_hashes_check" CHECK ("snapshot_checksum" ~ '^[0-9a-f]{64}$' and
      "ast_checksum" ~ '^[0-9a-f]{64}$' and "render_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "invoice_render_inputs_snapshot_check" CHECK ((jsonb_typeof("snapshot") = 'object' and
      "snapshot"->>'snapshotId' = "id"::text and
      "snapshot"->>'tenantId' = "tenant_id"::text and
      "snapshot"->>'checksum' = "snapshot_checksum" and
      "snapshot"->'source'->>'owner' = 'billing' and
      "snapshot"->'source'->>'type' = 'customer_invoice' and
      "snapshot"->'source'->>'id' = "invoice_id"::text and
      "snapshot"->'payload'->>'number' = "invoice_number") is true),
	CONSTRAINT "invoice_render_inputs_ast_check" CHECK ((jsonb_typeof("ast") = 'object' and
      "ast"->>'astId' = "ast_id"::text and
      "ast"->>'snapshotId' = "id"::text and
      "ast"->>'checksum' = "ast_checksum" and
      "ast"->>'documentType' = 'customer_invoice') is true),
	CONSTRAINT "invoice_render_inputs_request_check" CHECK ((jsonb_typeof("render_request") = 'object' and
      "render_request"->>'tenantId' = "tenant_id"::text and
      "render_request"->>'snapshotId' = "id"::text and
      "render_request"->>'snapshotChecksum' = "snapshot_checksum" and
      "render_request"->>'astId' = "ast_id"::text and
      "render_request"->>'astChecksum' = "ast_checksum" and
      "render_request"->>'renderFingerprint' = "render_fingerprint" and
      "render_request"->>'fingerprintVersion' = '2') is true)
);
--> statement-breakpoint
ALTER TABLE "billing"."invoices" ADD CONSTRAINT "invoices_tenant_id_number_kind_key" UNIQUE("tenant_id","id","number","kind");--> statement-breakpoint
ALTER TABLE "billing"."invoice_artifacts" ADD CONSTRAINT "invoice_artifacts_render_input_fkey" FOREIGN KEY ("tenant_id","invoice_id","snapshot_id","ast_id","render_fingerprint") REFERENCES "billing"."invoice_render_inputs"("tenant_id","invoice_id","id","ast_id","render_fingerprint");--> statement-breakpoint
ALTER TABLE "billing"."invoice_render_inputs" ADD CONSTRAINT "invoice_render_inputs_invoice_fkey" FOREIGN KEY ("tenant_id","invoice_id","invoice_number","invoice_kind") REFERENCES "billing"."invoices"("tenant_id","id","number","kind");
