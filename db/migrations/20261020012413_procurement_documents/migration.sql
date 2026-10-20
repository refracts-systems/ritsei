-- owner: procurement
-- reviewed: 2026-10-20
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: supplier prices, purchase order line tax terms, and purchase returns (ADR-0104)

CREATE TABLE "procurement"."purchase_order_line_terms" (
	"tenant_id" uuid,
	"purchase_order_id" uuid NOT NULL,
	"purchase_order_line_id" uuid,
	"tax_code_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_line_terms_pkey" PRIMARY KEY("tenant_id","purchase_order_line_id")
);
--> statement-breakpoint
CREATE TABLE "procurement"."purchase_return_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"purchase_order_line_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_return_lines_return_line_key" UNIQUE("tenant_id","return_id","purchase_order_line_id"),
	CONSTRAINT "purchase_return_lines_quantity_check" CHECK ("quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "procurement"."purchase_returns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"number" text NOT NULL,
	"return_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_returns_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_returns_tenant_order_id_key" UNIQUE("tenant_id","purchase_order_id","id")
);
--> statement-breakpoint
CREATE TABLE "procurement"."supplier_prices" (
	"tenant_id" uuid,
	"supplier_account_id" uuid,
	"product_id" uuid,
	"unit_price" numeric(24,2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_prices_pkey" PRIMARY KEY("tenant_id","supplier_account_id","product_id"),
	CONSTRAINT "supplier_prices_unit_price_check" CHECK ("unit_price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "procurement"."purchase_order_line_terms" ADD CONSTRAINT "purchase_order_line_terms_line_fkey" FOREIGN KEY ("tenant_id","purchase_order_id","purchase_order_line_id") REFERENCES "procurement"."purchase_order_lines"("tenant_id","purchase_order_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "procurement"."purchase_order_line_terms" ADD CONSTRAINT "purchase_order_line_terms_tax_code_fkey" FOREIGN KEY ("tenant_id","tax_code_id") REFERENCES "tax"."tax_codes"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "procurement"."purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_return_fkey" FOREIGN KEY ("tenant_id","purchase_order_id","return_id") REFERENCES "procurement"."purchase_returns"("tenant_id","purchase_order_id","id");--> statement-breakpoint
ALTER TABLE "procurement"."purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_order_line_fkey" FOREIGN KEY ("tenant_id","purchase_order_id","purchase_order_line_id") REFERENCES "procurement"."purchase_order_lines"("tenant_id","purchase_order_id","id");--> statement-breakpoint
ALTER TABLE "procurement"."purchase_returns" ADD CONSTRAINT "purchase_returns_purchase_order_fkey" FOREIGN KEY ("tenant_id","purchase_order_id") REFERENCES "procurement"."purchase_orders"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "procurement"."supplier_prices" ADD CONSTRAINT "supplier_prices_supplier_account_fkey" FOREIGN KEY ("tenant_id","supplier_account_id") REFERENCES "procurement"."supplier_accounts"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "procurement"."supplier_prices" ADD CONSTRAINT "supplier_prices_product_fkey" FOREIGN KEY ("tenant_id","product_id") REFERENCES "product"."products"("tenant_id","id");