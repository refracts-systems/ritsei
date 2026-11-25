-- owners: inventory
-- reviewed: 2026-11-25
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: ADR-0131 gives an item a tracking mode, lots with per-warehouse balances, and serial units; a trigger keeps stock of a tracked item from moving without the identity that only the valued receipt and issue write

CREATE TYPE "inventory"."item_tracking" AS ENUM('none', 'lot', 'serial');--> statement-breakpoint
CREATE TYPE "inventory"."serial_status" AS ENUM('in_stock', 'issued', 'returned_to_supplier');--> statement-breakpoint
CREATE TABLE "inventory"."lot_balances" (
	"tenant_id" uuid,
	"warehouse_id" uuid,
	"lot_id" uuid,
	"on_hand" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lot_balances_pkey" PRIMARY KEY("tenant_id","warehouse_id","lot_id"),
	CONSTRAINT "lot_balances_on_hand_check" CHECK ("on_hand" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory"."lot_movements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lot_movements_quantity_check" CHECK ("quantity" <> 0)
);
--> statement-breakpoint
CREATE TABLE "inventory"."lots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"code" text NOT NULL,
	"expiry_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lots_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "lots_tenant_item_code_key" UNIQUE("tenant_id","item_id","code"),
	CONSTRAINT "lots_code_check" CHECK ("code" = btrim("code") and length("code") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "inventory"."serial_units" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"serial" text NOT NULL,
	"status" "inventory"."serial_status" DEFAULT 'in_stock'::"inventory"."serial_status" NOT NULL,
	"warehouse_id" uuid,
	"received_source_type" text NOT NULL,
	"received_source_id" uuid NOT NULL,
	"issued_source_type" text,
	"issued_source_id" uuid,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "serial_units_tenant_item_serial_key" UNIQUE("tenant_id","item_id","serial"),
	CONSTRAINT "serial_units_serial_check" CHECK ("serial" = btrim("serial") and length("serial") between 1 and 64),
	CONSTRAINT "serial_units_state_check" CHECK (("status" = 'in_stock' and "warehouse_id" is not null and "issued_source_id" is null) or
      ("status" <> 'in_stock' and "issued_source_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN "tracking" "inventory"."item_tracking" DEFAULT 'none'::"inventory"."item_tracking" NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory"."lot_balances" ADD CONSTRAINT "lot_balances_warehouse_fkey" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "inventory"."warehouses"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."lot_balances" ADD CONSTRAINT "lot_balances_lot_fkey" FOREIGN KEY ("tenant_id","lot_id") REFERENCES "inventory"."lots"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."lot_movements" ADD CONSTRAINT "lot_movements_movement_fkey" FOREIGN KEY ("tenant_id","movement_id") REFERENCES "inventory"."movements"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."lot_movements" ADD CONSTRAINT "lot_movements_lot_fkey" FOREIGN KEY ("tenant_id","lot_id") REFERENCES "inventory"."lots"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."lots" ADD CONSTRAINT "lots_item_fkey" FOREIGN KEY ("tenant_id","item_id") REFERENCES "inventory"."items"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory"."serial_units" ADD CONSTRAINT "serial_units_item_fkey" FOREIGN KEY ("tenant_id","item_id") REFERENCES "inventory"."items"("tenant_id","id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION inventory.require_tracked_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, inventory
AS $$
BEGIN
  IF NEW.kind IN ('receipt', 'issue')
    AND EXISTS (
      SELECT 1 FROM inventory.items
      WHERE tenant_id = NEW.tenant_id AND id = NEW.item_id AND tracking <> 'none'
    )
    AND coalesce(current_setting('ritsei.tracked_identity', true), '') <> 'on'
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'tracked_item_requires_identity',
      MESSAGE = 'stock of a tracked item moves only with its lot or serial';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER movement_tracked_identity_trigger
BEFORE INSERT ON inventory.movements
FOR EACH ROW EXECUTE FUNCTION inventory.require_tracked_identity();
