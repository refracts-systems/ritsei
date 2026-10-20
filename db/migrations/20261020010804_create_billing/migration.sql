-- owner: billing
-- reviewed: 2026-10-20
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: posted billing documents, lines, settlements, and billing source locks (ADR-0102)

CREATE SCHEMA "billing";
--> statement-breakpoint
CREATE TYPE "billing"."invoice_kind" AS ENUM('customer_invoice', 'customer_credit_note', 'supplier_bill', 'supplier_credit_note');--> statement-breakpoint
CREATE TABLE "billing"."billing_sources" (
	"tenant_id" uuid,
	"source_type" text,
	"source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_sources_pkey" PRIMARY KEY("tenant_id","source_type","source_id")
);
--> statement-breakpoint
CREATE TABLE "billing"."invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"quantity" bigint NOT NULL,
	"unit_price" numeric(24,2) NOT NULL,
	"net_amount" numeric(24,2) NOT NULL,
	"tax_code_id" uuid,
	"tax_amount" numeric(24,2) NOT NULL,
	"source_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_lines_amounts_check" CHECK ("quantity" > 0 and "unit_price" >= 0 and "tax_amount" >= 0 and
      "net_amount" = "unit_price" * "quantity")
);
--> statement-breakpoint
CREATE TABLE "billing"."invoice_settlements" (
	"tenant_id" uuid,
	"invoice_id" uuid,
	"source_type" text,
	"source_id" uuid,
	"amount" numeric(24,2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_settlements_pkey" PRIMARY KEY("tenant_id","invoice_id","source_type","source_id"),
	CONSTRAINT "invoice_settlements_amount_check" CHECK ("amount" > 0),
	CONSTRAINT "invoice_settlements_source_check" CHECK ("source_type" ~ '^[a-z][a-z0-9_.]*$')
);
--> statement-breakpoint
CREATE TABLE "billing"."invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"kind" "billing"."invoice_kind" NOT NULL,
	"party_id" uuid NOT NULL,
	"number" text NOT NULL,
	"invoice_date" date NOT NULL,
	"subtotal" numeric(24,2) NOT NULL,
	"tax_total" numeric(24,2) NOT NULL,
	"total" numeric(24,2) NOT NULL,
	"open_amount" numeric(24,2) NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"credited_invoice_id" uuid,
	"supplier_reference" text,
	"journal_entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoices_legal_entity_kind_number_key" UNIQUE("tenant_id","legal_entity_id","kind","number"),
	CONSTRAINT "invoices_amounts_check" CHECK ("subtotal" >= 0 and "tax_total" >= 0 and
      "total" = "subtotal" + "tax_total" and
      "open_amount" >= 0 and "open_amount" <= "total"),
	CONSTRAINT "invoices_credit_reference_check" CHECK (("kind" in ('customer_credit_note', 'supplier_credit_note')) = ("credited_invoice_id" is not null)),
	CONSTRAINT "invoices_source_check" CHECK (("source_type" is null and "source_id" is null) or
      ("source_type" ~ '^[a-z][a-z0-9_.]*$' and "source_id" is not null))
);
--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "billing"."invoice_lines" ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_source_line_idx" ON "billing"."invoice_lines" ("tenant_id","source_line_id");--> statement-breakpoint
CREATE INDEX "invoices_open_items_idx" ON "billing"."invoices" ("tenant_id","legal_entity_id","party_id");--> statement-breakpoint
CREATE INDEX "invoices_source_idx" ON "billing"."invoices" ("tenant_id","source_type","source_id");--> statement-breakpoint
ALTER TABLE "billing"."billing_sources" ADD CONSTRAINT "billing_sources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billing"."invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_fkey" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "billing"."invoices"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "billing"."invoice_settlements" ADD CONSTRAINT "invoice_settlements_invoice_fkey" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "billing"."invoices"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "billing"."invoices" ADD CONSTRAINT "invoices_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "billing"."invoices" ADD CONSTRAINT "invoices_party_fkey" FOREIGN KEY ("tenant_id","party_id") REFERENCES "party"."parties"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "billing"."invoices" ADD CONSTRAINT "invoices_credited_invoice_fkey" FOREIGN KEY ("tenant_id","credited_invoice_id") REFERENCES "billing"."invoices"("tenant_id","id");