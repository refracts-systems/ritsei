-- owners: procurement
-- reviewed: 2026-11-25
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: a goods receipt is numbered GR/ (ADR-0095) but the number lived only in numbering.issued_numbers; the receipt now records it at insert so it can be found by number (decision K3, gap G-20). Receipts recorded before this are not backfilled: receipt facts are immutable by trigger

ALTER TABLE "procurement"."purchase_receipts" ADD COLUMN "number" text;--> statement-breakpoint
CREATE INDEX "purchase_receipts_tenant_number_idx" ON "procurement"."purchase_receipts" ("tenant_id","number");
