-- owner: product
-- reviewed: 2026-10-20
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: product master owned by the product module (ADR-0097)

CREATE SCHEMA "product";
--> statement-breakpoint
CREATE TYPE "product"."product_type" AS ENUM('stockable', 'consumable', 'service');--> statement-breakpoint
CREATE TABLE "product"."products" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "product"."product_type" NOT NULL,
	"category" text,
	"unit_of_measure" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "products_tenant_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "products_code_check" CHECK ("code" = upper(btrim("code")) and "code" ~ '[^[:space:]]'),
	CONSTRAINT "products_name_check" CHECK ("name" = btrim("name") and "name" ~ '[^[:space:]]'),
	CONSTRAINT "products_category_check" CHECK ("category" is null or ("category" = btrim("category") and "category" ~ '[^[:space:]]')),
	CONSTRAINT "products_unit_of_measure_check" CHECK ("unit_of_measure" ~ '^[A-Z][A-Z0-9_-]*$')
);
--> statement-breakpoint
ALTER TABLE "product"."products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;