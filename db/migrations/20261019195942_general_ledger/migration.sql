-- owner: accounting
-- reviewed: 2026-10-20
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: account hierarchy, posting rules by role, and numbered legal-entity journals with posting dates (ADR-0096)

CREATE TYPE "accounting"."posting_role" AS ENUM('receivable', 'revenue', 'output_tax', 'input_tax', 'payable', 'inventory', 'cost_of_goods_sold', 'goods_received_not_invoiced', 'purchase_price_variance', 'inventory_adjustment', 'cash');--> statement-breakpoint
CREATE TABLE "accounting"."posting_rules" (
	"tenant_id" uuid,
	"legal_entity_id" uuid,
	"role" "accounting"."posting_role",
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posting_rules_pkey" PRIMARY KEY("tenant_id","legal_entity_id","role")
);
--> statement-breakpoint
ALTER TABLE "accounting"."accounts" ADD COLUMN "parent_account_id" uuid;--> statement-breakpoint
ALTER TABLE "accounting"."journal_entries" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "accounting"."journal_entries" ADD COLUMN "posting_date" date;--> statement-breakpoint
ALTER TABLE "accounting"."journal_entries" ADD COLUMN "number" text;--> statement-breakpoint
ALTER TABLE "accounting"."journal_entries" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "accounting"."journal_entries" ADD COLUMN "source_type" text;--> statement-breakpoint
ALTER TABLE "accounting"."journal_entries" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "accounting"."accounts" ADD CONSTRAINT "accounts_tenant_id_type_key" UNIQUE("tenant_id","id","type");--> statement-breakpoint
ALTER TABLE "accounting"."journal_entries" ADD CONSTRAINT "journal_entries_legal_entity_number_key" UNIQUE("tenant_id","legal_entity_id","number");--> statement-breakpoint
CREATE INDEX "journal_entries_ledger_idx" ON "accounting"."journal_entries" ("tenant_id","legal_entity_id","posting_date");--> statement-breakpoint
CREATE INDEX "journal_lines_tenant_account_idx" ON "accounting"."journal_lines" ("tenant_id","account_id");--> statement-breakpoint
ALTER TABLE "accounting"."accounts" ADD CONSTRAINT "accounts_parent_same_type_fkey" FOREIGN KEY ("tenant_id","parent_account_id","type") REFERENCES "accounting"."accounts"("tenant_id","id","type");--> statement-breakpoint
ALTER TABLE "accounting"."journal_entries" ADD CONSTRAINT "journal_entries_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accounting"."posting_rules" ADD CONSTRAINT "posting_rules_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accounting"."posting_rules" ADD CONSTRAINT "posting_rules_account_fkey" FOREIGN KEY ("tenant_id","account_id") REFERENCES "accounting"."accounts"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accounting"."accounts" ADD CONSTRAINT "accounts_parent_not_self_check" CHECK ("parent_account_id" is null or "parent_account_id" <> "id");--> statement-breakpoint
ALTER TABLE "accounting"."journal_entries" ADD CONSTRAINT "journal_entries_ledger_attributes_check" CHECK (("legal_entity_id" is null and "posting_date" is null and "number" is null) or
      ("legal_entity_id" is not null and "posting_date" is not null and "number" is not null));--> statement-breakpoint
ALTER TABLE "accounting"."journal_entries" ADD CONSTRAINT "journal_entries_source_check" CHECK (("source_type" is null and "source_id" is null) or
      ("source_type" ~ '^[a-z][a-z0-9_.]*$' and "source_id" is not null));