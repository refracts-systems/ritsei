-- owner: approvals
-- reviewed: 2026-10-20
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: threshold approval policies and requests with separation of duties (ADR-0103)

CREATE SCHEMA "approvals";
--> statement-breakpoint
CREATE TYPE "approvals"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "approvals"."approval_policies" (
	"tenant_id" uuid,
	"subject_type" text,
	"threshold" numeric(24,2) NOT NULL,
	"approver_capability" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_policies_pkey" PRIMARY KEY("tenant_id","subject_type"),
	CONSTRAINT "approval_policies_subject_type_check" CHECK ("subject_type" ~ '^[a-z][a-z0-9_.]*$'),
	CONSTRAINT "approval_policies_threshold_check" CHECK ("threshold" >= 0)
);
--> statement-breakpoint
CREATE TABLE "approvals"."approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"amount" numeric(24,2) NOT NULL,
	"reason" text NOT NULL,
	"status" "approvals"."approval_status" DEFAULT 'pending'::"approvals"."approval_status" NOT NULL,
	"requested_by" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_requests_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "approval_requests_subject_key" UNIQUE("tenant_id","subject_type","subject_id"),
	CONSTRAINT "approval_requests_amount_check" CHECK ("amount" >= 0),
	CONSTRAINT "approval_requests_decision_check" CHECK (("status" = 'pending' and "decided_by" is null and "decided_at" is null) or
      ("status" <> 'pending' and "decided_by" is not null and "decided_at" is not null)),
	CONSTRAINT "approval_requests_separation_of_duties_check" CHECK ("decided_by" is null or "decided_by" <> "requested_by")
);
--> statement-breakpoint
ALTER TABLE "approvals"."approval_policies" ADD CONSTRAINT "approval_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "approvals"."approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;