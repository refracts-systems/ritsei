-- owner: sales
-- reviewed: 2026-11-25
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: a confirmed sales order keeps the ADR-0095 number it was confirmed with, so its cancellation cannot change the number; the function is the 2026-08-17 state-transition hardening with `number` added to the confirmed-order columns that cannot change

CREATE OR REPLACE FUNCTION sales.reject_terminal_order_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sales
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.status::text IS DISTINCT FROM NEW.status::text
    AND NOT (
      (OLD.status::text = 'draft' AND NEW.status::text = 'confirmed') OR
      (OLD.status::text = 'confirmed' AND NEW.status::text = 'cancelled')
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'sales_order_state_transition_check',
      MESSAGE = 'invalid sales order state transition';
  END IF;

  IF TG_OP = 'DELETE' AND OLD.status::text IN ('confirmed', 'cancelled') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'sales_terminal_order_immutable',
      MESSAGE = 'terminal sales orders are immutable';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status::text = 'cancelled' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'sales_terminal_order_immutable',
        MESSAGE = 'terminal sales orders are immutable';
    END IF;

    IF OLD.status::text = 'confirmed' THEN
      IF NEW.status::text <> 'cancelled' OR
        NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
        NEW.customer_id IS DISTINCT FROM OLD.customer_id OR
        NEW.quotation_id IS DISTINCT FROM OLD.quotation_id OR
        NEW.confirmation_idempotency_key IS DISTINCT FROM OLD.confirmation_idempotency_key OR
        NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR
        NEW.number IS DISTINCT FROM OLD.number OR
        NEW.total IS DISTINCT FROM OLD.total OR
        NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          CONSTRAINT = 'sales_terminal_order_immutable',
          MESSAGE = 'confirmed sales orders only support cancellation';
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
