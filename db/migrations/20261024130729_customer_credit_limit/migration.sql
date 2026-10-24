-- owners: sales
-- reviewed: 2026-10-24
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: let a tenant cap what one customer may owe (ADR-0108). Null means no limit, so
--   existing customers are unchanged.

ALTER TABLE "sales"."customers" ADD COLUMN "credit_limit" numeric(24,2);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD CONSTRAINT "customers_credit_limit_check" CHECK ("credit_limit" is null or "credit_limit" >= 0);