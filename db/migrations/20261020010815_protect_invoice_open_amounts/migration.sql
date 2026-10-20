-- owner: billing
-- reviewed: 2026-10-20
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: keep each document's open amount equal to its total minus applied settlements, and
--   keep posted documents, lines, and settlements immutable (ADR-0102)

CREATE OR REPLACE FUNCTION billing.assert_open_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $$
DECLARE
  document_total numeric;
  document_open numeric;
  settled numeric;
  document_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    document_id := NEW.id;
  ELSE
    document_id := NEW.invoice_id;
  END IF;

  SELECT total, open_amount
  INTO document_total, document_open
  FROM billing.invoices
  WHERE tenant_id = NEW.tenant_id
    AND id = document_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(sum(amount), 0)
  INTO settled
  FROM billing.invoice_settlements
  WHERE tenant_id = NEW.tenant_id
    AND invoice_id = document_id;

  IF document_open <> document_total - settled THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'billing_open_amount_settlement_check',
      MESSAGE = 'open amount must equal total minus applied settlements';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER billing_invoice_open_amount_trigger
AFTER INSERT OR UPDATE ON billing.invoices
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION billing.assert_open_amount();

CREATE CONSTRAINT TRIGGER billing_settlement_open_amount_trigger
AFTER INSERT ON billing.invoice_settlements
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION billing.assert_open_amount();

CREATE OR REPLACE FUNCTION billing.protect_posted_documents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $$
BEGIN
  IF TG_TABLE_NAME = 'invoices' AND TG_OP = 'UPDATE'
    AND (to_jsonb(NEW) - 'open_amount') = (to_jsonb(OLD) - 'open_amount') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    CONSTRAINT = 'billing_posted_documents_immutable',
    MESSAGE = 'posted billing documents change only through settlements';
END;
$$;

CREATE TRIGGER billing_invoices_immutable_trigger
BEFORE UPDATE OR DELETE ON billing.invoices
FOR EACH ROW EXECUTE FUNCTION billing.protect_posted_documents();

CREATE TRIGGER billing_invoice_lines_immutable_trigger
BEFORE UPDATE OR DELETE ON billing.invoice_lines
FOR EACH ROW EXECUTE FUNCTION billing.protect_posted_documents();

CREATE TRIGGER billing_invoice_settlements_immutable_trigger
BEFORE UPDATE OR DELETE ON billing.invoice_settlements
FOR EACH ROW EXECUTE FUNCTION billing.protect_posted_documents();
