-- owners: situations
-- reviewed: 2026-11-25
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: ADR-0129 adds situations (what needs a person), the working calendar that escalation counts days on, follow subscriptions, and the in-app inbox

CREATE SCHEMA "situations";
--> statement-breakpoint
CREATE TYPE "situations"."situation_severity" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "situations"."non_working_days" (
	"tenant_id" uuid,
	"legal_entity_id" uuid,
	"day" date,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "non_working_days_pkey" PRIMARY KEY("tenant_id","legal_entity_id","day")
);
--> statement-breakpoint
CREATE TABLE "situations"."follows" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"flow_type" text,
	"subject_type" text,
	"subject_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_target_check" CHECK (("flow_type" is not null and "subject_type" is null and "subject_id" is null) or
      ("flow_type" is null and "subject_type" is not null and "subject_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "situations"."inbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"situation_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"severity" "situations"."situation_severity" NOT NULL,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "inbox_kind_check" CHECK ("kind" in ('opened', 'escalated', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "situations"."situations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"severity" "situations"."situation_severity" NOT NULL,
	"owner_id" text,
	"escalation_level" smallint DEFAULT 0 NOT NULL,
	"escalation_due_at" timestamp with time zone,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "situations_type_check" CHECK ("type" in ('receivable_overdue', 'bill_mismatch', 'approval_waiting')),
	CONSTRAINT "situations_escalation_level_check" CHECK ("escalation_level" between 0 and 2),
	CONSTRAINT "situations_resolved_check" CHECK ("resolved_at" is null or "escalation_due_at" is null),
	CONSTRAINT "situations_owned_check" CHECK ("owner_id" is null or "escalation_due_at" is null)
);
--> statement-breakpoint
CREATE TABLE "situations"."working_calendars" (
	"tenant_id" uuid,
	"legal_entity_id" uuid,
	"weekdays" smallint[] DEFAULT '{1,2,3,4,5}'::smallint[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "working_calendars_pkey" PRIMARY KEY("tenant_id","legal_entity_id"),
	CONSTRAINT "working_calendars_weekdays_check" CHECK (cardinality("weekdays") between 1 and 7 and "weekdays" <@ array[1,2,3,4,5,6,7]::smallint[])
);
--> statement-breakpoint
CREATE UNIQUE INDEX "follows_flow_key" ON "situations"."follows" ("tenant_id","user_id","flow_type") WHERE "flow_type" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "follows_subject_key" ON "situations"."follows" ("tenant_id","user_id","subject_type","subject_id") WHERE "subject_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_user_event_key" ON "situations"."inbox" ("tenant_id","user_id","event_id");--> statement-breakpoint
CREATE INDEX "inbox_user_idx" ON "situations"."inbox" ("tenant_id","user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "situations_open_subject_key" ON "situations"."situations" ("tenant_id","type","subject_type","subject_id") WHERE "resolved_at" is null;--> statement-breakpoint
CREATE INDEX "situations_tenant_entity_idx" ON "situations"."situations" ("tenant_id","legal_entity_id","resolved_at");--> statement-breakpoint
CREATE INDEX "situations_escalation_due_idx" ON "situations"."situations" ("tenant_id","escalation_due_at") WHERE "resolved_at" is null and "escalation_due_at" is not null;--> statement-breakpoint
ALTER TABLE "situations"."non_working_days" ADD CONSTRAINT "non_working_days_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "situations"."follows" ADD CONSTRAINT "follows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "situations"."inbox" ADD CONSTRAINT "inbox_situation_fkey" FOREIGN KEY ("situation_id") REFERENCES "situations"."situations"("id");--> statement-breakpoint
ALTER TABLE "situations"."situations" ADD CONSTRAINT "situations_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "situations"."situations" ADD CONSTRAINT "situations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "situations"."working_calendars" ADD CONSTRAINT "working_calendars_legal_entity_fkey" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "party"."legal_entities"("tenant_id","id");