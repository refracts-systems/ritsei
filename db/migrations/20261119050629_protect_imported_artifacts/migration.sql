-- owner: billing
-- reviewed: 2026-11-19
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: keep retained source-system document bytes immutable evidence: no update, no delete (ADR-0120)

CREATE OR REPLACE FUNCTION billing.protect_imported_artifact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    CONSTRAINT = 'billing_imported_artifact_immutable',
    MESSAGE = 'imported document artifacts are immutable evidence';
END;
$$;

CREATE TRIGGER billing_imported_artifacts_immutable_trigger
BEFORE UPDATE OR DELETE ON billing.imported_artifacts
FOR EACH ROW EXECUTE FUNCTION billing.protect_imported_artifact();
