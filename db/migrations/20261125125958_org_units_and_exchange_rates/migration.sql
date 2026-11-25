-- owners: party, accounting
-- reviewed: 2026-11-25
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: ADR-0130 adds the organization-unit tree above legal entities (a strict tree kept as an ltree path by a trigger) and the hand-entered exchange-rate table that consolidation translates with

CREATE EXTENSION IF NOT EXISTS ltree;--> statement-breakpoint
CREATE TYPE "party"."org_unit_kind" AS ENUM('group', 'business_unit');--> statement-breakpoint
CREATE TABLE "accounting"."exchange_rates" (
	"tenant_id" uuid,
	"from_currency" text,
	"to_currency" text,
	"rate_date" date,
	"rate" numeric(28,10) NOT NULL,
	"entered_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rates_pkey" PRIMARY KEY("tenant_id","from_currency","to_currency","rate_date"),
	CONSTRAINT "exchange_rates_currency_check" CHECK ("from_currency" ~ '^[A-Z]{3}$' and "to_currency" ~ '^[A-Z]{3}$' and "from_currency" <> "to_currency"),
	CONSTRAINT "exchange_rates_rate_check" CHECK ("rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "party"."org_unit_members" (
	"tenant_id" uuid,
	"legal_entity_id" uuid,
	"unit_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_unit_members_pkey" PRIMARY KEY("tenant_id","legal_entity_id")
);
--> statement-breakpoint
CREATE TABLE "party"."org_units" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"kind" "party"."org_unit_kind" NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"path" ltree DEFAULT '' NOT NULL,
	"currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_units_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "org_units_name_check" CHECK ("name" ~ '[^[:space:]]'),
	CONSTRAINT "org_units_root_check" CHECK (("parent_id" is null and "kind" = 'group' and "currency" ~ '^[A-Z]{3}$') or
      ("parent_id" is not null and "currency" is null))
);
--> statement-breakpoint
CREATE INDEX "org_units_tenant_path_idx" ON "party"."org_units" ("tenant_id","path");--> statement-breakpoint
ALTER TABLE "accounting"."exchange_rates" ADD CONSTRAINT "exchange_rates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "party"."org_unit_members" ADD CONSTRAINT "org_unit_members_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "party"."org_unit_members" ADD CONSTRAINT "org_unit_members_unit_fkey" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "party"."org_units"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "party"."org_units" ADD CONSTRAINT "org_units_parent_fkey" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "party"."org_units"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "party"."org_units" ADD CONSTRAINT "org_units_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION party.org_unit_path()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, party
AS $$
DECLARE
  parent_path ltree;
BEGIN
  IF NEW.parent_id IS NULL THEN
    parent_path := ''::ltree;
  ELSE
    SELECT path INTO parent_path FROM party.org_units
      WHERE tenant_id = NEW.tenant_id AND id = NEW.parent_id;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- A unit cannot move under itself or one of its descendants.
    IF parent_path <@ OLD.path THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'org_units_acyclic',
        MESSAGE = 'an organization unit cannot move under itself';
    END IF;
  END IF;

  NEW.path := parent_path || text2ltree('u' || replace(NEW.id::text, '-', ''));

  IF TG_OP = 'UPDATE' THEN
    -- The subtree follows the unit; its own parent links do not change, so this does not recurse.
    UPDATE party.org_units
    SET path = NEW.path || subpath(path, nlevel(OLD.path))
    WHERE tenant_id = OLD.tenant_id AND path <@ OLD.path AND id <> OLD.id;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER org_unit_path_insert_trigger
BEFORE INSERT ON party.org_units
FOR EACH ROW EXECUTE FUNCTION party.org_unit_path();--> statement-breakpoint
CREATE TRIGGER org_unit_path_move_trigger
BEFORE UPDATE OF parent_id ON party.org_units
FOR EACH ROW WHEN (OLD.parent_id IS DISTINCT FROM NEW.parent_id)
EXECUTE FUNCTION party.org_unit_path();
