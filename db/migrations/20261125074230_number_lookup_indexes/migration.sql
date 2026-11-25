-- owners: billing, procurement, sales, settlement
-- reviewed: 2026-11-25
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: look up a document by its number within a tenant (exact lookup, decision K3); the existing uniques lead with the legal entity

CREATE INDEX "deliveries_tenant_number_idx" ON "sales"."deliveries" ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "invoices_tenant_number_idx" ON "billing"."invoices" ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "orders_tenant_number_idx" ON "sales"."orders" ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "payments_tenant_number_idx" ON "settlement"."payments" ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_number_idx" ON "procurement"."purchase_orders" ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "purchase_returns_tenant_number_idx" ON "procurement"."purchase_returns" ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "quotations_tenant_number_idx" ON "sales"."quotations" ("tenant_id","number");