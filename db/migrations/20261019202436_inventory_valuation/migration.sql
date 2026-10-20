-- owner: inventory
-- reviewed: 2026-10-20
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: moving-average valuation per legal entity and item with per-movement valuation entries (ADR-0100)

CREATE TABLE "inventory"."item_valuations" (
	"tenant_id" uuid,
	"legal_entity_id" uuid,
	"item_id" uuid,
	"quantity" bigint DEFAULT 0 NOT NULL,
	"value" numeric(24,2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_valuations_pkey" PRIMARY KEY("tenant_id","legal_entity_id","item_id"),
	CONSTRAINT "item_valuations_amounts_check" CHECK ("quantity" >= 0 and "value" >= 0 and ("quantity" > 0 or "value" = 0))
);
--> statement-breakpoint
CREATE TABLE "inventory"."valuation_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"value" numeric(24,2) NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"journal_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valuation_entries_movement_key" UNIQUE("tenant_id","movement_id"),
	CONSTRAINT "valuation_entries_source_item_key" UNIQUE("tenant_id","source_type","source_id","item_id"),
	CONSTRAINT "valuation_entries_sign_check" CHECK (("quantity" > 0 and "value" >= 0) or ("quantity" < 0 and "value" <= 0)),
	CONSTRAINT "valuation_entries_source_check" CHECK ("source_type" ~ '^[a-z][a-z0-9_.]*$')
);
--> statement-breakpoint
ALTER TABLE "inventory"."movements" ADD CONSTRAINT "movements_tenant_id_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."item_valuations" ADD CONSTRAINT "item_valuations_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."item_valuations" ADD CONSTRAINT "item_valuations_item_fkey" FOREIGN KEY ("tenant_id","item_id") REFERENCES "inventory"."items"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."valuation_entries" ADD CONSTRAINT "valuation_entries_movement_fkey" FOREIGN KEY ("tenant_id","movement_id") REFERENCES "inventory"."movements"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."valuation_entries" ADD CONSTRAINT "valuation_entries_valuation_fkey" FOREIGN KEY ("tenant_id","legal_entity_id","item_id") REFERENCES "inventory"."item_valuations"("tenant_id","legal_entity_id","item_id");