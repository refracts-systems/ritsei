-- owner: settlement
-- reviewed: 2026-10-20
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: payment terms, receipts and payments, and their allocations to billing documents (ADR-0102)

CREATE SCHEMA "settlement";
--> statement-breakpoint
CREATE TYPE "settlement"."payment_direction" AS ENUM('incoming', 'outgoing');--> statement-breakpoint
CREATE TYPE "settlement"."settlement_side" AS ENUM('receivable', 'payable');--> statement-breakpoint
CREATE TABLE "settlement"."party_payment_terms" (
	"tenant_id" uuid,
	"party_id" uuid,
	"side" "settlement"."settlement_side",
	"payment_term_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_payment_terms_pkey" PRIMARY KEY("tenant_id","party_id","side")
);
--> statement-breakpoint
CREATE TABLE "settlement"."payment_allocations" (
	"tenant_id" uuid,
	"payment_id" uuid,
	"invoice_id" uuid,
	"amount" numeric(24,2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_pkey" PRIMARY KEY("tenant_id","payment_id","invoice_id"),
	CONSTRAINT "payment_allocations_amount_check" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "settlement"."payment_terms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"net_days" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_terms_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_terms_tenant_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "payment_terms_net_days_check" CHECK ("net_days" between 0 and 3650),
	CONSTRAINT "payment_terms_code_check" CHECK ("code" = upper(btrim("code")) and "code" ~ '[^[:space:]]')
);
--> statement-breakpoint
CREATE TABLE "settlement"."payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"direction" "settlement"."payment_direction" NOT NULL,
	"party_id" uuid NOT NULL,
	"number" text NOT NULL,
	"payment_date" date NOT NULL,
	"amount" numeric(24,2) NOT NULL,
	"unallocated_amount" numeric(24,2) NOT NULL,
	"cash_account_id" uuid,
	"journal_entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payments_legal_entity_direction_number_key" UNIQUE("tenant_id","legal_entity_id","direction","number"),
	CONSTRAINT "payments_amounts_check" CHECK ("amount" > 0 and "unallocated_amount" >= 0 and "unallocated_amount" <= "amount")
);
--> statement-breakpoint
ALTER TABLE "settlement"."party_payment_terms" ADD CONSTRAINT "party_payment_terms_party_fkey" FOREIGN KEY ("tenant_id","party_id") REFERENCES "party"."parties"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "settlement"."party_payment_terms" ADD CONSTRAINT "party_payment_terms_term_fkey" FOREIGN KEY ("tenant_id","payment_term_id") REFERENCES "settlement"."payment_terms"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "settlement"."payment_allocations" ADD CONSTRAINT "payment_allocations_payment_fkey" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "settlement"."payments"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "settlement"."payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_fkey" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "billing"."invoices"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "settlement"."payment_terms" ADD CONSTRAINT "payment_terms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "settlement"."payments" ADD CONSTRAINT "payments_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "settlement"."payments" ADD CONSTRAINT "payments_party_fkey" FOREIGN KEY ("tenant_id","party_id") REFERENCES "party"."parties"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "settlement"."payments" ADD CONSTRAINT "payments_cash_account_fkey" FOREIGN KEY ("tenant_id","cash_account_id") REFERENCES "accounting"."accounts"("tenant_id","id");