import { sql } from "drizzle-orm"
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id } from "./common.ts"
import { legalEntities } from "./party.ts"

export const situationsSchema = pgSchema("situations")

export const situationSeverity = situationsSchema.enum("situation_severity", [
  "low",
  "medium",
  "high",
])

/** The weekdays that count as working days of a legal entity (1 Monday to 7 Sunday), ADR-0129. */
export const workingCalendars = situationsSchema.table(
  "working_calendars",
  {
    tenantId: uuid("tenant_id").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    weekdays: smallint("weekdays")
      .array()
      .notNull()
      .default(sql`'{1,2,3,4,5}'::smallint[]`),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.legalEntityId] }),
    check(
      "working_calendars_weekdays_check",
      sql`cardinality(${table.weekdays}) between 1 and 7 and ${table.weekdays} <@ array[1,2,3,4,5,6,7]::smallint[]`,
    ),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: "working_calendars_legal_entity_fkey",
    }),
  ],
)

export const nonWorkingDays = situationsSchema.table(
  "non_working_days",
  {
    tenantId: uuid("tenant_id").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.legalEntityId, table.day] }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: "non_working_days_legal_entity_fkey",
    }),
  ],
)

/**
 * Something that needs a person: a projection of another module's facts, opened and resolved by
 * detectors, never the authority of those facts (ADR-0129). The escalation state is kept here.
 */
export const situations = situationsSchema.table(
  "situations",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    type: text("type").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    severity: situationSeverity("severity").notNull(),
    ownerId: text("owner_id"),
    escalationLevel: smallint("escalation_level").notNull().default(0),
    escalationDueAt: timestamp("escalation_due_at", { withTimezone: true }),
    detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    // At most one open situation per subject; a resolved one is history.
    uniqueIndex("situations_open_subject_key")
      .on(table.tenantId, table.type, table.subjectType, table.subjectId)
      .where(sql`${table.resolvedAt} is null`),
    index("situations_tenant_entity_idx").on(table.tenantId, table.legalEntityId, table.resolvedAt),
    index("situations_escalation_due_idx")
      .on(table.tenantId, table.escalationDueAt)
      .where(sql`${table.resolvedAt} is null and ${table.escalationDueAt} is not null`),
    check(
      "situations_type_check",
      sql`${table.type} in ('receivable_overdue', 'bill_mismatch', 'approval_waiting')`,
    ),
    check("situations_escalation_level_check", sql`${table.escalationLevel} between 0 and 2`),
    check(
      "situations_resolved_check",
      sql`${table.resolvedAt} is null or ${table.escalationDueAt} is null`,
    ),
    // Escalation runs only while nobody has taken the situation.
    check(
      "situations_owned_check",
      sql`${table.ownerId} is null or ${table.escalationDueAt} is null`,
    ),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: "situations_legal_entity_fkey",
    }),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "situations_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)

/** A read-only subscription to a flow (a situation type) or to one subject. It grants no right. */
export const situationFollows = situationsSchema.table(
  "follows",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    userId: text("user_id").notNull(),
    flowType: text("flow_type"),
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "follows_target_check",
      sql`(${table.flowType} is not null and ${table.subjectType} is null and ${table.subjectId} is null) or
      (${table.flowType} is null and ${table.subjectType} is not null and ${table.subjectId} is not null)`,
    ),
    uniqueIndex("follows_flow_key")
      .on(table.tenantId, table.userId, table.flowType)
      .where(sql`${table.flowType} is not null`),
    uniqueIndex("follows_subject_key")
      .on(table.tenantId, table.userId, table.subjectType, table.subjectId)
      .where(sql`${table.subjectId} is not null`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "follows_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)

/** A person's in-app notification, written once per event (ADR-0129). */
export const situationInbox = situationsSchema.table(
  "inbox",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    userId: text("user_id").notNull(),
    situationId: uuid("situation_id").notNull(),
    eventId: uuid("event_id").notNull(),
    kind: text("kind").notNull(),
    severity: situationSeverity("severity").notNull(),
    escalationLevel: integer("escalation_level").notNull().default(0),
    createdAt: createdAt(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("inbox_user_event_key").on(table.tenantId, table.userId, table.eventId),
    index("inbox_user_idx").on(table.tenantId, table.userId, table.readAt),
    check("inbox_kind_check", sql`${table.kind} in ('opened', 'escalated', 'resolved')`),
    foreignKey({
      columns: [table.situationId],
      foreignColumns: [situations.id],
      name: "inbox_situation_fkey",
    }),
  ],
)
