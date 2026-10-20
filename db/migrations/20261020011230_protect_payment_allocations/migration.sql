-- owner: settlement
-- reviewed: 2026-10-20
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: keep each payment's unallocated amount equal to its amount minus allocations, and
--   keep posted payments and allocations immutable (ADR-0102)

CREATE OR REPLACE FUNCTION settlement.assert_unallocated_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, settlement
AS $$
DECLARE
  target_payment_id uuid;
  payment_amount numeric;
  payment_unallocated numeric;
  allocated numeric;
BEGIN
  IF TG_TABLE_NAME = 'payments' THEN
    target_payment_id := NEW.id;
  ELSE
    target_payment_id := NEW.payment_id;
  END IF;

  SELECT amount, unallocated_amount
  INTO payment_amount, payment_unallocated
  FROM settlement.payments
  WHERE tenant_id = NEW.tenant_id
    AND id = target_payment_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(sum(amount), 0)
  INTO allocated
  FROM settlement.payment_allocations
  WHERE tenant_id = NEW.tenant_id
    AND payment_id = target_payment_id;

  IF payment_unallocated <> payment_amount - allocated THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'settlement_unallocated_amount_check',
      MESSAGE = 'unallocated amount must equal the payment amount minus its allocations';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER settlement_payment_unallocated_trigger
AFTER INSERT OR UPDATE ON settlement.payments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION settlement.assert_unallocated_amount();

CREATE CONSTRAINT TRIGGER settlement_allocation_unallocated_trigger
AFTER INSERT ON settlement.payment_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION settlement.assert_unallocated_amount();

CREATE OR REPLACE FUNCTION settlement.protect_posted_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, settlement
AS $$
BEGIN
  IF TG_TABLE_NAME = 'payments' AND TG_OP = 'UPDATE'
    AND (to_jsonb(NEW) - 'unallocated_amount') = (to_jsonb(OLD) - 'unallocated_amount') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    CONSTRAINT = 'settlement_posted_payments_immutable',
    MESSAGE = 'posted payments change only through allocations';
END;
$$;

CREATE TRIGGER settlement_payments_immutable_trigger
BEFORE UPDATE OR DELETE ON settlement.payments
FOR EACH ROW EXECUTE FUNCTION settlement.protect_posted_payments();

CREATE TRIGGER settlement_payment_allocations_immutable_trigger
BEFORE UPDATE OR DELETE ON settlement.payment_allocations
FOR EACH ROW EXECUTE FUNCTION settlement.protect_posted_payments();
