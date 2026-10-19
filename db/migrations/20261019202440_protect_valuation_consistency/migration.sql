-- owner: inventory
-- reviewed: 2026-10-20
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: keep each item valuation equal to the sum of its valuation entries (ADR-0100)

CREATE OR REPLACE FUNCTION inventory.assert_valuation_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, inventory
AS $$
DECLARE
  stored_quantity bigint;
  stored_value numeric;
  entry_quantity numeric;
  entry_value numeric;
BEGIN
  SELECT quantity, value
  INTO stored_quantity, stored_value
  FROM inventory.item_valuations
  WHERE tenant_id = NEW.tenant_id
    AND legal_entity_id = NEW.legal_entity_id
    AND item_id = NEW.item_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(sum(quantity), 0), coalesce(sum(value), 0)
  INTO entry_quantity, entry_value
  FROM inventory.valuation_entries
  WHERE tenant_id = NEW.tenant_id
    AND legal_entity_id = NEW.legal_entity_id
    AND item_id = NEW.item_id;

  IF stored_quantity::numeric <> entry_quantity OR stored_value <> entry_value THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'inventory_valuation_entry_consistency_check',
      MESSAGE = 'item valuation must equal the sum of its valuation entries';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER inventory_valuation_entry_consistency_trigger
AFTER INSERT ON inventory.valuation_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION inventory.assert_valuation_consistency();

CREATE CONSTRAINT TRIGGER inventory_item_valuation_consistency_trigger
AFTER INSERT OR UPDATE ON inventory.item_valuations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION inventory.assert_valuation_consistency();

CREATE OR REPLACE FUNCTION inventory.protect_valuation_entries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, inventory
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    CONSTRAINT = 'inventory_valuation_entries_immutable',
    MESSAGE = 'valuation entries are immutable';
END;
$$;

CREATE TRIGGER inventory_valuation_entries_immutable_trigger
BEFORE UPDATE OR DELETE ON inventory.valuation_entries
FOR EACH ROW EXECUTE FUNCTION inventory.protect_valuation_entries();
