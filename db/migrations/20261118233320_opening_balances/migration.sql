-- owner: accounting
-- reviewed: 2026-11-19
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: a migration clearing posting role and at most one opening journal per legal entity (ADR-0117). No backfill.

ALTER TYPE "accounting"."posting_role" ADD VALUE 'migration_clearing';--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_opening_balance_key" ON "accounting"."journal_entries" ("tenant_id","legal_entity_id") WHERE "source_type" = 'accounting.opening_balance';
