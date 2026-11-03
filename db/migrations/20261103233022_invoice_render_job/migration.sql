-- owners: process
-- reviewed: 2026-11-04
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: allow the invoice-render job for isolated evaluation under ADR-0112.

ALTER TABLE "process"."jobs" DROP CONSTRAINT "process_jobs_type_check", ADD CONSTRAINT "process_jobs_type_check" CHECK ("job_type" in ('process.order_confirmation.post_commit', 'process.order_cancellation.post_commit', 'process.order_fulfillment.post_commit', 'accounting.financial_operation.submit', 'accounting.financial_operation.reconcile', 'billing.invoice.render'));
