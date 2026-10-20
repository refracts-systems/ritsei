import { sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id, money, updatedAt } from "./common.ts"

export const approvalsSchema = pgSchema("approvals")

export const approvalStatus = approvalsSchema.enum("approval_status", [
  "pending",
  "approved",
  "rejected",
])

/** Amounts above the threshold need approval by a holder of the approver capability (ADR-0103). */
export const approvalPolicies = approvalsSchema.table(
  "approval_policies",
  {
    tenantId: uuid("tenant_id").notNull(),
    subjectType: text("subject_type").notNull(),
    threshold: money("threshold"),
    approverCapability: text("approver_capability").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.subjectType] }),
    check("approval_policies_subject_type_check", sql`${table.subjectType} ~ '^[a-z][a-z0-9_.]*$'`),
    check("approval_policies_threshold_check", sql`${table.threshold} >= 0`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "approval_policies_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)

export const approvalRequests = approvalsSchema.table(
  "approval_requests",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    amount: money("amount"),
    reason: text("reason").notNull(),
    status: approvalStatus("status").notNull().default("pending"),
    requestedBy: text("requested_by").notNull(),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    unique("approval_requests_tenant_id_id_key").on(table.tenantId, table.id),
    unique("approval_requests_subject_key").on(table.tenantId, table.subjectType, table.subjectId),
    check("approval_requests_amount_check", sql`${table.amount} >= 0`),
    check(
      "approval_requests_decision_check",
      sql`(${table.status} = 'pending' and ${table.decidedBy} is null and ${table.decidedAt} is null) or
      (${table.status} <> 'pending' and ${table.decidedBy} is not null and ${table.decidedAt} is not null)`,
    ),
    // Separation of duties: the requester never decides their own request.
    check(
      "approval_requests_separation_of_duties_check",
      sql`${table.decidedBy} is null or ${table.decidedBy} <> ${table.requestedBy}`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "approval_requests_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)
