-- owner: billing
-- reviewed: 2026-10-20
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: matched value per bill line so supplier credit notes return goods received not invoiced at the value the bill cleared (ADR-0104)

ALTER TABLE "billing"."invoice_lines" ADD COLUMN "matched_value" numeric(24,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing"."invoice_lines" ADD CONSTRAINT "invoice_lines_matched_value_check" CHECK ("matched_value" >= 0);