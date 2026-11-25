-- owners: procurement, sales
-- reviewed: 2026-11-25
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: sales orders, purchase orders, and quotations carry an ADR-0095 number that exists only once the document is confirmed or sent; a draft has none. A purchase order also records the supplier's legal entity at confirmation, the scope of its number. Existing documents are not backfilled: confirmed orders are immutable by trigger

ALTER TABLE "sales"."orders" ADD COLUMN "number" text;--> statement-breakpoint
ALTER TABLE "procurement"."purchase_orders" ADD COLUMN "number" text;--> statement-breakpoint
ALTER TABLE "procurement"."purchase_orders" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "sales"."quotations" ADD COLUMN "number" text;--> statement-breakpoint
ALTER TABLE "procurement"."purchase_orders" ADD CONSTRAINT "purchase_orders_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "sales"."orders" ADD CONSTRAINT "orders_draft_number_check" CHECK ("status" <> 'draft' or "number" is null);--> statement-breakpoint
ALTER TABLE "procurement"."purchase_orders" ADD CONSTRAINT "purchase_orders_draft_number_check" CHECK ("status" <> 'draft' or "number" is null);--> statement-breakpoint
ALTER TABLE "sales"."quotations" ADD CONSTRAINT "quotations_draft_number_check" CHECK ("status" <> 'draft' or "number" is null);