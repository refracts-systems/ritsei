-- owners: billing
-- reviewed: 2026-11-04
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: retain the accepted lease generation and scope for the evaluation artifact (ADR-0112).
-- Evaluation databases containing artifacts must be recreated; no production migration is authorized.

ALTER TABLE "billing"."invoice_artifacts" ADD COLUMN "fence_scope" text NOT NULL;--> statement-breakpoint
ALTER TABLE "billing"."invoice_artifacts" ADD COLUMN "lease_generation" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "billing"."invoice_artifacts" ADD CONSTRAINT "invoice_artifacts_fence_scope_check" CHECK ("fence_scope" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "billing"."invoice_artifacts" ADD CONSTRAINT "invoice_artifacts_lease_generation_check" CHECK ("lease_generation" > 0);
