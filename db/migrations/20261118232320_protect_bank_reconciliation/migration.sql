-- owner: settlement
-- reviewed: 2026-11-19
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: keep imported statements and lines immutable, keep matches within the line and the
--   payment cash they relate to, and keep withheld tax allocated to receivables (ADR-0116)

CREATE OR REPLACE FUNCTION settlement.assert_withholding_allocated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, settlement
AS $$
DECLARE
  current_row settlement.payments%ROWTYPE;
BEGIN
  -- The trigger is deferred: judge the row as committed, not as it was when the event fired.
  SELECT * INTO current_row
  FROM settlement.payments
  WHERE tenant_id = NEW.tenant_id AND id = NEW.id;

  IF FOUND AND current_row.unallocated_amount > current_row.amount - current_row.withheld_amount THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'settlement_withholding_allocated_check',
      MESSAGE = 'withheld tax must be allocated to documents';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER settlement_payment_withholding_trigger
AFTER INSERT OR UPDATE ON settlement.payments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION settlement.assert_withholding_allocated();

CREATE OR REPLACE FUNCTION settlement.protect_bank_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, settlement
AS $$
BEGIN
  IF TG_TABLE_NAME = 'bank_line_matches' AND TG_OP = 'UPDATE'
    AND (to_jsonb(OLD) ->> 'reversed_at') IS NULL
    AND (to_jsonb(NEW) - 'reversed_at' - 'reversed_by')
      = (to_jsonb(OLD) - 'reversed_at' - 'reversed_by') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    CONSTRAINT = 'settlement_bank_evidence_immutable',
    MESSAGE = 'bank statements and matches change only by reversing a match';
END;
$$;

CREATE TRIGGER settlement_bank_statements_immutable_trigger
BEFORE UPDATE OR DELETE ON settlement.bank_statements
FOR EACH ROW EXECUTE FUNCTION settlement.protect_bank_evidence();

CREATE TRIGGER settlement_bank_statement_lines_immutable_trigger
BEFORE UPDATE OR DELETE ON settlement.bank_statement_lines
FOR EACH ROW EXECUTE FUNCTION settlement.protect_bank_evidence();

CREATE TRIGGER settlement_bank_line_matches_immutable_trigger
BEFORE UPDATE OR DELETE ON settlement.bank_line_matches
FOR EACH ROW EXECUTE FUNCTION settlement.protect_bank_evidence();

CREATE OR REPLACE FUNCTION settlement.assert_bank_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, settlement
AS $$
DECLARE
  line_amount numeric;
  statement_entity uuid;
  statement_account uuid;
  payment_direction settlement.payment_direction;
  payment_entity uuid;
  payment_account uuid;
  payment_cash numeric;
  line_matched numeric;
  payment_matched numeric;
BEGIN
  IF NEW.reversed_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT l.amount, s.legal_entity_id, s.bank_account_id
  INTO line_amount, statement_entity, statement_account
  FROM settlement.bank_statement_lines l
  JOIN settlement.bank_statements s ON s.tenant_id = l.tenant_id AND s.id = l.statement_id
  WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.line_id;

  SELECT p.direction, p.legal_entity_id, p.cash_account_id, p.amount - p.withheld_amount
  INTO payment_direction, payment_entity, payment_account, payment_cash
  FROM settlement.payments p
  WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.payment_id;

  IF statement_entity <> payment_entity OR statement_account IS DISTINCT FROM payment_account THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'bank_line_matches_scope_check',
      MESSAGE = 'a match joins a line and a payment of one legal entity and bank account';
  END IF;

  IF (line_amount > 0) <> (payment_direction = 'incoming') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'bank_line_matches_direction_check',
      MESSAGE = 'money in matches a receipt and money out matches a payment';
  END IF;

  SELECT coalesce(sum(amount), 0)
  INTO line_matched
  FROM settlement.bank_line_matches
  WHERE tenant_id = NEW.tenant_id AND line_id = NEW.line_id AND reversed_at IS NULL;

  IF line_matched > abs(line_amount) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'bank_line_matches_line_total_check',
      MESSAGE = 'matches cannot exceed the statement line';
  END IF;

  SELECT coalesce(sum(amount), 0)
  INTO payment_matched
  FROM settlement.bank_line_matches
  WHERE tenant_id = NEW.tenant_id AND payment_id = NEW.payment_id AND reversed_at IS NULL;

  IF payment_matched > payment_cash THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'bank_line_matches_payment_total_check',
      MESSAGE = 'matches cannot exceed the cash of the payment';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER settlement_bank_line_matches_match_trigger
AFTER INSERT OR UPDATE ON settlement.bank_line_matches
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION settlement.assert_bank_match();
