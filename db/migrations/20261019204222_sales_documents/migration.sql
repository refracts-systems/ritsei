-- owner: sales
-- reviewed: 2026-10-20
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: customers as party roles, price lists, quotation lines, order line terms, and delivery evidence (ADR-0099, ADR-0101)

CREATE TABLE "sales"."deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"number" text NOT NULL,
	"delivery_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "deliveries_tenant_order_id_key" UNIQUE("tenant_id","order_id","id"),
	CONSTRAINT "deliveries_legal_entity_number_key" UNIQUE("tenant_id","legal_entity_id","number")
);
--> statement-breakpoint
CREATE TABLE "sales"."delivery_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_lines_delivery_order_line_key" UNIQUE("tenant_id","delivery_id","order_line_id"),
	CONSTRAINT "delivery_lines_quantity_check" CHECK ("quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales"."order_line_terms" (
	"tenant_id" uuid,
	"order_line_id" uuid,
	"list_price" numeric(24,2) NOT NULL,
	"discount_percent" numeric(5,2) DEFAULT '0' NOT NULL,
	"tax_code_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_line_terms_pkey" PRIMARY KEY("tenant_id","order_line_id"),
	CONSTRAINT "order_line_terms_price_check" CHECK ("list_price" >= 0 and "discount_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "sales"."price_list_items" (
	"tenant_id" uuid,
	"price_list_id" uuid,
	"product_id" uuid,
	"unit_price" numeric(24,2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_items_pkey" PRIMARY KEY("tenant_id","price_list_id","product_id"),
	CONSTRAINT "price_list_items_unit_price_check" CHECK ("unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales"."price_lists" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_lists_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "price_lists_tenant_name_key" UNIQUE("tenant_id","name"),
	CONSTRAINT "price_lists_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "price_lists_name_check" CHECK ("name" = btrim("name") and "name" ~ '[^[:space:]]')
);
--> statement-breakpoint
CREATE TABLE "sales"."quotation_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"quotation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"list_price" numeric(24,2) NOT NULL,
	"discount_percent" numeric(5,2) DEFAULT '0' NOT NULL,
	"unit_price" numeric(24,2) NOT NULL,
	"tax_code_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotation_lines_quantity_check" CHECK ("quantity" > 0),
	CONSTRAINT "quotation_lines_price_check" CHECK ("list_price" >= 0 and "unit_price" >= 0 and "discount_percent" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN "party_id" uuid;--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN "party_relationship_id" uuid;--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN "price_list_id" uuid;--> statement-breakpoint
ALTER TABLE "sales"."orders" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "sales"."quotations" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "sales"."quotations" ADD COLUMN "valid_until" date;--> statement-breakpoint
ALTER TABLE "sales"."quotations" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales"."quotations" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD CONSTRAINT "customers_tenant_party_relationship_key" UNIQUE("tenant_id","party_relationship_id");--> statement-breakpoint
ALTER TABLE "sales"."order_lines" ADD CONSTRAINT "order_lines_tenant_id_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "sales"."order_lines" ADD CONSTRAINT "order_lines_tenant_order_id_key" UNIQUE("tenant_id","order_id","id");--> statement-breakpoint
CREATE INDEX "delivery_lines_order_line_idx" ON "sales"."delivery_lines" ("tenant_id","order_line_id");--> statement-breakpoint
CREATE INDEX "quotation_lines_tenant_quotation_idx" ON "sales"."quotation_lines" ("tenant_id","quotation_id");--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD CONSTRAINT "customers_party_relationship_fkey" FOREIGN KEY ("tenant_id","party_relationship_id") REFERENCES "party"."party_relationships"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD CONSTRAINT "customers_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "sales"."deliveries" ADD CONSTRAINT "deliveries_order_fkey" FOREIGN KEY ("tenant_id","order_id") REFERENCES "sales"."orders"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "sales"."delivery_lines" ADD CONSTRAINT "delivery_lines_delivery_fkey" FOREIGN KEY ("tenant_id","order_id","delivery_id") REFERENCES "sales"."deliveries"("tenant_id","order_id","id");--> statement-breakpoint
ALTER TABLE "sales"."delivery_lines" ADD CONSTRAINT "delivery_lines_order_line_fkey" FOREIGN KEY ("tenant_id","order_id","order_line_id") REFERENCES "sales"."order_lines"("tenant_id","order_id","id");--> statement-breakpoint
ALTER TABLE "sales"."order_line_terms" ADD CONSTRAINT "order_line_terms_order_line_fkey" FOREIGN KEY ("tenant_id","order_line_id") REFERENCES "sales"."order_lines"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sales"."order_line_terms" ADD CONSTRAINT "order_line_terms_tax_code_fkey" FOREIGN KEY ("tenant_id","tax_code_id") REFERENCES "tax"."tax_codes"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "sales"."orders" ADD CONSTRAINT "orders_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "sales"."price_list_items" ADD CONSTRAINT "price_list_items_price_list_fkey" FOREIGN KEY ("tenant_id","price_list_id") REFERENCES "sales"."price_lists"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sales"."price_list_items" ADD CONSTRAINT "price_list_items_product_fkey" FOREIGN KEY ("tenant_id","product_id") REFERENCES "product"."products"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "sales"."price_lists" ADD CONSTRAINT "price_lists_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sales"."quotation_lines" ADD CONSTRAINT "quotation_lines_quotation_fkey" FOREIGN KEY ("tenant_id","quotation_id") REFERENCES "sales"."quotations"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sales"."quotation_lines" ADD CONSTRAINT "quotation_lines_product_fkey" FOREIGN KEY ("tenant_id","product_id") REFERENCES "product"."products"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "sales"."quotation_lines" ADD CONSTRAINT "quotation_lines_tax_code_fkey" FOREIGN KEY ("tenant_id","tax_code_id") REFERENCES "tax"."tax_codes"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD CONSTRAINT "customers_party_role_check" CHECK (("party_id" is null and "party_relationship_id" is null and "legal_entity_id" is null) or
      ("party_id" is not null and "party_relationship_id" is not null and "legal_entity_id" is not null));