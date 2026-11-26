-- owners: inventory
-- reviewed: 2026-11-26
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: ADR-0137 stores the lots or serials a tracked transfer line moves, as an object checked by the database and validated against the item tracking mode by the service

ALTER TABLE "inventory"."stock_transfer_lines" ADD COLUMN "identity" jsonb;--> statement-breakpoint
ALTER TABLE "inventory"."stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_identity_check" CHECK ("identity" is null or jsonb_typeof("identity") = 'object');