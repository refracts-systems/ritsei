-- owner: inventory
-- reviewed: 2026-11-19
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: record the approved opening stock position, source value, and one-time revaluation to
--   moving average per warehouse and item at cutover (ADR-0118). New table, no backfill.

CREATE TABLE "inventory"."opening_stock_positions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"cutoff_date" date NOT NULL,
	"quantity" bigint NOT NULL,
	"source_value" numeric(24,2) NOT NULL,
	"adjustment" numeric(24,2) DEFAULT '0' NOT NULL,
	"adjustment_name" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"approval_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opening_stock_positions_warehouse_item_key" UNIQUE("tenant_id","warehouse_id","item_id"),
	CONSTRAINT "opening_stock_positions_movement_key" UNIQUE("tenant_id","movement_id"),
	CONSTRAINT "opening_stock_positions_amounts_check" CHECK ("quantity" > 0 and "source_value" >= 0 and
      "source_value" + "adjustment" >= 0),
	CONSTRAINT "opening_stock_positions_approval_check" CHECK (("adjustment_name" is null and "approved_by" is null and
        "approved_at" is null and "approval_reference" is null and
        "adjustment" = 0) or
      ("adjustment_name" ~ '[^[:space:]]' and "approved_by" ~ '[^[:space:]]' and
        "approved_at" is not null and "approval_reference" ~ '[^[:space:]]'))
);
--> statement-breakpoint
ALTER TABLE "inventory"."opening_stock_positions" ADD CONSTRAINT "opening_stock_positions_warehouse_fkey" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "inventory"."warehouses"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."opening_stock_positions" ADD CONSTRAINT "opening_stock_positions_item_fkey" FOREIGN KEY ("tenant_id","item_id") REFERENCES "inventory"."items"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."opening_stock_positions" ADD CONSTRAINT "opening_stock_positions_movement_fkey" FOREIGN KEY ("tenant_id","movement_id") REFERENCES "inventory"."movements"("tenant_id","id");