-- owners: helpdesk
-- reviewed: 2026-11-25
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: ADR-0132 and ADR-0136: the helpdesk extension keeps its tables in its own migration chain, with no foreign key into core

CREATE SCHEMA "helpdesk";
--> statement-breakpoint
CREATE TYPE "helpdesk"."incident_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "helpdesk"."ticket_priority" AS ENUM('critical', 'high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "helpdesk"."ticket_status" AS ENUM('open', 'in_progress', 'waiting', 'resolved', 'closed');--> statement-breakpoint
CREATE TABLE "helpdesk"."incidents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "helpdesk"."incident_status" DEFAULT 'open'::"helpdesk"."incident_status" NOT NULL,
	"created_by" text NOT NULL,
	"resolution" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "incidents_title_check" CHECK ("title" ~ '[^[:space:]]'),
	CONSTRAINT "incidents_resolved_check" CHECK (("status" = 'open' and "resolved_at" is null) or
      ("status" = 'resolved' and "resolved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "helpdesk"."tickets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"priority" "helpdesk"."ticket_priority" DEFAULT 'normal'::"helpdesk"."ticket_priority" NOT NULL,
	"status" "helpdesk"."ticket_status" DEFAULT 'open'::"helpdesk"."ticket_status" NOT NULL,
	"requester" text NOT NULL,
	"assignee" text,
	"due_at" timestamp with time zone NOT NULL,
	"resolution" text,
	"resolved_at" timestamp with time zone,
	"incident_id" uuid,
	"subject_type" text,
	"subject_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "tickets_legal_entity_number_key" UNIQUE("tenant_id","legal_entity_id","number"),
	CONSTRAINT "tickets_title_check" CHECK ("title" ~ '[^[:space:]]'),
	CONSTRAINT "tickets_resolved_check" CHECK (("status" in ('open', 'in_progress', 'waiting') and "resolved_at" is null) or
      ("status" in ('resolved', 'closed') and "resolved_at" is not null)),
	CONSTRAINT "tickets_subject_check" CHECK (("subject_type" is null) = ("subject_id" is null)),
	CONSTRAINT "tickets_subject_not_approval_check" CHECK ("subject_type" is null or "subject_type" !~ '^approvals[.]')
);
--> statement-breakpoint
CREATE INDEX "tickets_queue_idx" ON "helpdesk"."tickets" ("tenant_id","due_at") WHERE "status" in ('open', 'in_progress', 'waiting');--> statement-breakpoint
CREATE INDEX "tickets_requester_idx" ON "helpdesk"."tickets" ("tenant_id","requester");--> statement-breakpoint
CREATE INDEX "tickets_incident_idx" ON "helpdesk"."tickets" ("tenant_id","incident_id");--> statement-breakpoint
ALTER TABLE "helpdesk"."tickets" ADD CONSTRAINT "tickets_incident_fkey" FOREIGN KEY ("tenant_id","incident_id") REFERENCES "helpdesk"."incidents"("tenant_id","id");