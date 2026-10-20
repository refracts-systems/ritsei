-- owners: billing, settlement
-- reviewed: 2026-10-20
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: record the business date of each settlement and allocation so open items and
--   unallocated payments can be aged as of any date (ADR-0102). Existing rows are backfilled
--   with the later of their creation date and their document's date.

ALTER TABLE "billing"."invoice_settlements" ADD COLUMN "settled_on" date;--> statement-breakpoint
ALTER TABLE "settlement"."payment_allocations" ADD COLUMN "allocated_on" date;--> statement-breakpoint
ALTER TABLE "billing"."invoice_settlements" DISABLE TRIGGER billing_invoice_settlements_immutable_trigger;--> statement-breakpoint
UPDATE "billing"."invoice_settlements" AS s
SET "settled_on" = greatest(s."created_at"::date, i."invoice_date")
FROM "billing"."invoices" AS i
WHERE i."tenant_id" = s."tenant_id" AND i."id" = s."invoice_id";--> statement-breakpoint
ALTER TABLE "billing"."invoice_settlements" ENABLE TRIGGER billing_invoice_settlements_immutable_trigger;--> statement-breakpoint
ALTER TABLE "settlement"."payment_allocations" DISABLE TRIGGER settlement_payment_allocations_immutable_trigger;--> statement-breakpoint
UPDATE "settlement"."payment_allocations" AS a
SET "allocated_on" = greatest(a."created_at"::date, p."payment_date")
FROM "settlement"."payments" AS p
WHERE p."tenant_id" = a."tenant_id" AND p."id" = a."payment_id";--> statement-breakpoint
ALTER TABLE "settlement"."payment_allocations" ENABLE TRIGGER settlement_payment_allocations_immutable_trigger;--> statement-breakpoint
ALTER TABLE "billing"."invoice_settlements" ALTER COLUMN "settled_on" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "settlement"."payment_allocations" ALTER COLUMN "allocated_on" SET NOT NULL;
