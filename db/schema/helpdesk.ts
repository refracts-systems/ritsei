import { sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  index,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id, updatedAt } from "./common.ts"
import { legalEntities } from "./party.ts"

export const helpdeskSchema = pgSchema("helpdesk")

export const ticketStatus = helpdeskSchema.enum("ticket_status", [
  "open",
  "in_progress",
  "waiting",
  "resolved",
  "closed",
])

export const ticketPriority = helpdeskSchema.enum("ticket_priority", [
  "critical",
  "high",
  "normal",
  "low",
])

export const incidentStatus = helpdeskSchema.enum("incident_status", ["open", "resolved"])

/** Several tickets that share one cause (ADR-0132). */
export const incidents = helpdeskSchema.table(
  "incidents",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    title: text("title").notNull(),
    status: incidentStatus("status").notNull().default("open"),
    createdBy: text("created_by").notNull(),
    resolution: text("resolution"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("incidents_tenant_id_id_key").on(table.tenantId, table.id),
    check("incidents_title_check", sql`${table.title} ~ '[^[:space:]]'`),
    check(
      "incidents_resolved_check",
      sql`(${table.status} = 'open' and ${table.resolvedAt} is null) or
      (${table.status} = 'resolved' and ${table.resolvedAt} is not null)`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "incidents_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)

/** A piece of work that has no document: numbered per legal entity, with a due instant. */
export const tickets = helpdeskSchema.table(
  "tickets",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    number: text("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull().default("general"),
    priority: ticketPriority("priority").notNull().default("normal"),
    status: ticketStatus("status").notNull().default("open"),
    requester: text("requester").notNull(),
    assignee: text("assignee"),
    // When the SLA runs out, counted in working days from creation (ADR-0132).
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    resolution: text("resolution"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    incidentId: uuid("incident_id"),
    // A document the work is about, for context; never an approval (ADR-0132).
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("tickets_tenant_id_id_key").on(table.tenantId, table.id),
    unique("tickets_legal_entity_number_key").on(table.tenantId, table.legalEntityId, table.number),
    index("tickets_queue_idx")
      .on(table.tenantId, table.dueAt)
      .where(sql`${table.status} in ('open', 'in_progress', 'waiting')`),
    index("tickets_requester_idx").on(table.tenantId, table.requester),
    index("tickets_incident_idx").on(table.tenantId, table.incidentId),
    check("tickets_title_check", sql`${table.title} ~ '[^[:space:]]'`),
    check(
      "tickets_resolved_check",
      sql`(${table.status} in ('open', 'in_progress', 'waiting') and ${table.resolvedAt} is null) or
      (${table.status} in ('resolved', 'closed') and ${table.resolvedAt} is not null)`,
    ),
    check(
      "tickets_subject_check",
      sql`(${table.subjectType} is null) = (${table.subjectId} is null)`,
    ),
    // An approval is decided in Approvals and never becomes a ticket.
    check(
      "tickets_subject_not_approval_check",
      sql`${table.subjectType} is null or ${table.subjectType} !~ '^approvals[.]'`,
    ),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: "tickets_legal_entity_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.incidentId],
      foreignColumns: [incidents.tenantId, incidents.id],
      name: "tickets_incident_fkey",
    }),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "tickets_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)
