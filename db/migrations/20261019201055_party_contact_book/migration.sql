-- owner: party
-- reviewed: 2026-10-20
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: postal addresses by purpose, contact persons, and bank accounts for parties (parity plan Phase 4)

CREATE TYPE "party"."address_purpose" AS ENUM('billing', 'shipping', 'registered');--> statement-breakpoint
CREATE TABLE "party"."party_addresses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"purpose" "party"."address_purpose" NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"city" text NOT NULL,
	"region" text,
	"postal_code" text,
	"country_code" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_addresses_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "party_addresses_country_code_check" CHECK ("country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "party_addresses_text_check" CHECK ("line1" = btrim("line1") and "line1" ~ '[^[:space:]]' and
      "city" = btrim("city") and "city" ~ '[^[:space:]]')
);
--> statement-breakpoint
CREATE TABLE "party"."party_bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"bank_name" text NOT NULL,
	"account_number" text NOT NULL,
	"account_holder" text NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_bank_accounts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "party_bank_accounts_party_bank_number_key" UNIQUE("tenant_id","party_id","bank_name","account_number"),
	CONSTRAINT "party_bank_accounts_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "party_bank_accounts_number_check" CHECK ("account_number" ~ '^[A-Za-z0-9 -]+$' and "account_number" = btrim("account_number"))
);
--> statement-breakpoint
CREATE TABLE "party"."party_contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"name" text NOT NULL,
	"job_title" text,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_contacts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "party_contacts_name_check" CHECK ("name" = btrim("name") and "name" ~ '[^[:space:]]'),
	CONSTRAINT "party_contacts_email_check" CHECK ("email" is null or "email" = lower(btrim("email")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "party_addresses_primary_purpose_key" ON "party"."party_addresses" ("tenant_id","party_id","purpose") WHERE "is_primary";--> statement-breakpoint
ALTER TABLE "party"."party_addresses" ADD CONSTRAINT "party_addresses_party_fkey" FOREIGN KEY ("tenant_id","party_id") REFERENCES "party"."parties"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "party"."party_bank_accounts" ADD CONSTRAINT "party_bank_accounts_party_fkey" FOREIGN KEY ("tenant_id","party_id") REFERENCES "party"."parties"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "party"."party_contacts" ADD CONSTRAINT "party_contacts_party_fkey" FOREIGN KEY ("tenant_id","party_id") REFERENCES "party"."parties"("tenant_id","id") ON DELETE CASCADE;