-- owner: settlement
-- reviewed: 2026-11-19
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: store imported bank statements and their manual matches to payments, and the
--   withholding a payer deducted from a receipt (ADR-0115). New tables; existing payments get a
--   zero withheld amount, which is what they always were.

CREATE TABLE "settlement"."bank_line_matches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount" numeric(24,2) NOT NULL,
	"matched_by" text NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_line_matches_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "bank_line_matches_amount_check" CHECK ("amount" > 0),
	CONSTRAINT "bank_line_matches_reversal_check" CHECK (("reversed_at" is null) = ("reversed_by" is null))
);
--> statement-breakpoint
CREATE TABLE "settlement"."bank_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"booking_date" date NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"amount" numeric(24,2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statement_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "bank_statement_lines_number_key" UNIQUE("tenant_id","statement_id","line_number"),
	CONSTRAINT "bank_statement_lines_amount_check" CHECK ("amount" <> 0),
	CONSTRAINT "bank_statement_lines_number_check" CHECK ("line_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "settlement"."bank_statements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"source_name" text NOT NULL,
	"checksum" text NOT NULL,
	"imported_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statements_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "bank_statements_checksum_key" UNIQUE("tenant_id","legal_entity_id","bank_account_id","checksum"),
	CONSTRAINT "bank_statements_checksum_check" CHECK ("checksum" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "settlement"."payments" ADD COLUMN "withheld_amount" numeric(24,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "settlement"."payments" ADD COLUMN "withholding_reference" text;--> statement-breakpoint
ALTER TABLE "settlement"."payments" ADD COLUMN "withholding_account_id" uuid;--> statement-breakpoint
ALTER TABLE "settlement"."bank_line_matches" ADD CONSTRAINT "bank_line_matches_line_fkey" FOREIGN KEY ("tenant_id","line_id") REFERENCES "settlement"."bank_statement_lines"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "settlement"."bank_line_matches" ADD CONSTRAINT "bank_line_matches_payment_fkey" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "settlement"."payments"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "settlement"."bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statement_fkey" FOREIGN KEY ("tenant_id","statement_id") REFERENCES "settlement"."bank_statements"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "settlement"."bank_statements" ADD CONSTRAINT "bank_statements_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "settlement"."bank_statements" ADD CONSTRAINT "bank_statements_bank_account_fkey" FOREIGN KEY ("tenant_id","bank_account_id") REFERENCES "accounting"."accounts"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "settlement"."payments" ADD CONSTRAINT "payments_withholding_account_fkey" FOREIGN KEY ("tenant_id","withholding_account_id") REFERENCES "accounting"."accounts"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "settlement"."payments" ADD CONSTRAINT "payments_withholding_check" CHECK ("withheld_amount" >= 0 and "withheld_amount" < "amount"
        and ("withheld_amount" = 0) = ("withholding_reference" is null)
        and ("withheld_amount" = 0) = ("withholding_account_id" is null)
        and ("withheld_amount" = 0 or "direction" = 'incoming'));