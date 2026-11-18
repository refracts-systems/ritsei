-- owners: tax
-- reviewed: 2026-11-19
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: give a tax code dated rates, so a rate change is a new row and the rate follows the
--   transaction date (ADR-0111). New table, no backfill: a code without periods keeps its own rate.

CREATE TABLE "tax"."tax_code_rates" (
	"tenant_id" uuid,
	"tax_code_id" uuid,
	"effective_from" date,
	"rate" numeric(7,4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_code_rates_pkey" PRIMARY KEY("tenant_id","tax_code_id","effective_from"),
	CONSTRAINT "tax_code_rates_rate_check" CHECK ("rate" >= 0 and "rate" <= 100)
);
--> statement-breakpoint
ALTER TABLE "tax"."tax_code_rates" ADD CONSTRAINT "tax_code_rates_tax_code_fkey" FOREIGN KEY ("tenant_id","tax_code_id") REFERENCES "tax"."tax_codes"("tenant_id","id");