import { sql } from "drizzle-orm"
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
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

/** The policy of a subject type; its steps decide who approves which amounts (ADR-0128). */
export const approvalPolicies = approvalsSchema.table(
  "approval_policies",
  {
    tenantId: uuid("tenant_id").notNull(),
    subjectType: text("subject_type").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.subjectType] }),
    check("approval_policies_subject_type_check", sql`${table.subjectType} ~ '^[a-z][a-z0-9_.]*$'`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "approval_policies_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)

/**
 * One step of a policy: amounts above `above` and up to `upTo` need a holder of the capability
 * (ADR-0128). A scope is stored but not enforced until grants can be scoped.
 */
export const approvalPolicySteps = approvalsSchema.table(
  "approval_policy_steps",
  {
    tenantId: uuid("tenant_id").notNull(),
    subjectType: text("subject_type").notNull(),
    stepNumber: integer("step_number").notNull(),
    above: money("above"),
    upTo: numeric("up_to", { precision: 24, scale: 2 }),
    approverCapability: text("approver_capability").notNull(),
    scopeLegalEntityId: uuid("scope_legal_entity_id"),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.subjectType, table.stepNumber] }),
    check("approval_policy_steps_number_check", sql`${table.stepNumber} >= 1`),
    check("approval_policy_steps_above_check", sql`${table.above} >= 0`),
    check(
      "approval_policy_steps_range_check",
      sql`${table.upTo} is null or ${table.upTo} > ${table.above}`,
    ),
    foreignKey({
      columns: [table.tenantId, table.subjectType],
      foreignColumns: [approvalPolicies.tenantId, approvalPolicies.subjectType],
      name: "approval_policy_steps_policy_fkey",
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

/**
 * The steps of one request, copied from the policy when it was submitted, so a later policy change
 * never changes a request in flight (ADR-0128). A step is decided once, in order.
 */
export const approvalRequestSteps = approvalsSchema.table(
  "approval_request_steps",
  {
    tenantId: uuid("tenant_id").notNull(),
    requestId: uuid("request_id").notNull(),
    stepNumber: integer("step_number").notNull(),
    approverCapability: text("approver_capability").notNull(),
    scopeLegalEntityId: uuid("scope_legal_entity_id"),
    requestedBy: text("requested_by").notNull(),
    status: approvalStatus("status").notNull().default("pending"),
    decidedBy: text("decided_by"),
    // The delegator when the step was decided through a delegation.
    onBehalfOf: text("on_behalf_of"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.requestId, table.stepNumber] }),
    check("approval_request_steps_number_check", sql`${table.stepNumber} >= 1`),
    check(
      "approval_request_steps_decision_check",
      sql`(${table.status} = 'pending' and ${table.decidedBy} is null and ${table.onBehalfOf} is null and ${table.decidedAt} is null) or
      (${table.status} <> 'pending' and ${table.decidedBy} is not null and ${table.decidedAt} is not null)`,
    ),
    // Separation of duties at every step, also through a delegation.
    check(
      "approval_request_steps_separation_of_duties_check",
      sql`(${table.decidedBy} is null or ${table.decidedBy} <> ${table.requestedBy}) and
      (${table.onBehalfOf} is null or ${table.onBehalfOf} <> ${table.requestedBy})`,
    ),
    // One person decides at most one step of a request.
    uniqueIndex("approval_request_steps_decider_key")
      .on(table.tenantId, table.requestId, table.decidedBy)
      .where(sql`${table.decidedBy} is not null`),
    foreignKey({
      columns: [table.tenantId, table.requestId],
      foreignColumns: [approvalRequests.tenantId, approvalRequests.id],
      name: "approval_request_steps_request_fkey",
    }).onDelete("cascade"),
  ],
)

/**
 * One capability handed to another user for a range of days (ADR-0128). Rows are created and
 * revoked, never edited otherwise or deleted.
 */
export const approvalDelegations = approvalsSchema.table(
  "approval_delegations",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    delegator: text("delegator").notNull(),
    delegate: text("delegate").notNull(),
    capability: text("capability").notNull(),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    validTo: date("valid_to", { mode: "string" }).notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by"),
  },
  (table) => [
    unique("approval_delegations_tenant_id_id_key").on(table.tenantId, table.id),
    index("approval_delegations_delegate_idx").on(table.tenantId, table.delegate, table.capability),
    check("approval_delegations_not_self_check", sql`${table.delegator} <> ${table.delegate}`),
    check("approval_delegations_range_check", sql`${table.validTo} >= ${table.validFrom}`),
    check(
      "approval_delegations_revocation_check",
      sql`(${table.revokedAt} is null) = (${table.revokedBy} is null)`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "approval_delegations_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)
