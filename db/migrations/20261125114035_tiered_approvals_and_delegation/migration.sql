-- owners: approvals
-- reviewed: 2026-11-25
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: ADR-0128 turns a policy's single threshold into ordered steps, freezes the matching steps on each request, and adds dated delegations. Every existing policy becomes step 1 and every existing request one step carrying its decision, then the old policy columns are dropped. Delegations are created and revoked only

CREATE TABLE "approvals"."approval_delegations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"delegator" text NOT NULL,
	"delegate" text NOT NULL,
	"capability" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "approval_delegations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "approval_delegations_not_self_check" CHECK ("delegator" <> "delegate"),
	CONSTRAINT "approval_delegations_range_check" CHECK ("valid_to" >= "valid_from"),
	CONSTRAINT "approval_delegations_revocation_check" CHECK (("revoked_at" is null) = ("revoked_by" is null))
);
--> statement-breakpoint
CREATE TABLE "approvals"."approval_policy_steps" (
	"tenant_id" uuid,
	"subject_type" text,
	"step_number" integer,
	"above" numeric(24,2) NOT NULL,
	"up_to" numeric(24,2),
	"approver_capability" text NOT NULL,
	"scope_legal_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_policy_steps_pkey" PRIMARY KEY("tenant_id","subject_type","step_number"),
	CONSTRAINT "approval_policy_steps_number_check" CHECK ("step_number" >= 1),
	CONSTRAINT "approval_policy_steps_above_check" CHECK ("above" >= 0),
	CONSTRAINT "approval_policy_steps_range_check" CHECK ("up_to" is null or "up_to" > "above")
);
--> statement-breakpoint
CREATE TABLE "approvals"."approval_request_steps" (
	"tenant_id" uuid,
	"request_id" uuid,
	"step_number" integer,
	"approver_capability" text NOT NULL,
	"scope_legal_entity_id" uuid,
	"requested_by" text NOT NULL,
	"status" "approvals"."approval_status" DEFAULT 'pending'::"approvals"."approval_status" NOT NULL,
	"decided_by" text,
	"on_behalf_of" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_request_steps_pkey" PRIMARY KEY("tenant_id","request_id","step_number"),
	CONSTRAINT "approval_request_steps_number_check" CHECK ("step_number" >= 1),
	CONSTRAINT "approval_request_steps_decision_check" CHECK (("status" = 'pending' and "decided_by" is null and "on_behalf_of" is null and "decided_at" is null) or
      ("status" <> 'pending' and "decided_by" is not null and "decided_at" is not null)),
	CONSTRAINT "approval_request_steps_separation_of_duties_check" CHECK (("decided_by" is null or "decided_by" <> "requested_by") and
      ("on_behalf_of" is null or "on_behalf_of" <> "requested_by"))
);
--> statement-breakpoint
CREATE INDEX "approval_delegations_delegate_idx" ON "approvals"."approval_delegations" ("tenant_id","delegate","capability");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_request_steps_decider_key" ON "approvals"."approval_request_steps" ("tenant_id","request_id","decided_by") WHERE "decided_by" is not null;--> statement-breakpoint
ALTER TABLE "approvals"."approval_delegations" ADD CONSTRAINT "approval_delegations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "approvals"."approval_policy_steps" ADD CONSTRAINT "approval_policy_steps_policy_fkey" FOREIGN KEY ("tenant_id","subject_type") REFERENCES "approvals"."approval_policies"("tenant_id","subject_type") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "approvals"."approval_request_steps" ADD CONSTRAINT "approval_request_steps_request_fkey" FOREIGN KEY ("tenant_id","request_id") REFERENCES "approvals"."approval_requests"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
INSERT INTO "approvals"."approval_policy_steps" ("tenant_id","subject_type","step_number","above","up_to","approver_capability")
SELECT "tenant_id","subject_type",1,"threshold",NULL,"approver_capability" FROM "approvals"."approval_policies";--> statement-breakpoint
INSERT INTO "approvals"."approval_request_steps" ("tenant_id","request_id","step_number","approver_capability","requested_by","status","decided_by","decided_at")
SELECT r."tenant_id", r."id", 1, coalesce(p."approver_capability", 'approvals.request.read'), r."requested_by", r."status", r."decided_by", r."decided_at"
FROM "approvals"."approval_requests" r
LEFT JOIN "approvals"."approval_policies" p ON p."tenant_id" = r."tenant_id" AND p."subject_type" = r."subject_type";--> statement-breakpoint
ALTER TABLE "approvals"."approval_policies" DROP CONSTRAINT "approval_policies_threshold_check";--> statement-breakpoint
ALTER TABLE "approvals"."approval_policies" DROP COLUMN "threshold";--> statement-breakpoint
ALTER TABLE "approvals"."approval_policies" DROP COLUMN "approver_capability";--> statement-breakpoint
CREATE OR REPLACE FUNCTION approvals.protect_delegations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, approvals
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'approval_delegations_append_only',
      MESSAGE = 'approval delegations are never deleted';
  END IF;

  -- The only change allowed is the one revocation of a live delegation.
  IF OLD.revoked_at IS NOT NULL
    OR NEW.revoked_at IS NULL
    OR (NEW.id, NEW.tenant_id, NEW.delegator, NEW.delegate, NEW.capability, NEW.valid_from, NEW.valid_to, NEW.reason, NEW.created_at)
      IS DISTINCT FROM
      (OLD.id, OLD.tenant_id, OLD.delegator, OLD.delegate, OLD.capability, OLD.valid_from, OLD.valid_to, OLD.reason, OLD.created_at)
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'approval_delegations_append_only',
      MESSAGE = 'an approval delegation can only be revoked';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER approval_delegations_append_only_trigger
BEFORE UPDATE OR DELETE ON approvals.approval_delegations
FOR EACH ROW EXECUTE FUNCTION approvals.protect_delegations();
