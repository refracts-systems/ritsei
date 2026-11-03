-- Custom SQL migration file, put your code below! --
-- owners: billing
-- reviewed: 2026-11-04
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: prevent mutation or truncation of issued render inputs and artifacts (ADR-0112).

CREATE TRIGGER invoice_render_inputs_immutable_trigger
BEFORE UPDATE OR DELETE ON billing.invoice_render_inputs
FOR EACH ROW EXECUTE FUNCTION billing.protect_posted_documents();
--> statement-breakpoint
CREATE TRIGGER invoice_render_inputs_no_truncate_trigger
BEFORE TRUNCATE ON billing.invoice_render_inputs
FOR EACH STATEMENT EXECUTE FUNCTION billing.protect_posted_documents();
--> statement-breakpoint
CREATE TRIGGER invoice_artifacts_immutable_trigger
BEFORE UPDATE OR DELETE ON billing.invoice_artifacts
FOR EACH ROW EXECUTE FUNCTION billing.protect_posted_documents();
--> statement-breakpoint
CREATE TRIGGER invoice_artifacts_no_truncate_trigger
BEFORE TRUNCATE ON billing.invoice_artifacts
FOR EACH STATEMENT EXECUTE FUNCTION billing.protect_posted_documents();
