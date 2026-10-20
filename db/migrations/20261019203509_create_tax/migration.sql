-- owner: tax
-- reviewed: 2026-10-20
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: neutral tax codes and per-product tax defaults owned by the tax module (ADR-0098)

CREATE SCHEMA "tax";
--> statement-breakpoint
CREATE TYPE "tax"."tax_direction" AS ENUM('sales', 'purchase');--> statement-breakpoint
CREATE TABLE "tax"."product_tax_defaults" (
	"tenant_id" uuid,
	"product_id" uuid,
	"direction" "tax"."tax_direction",
	"tax_code_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_tax_defaults_pkey" PRIMARY KEY("tenant_id","product_id","direction")
);
--> statement-breakpoint
CREATE TABLE "tax"."tax_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(7,4) NOT NULL,
	"direction" "tax"."tax_direction" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_codes_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "tax_codes_tenant_id_direction_key" UNIQUE("tenant_id","id","direction"),
	CONSTRAINT "tax_codes_tenant_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "tax_codes_code_check" CHECK ("code" = upper(btrim("code")) and "code" ~ '[^[:space:]]'),
	CONSTRAINT "tax_codes_name_check" CHECK ("name" = btrim("name") and "name" ~ '[^[:space:]]'),
	CONSTRAINT "tax_codes_rate_check" CHECK ("rate" >= 0 and "rate" <= 100)
);
--> statement-breakpoint
ALTER TABLE "tax"."product_tax_defaults" ADD CONSTRAINT "product_tax_defaults_product_fkey" FOREIGN KEY ("tenant_id","product_id") REFERENCES "product"."products"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "tax"."product_tax_defaults" ADD CONSTRAINT "product_tax_defaults_tax_code_fkey" FOREIGN KEY ("tenant_id","tax_code_id","direction") REFERENCES "tax"."tax_codes"("tenant_id","id","direction");--> statement-breakpoint
ALTER TABLE "tax"."tax_codes" ADD CONSTRAINT "tax_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;