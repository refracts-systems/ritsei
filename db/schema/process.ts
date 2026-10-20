import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  foreignKey,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id, json, updatedAt } from "./common.ts"

export const processSchema = pgSchema("process")
export const workflowRunStatus = processSchema.enum("workflow_run_status", [
  "running",
  "succeeded",
  "manual_recovery",
])
export const processJobStatus = processSchema.enum("process_job_status", [
  "pending",
  "leased",
  "completed",
  "failed",
  "manual_recovery",
])
export const processRuntimeStatus = processSchema.enum("process_runtime_status", [
  "running",
  "waiting",
  "completed",
  "failed",
  "manual_recovery",
])
export const processRuntimeFailureKind = processSchema.enum("process_runtime_failure_kind", [
  "business_failure",
  "technical_retry",
  "unknown_external_outcome",
  "compensation_failure",
])
export const processRuntimeEnvironment = processSchema.enum("process_runtime_environment", [
  "DEV",
  "TEST",
  "PROD",
])
export const processOperatorAction = processSchema.enum("process_operator_action", [
  "retry",
  "compensate",
  "manual_recovery",
])
export const processReleaseAuditEvent = processSchema.enum("process_release_audit_event", [
  "approval",
  "release",
  "deployment",
])

export const jobFenceScopes = processSchema.table(
  "job_fence_scopes",
  {
    tenantId: uuid("tenant_id").notNull(),
    fenceScope: text("fence_scope").notNull(),
    generation: bigint("generation", { mode: "string" }).notNull().default("0"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.fenceScope] }),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "job_fence_scopes_tenant_id_fkey",
    }).onDelete("cascade"),
    check("job_fence_scopes_scope_check", sql`${table.fenceScope} ~ '[^[:space:]]'`),
    check("job_fence_scopes_generation_check", sql`${table.generation} >= 0`),
  ],
)

// Durable checkpoint state remains Process-owned and is separate from the existing lifecycle runs.
export const processRuntimeCheckpoints = processSchema.table(
  "runtime_checkpoints",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    processDefinitionId: uuid("process_definition_id").notNull(),
    processDefinitionVersion: integer("process_definition_version").notNull(),
    catalogVersion: integer("catalog_version").notNull(),
    environment: processRuntimeEnvironment("environment").notNull(),
    status: processRuntimeStatus("status").notNull(),
    failureKind: processRuntimeFailureKind("failure_kind"),
    currentNodeId: text("current_node_id").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    state: json("state").notNull(),
    correlationId: text("correlation_id").notNull(),
    executionPrincipal: text("execution_principal").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "runtime_checkpoints_tenant_id_fkey",
    }).onDelete("cascade"),
    check(
      "runtime_checkpoints_definition_version_check",
      sql`${table.processDefinitionVersion} > 0`,
    ),
    check("runtime_checkpoints_catalog_version_check", sql`${table.catalogVersion} > 0`),
    check("runtime_checkpoints_revision_check", sql`${table.revision} >= 0`),
    check("runtime_checkpoints_node_check", sql`${table.currentNodeId} ~ '[^[:space:]]'`),
    check("runtime_checkpoints_correlation_check", sql`${table.correlationId} ~ '[^[:space:]]'`),
    check("runtime_checkpoints_principal_check", sql`${table.executionPrincipal} ~ '[^[:space:]]'`),
    unique("runtime_checkpoints_tenant_id_id_key").on(table.tenantId, table.id),
  ],
)

export const processOperatorControls = processSchema.table(
  "operator_controls",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    instanceId: uuid("instance_id").notNull(),
    action: processOperatorAction("action").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    actorPrincipalId: text("actor_principal_id").notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "operator_controls_tenant_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.instanceId],
      foreignColumns: [processRuntimeCheckpoints.tenantId, processRuntimeCheckpoints.id],
      name: "operator_controls_checkpoint_fkey",
    }).onDelete("cascade"),
    check("operator_controls_idempotency_key_check", sql`${table.idempotencyKey} ~ '[^[:space:]]'`),
    check("operator_controls_actor_check", sql`${table.actorPrincipalId} ~ '[^[:space:]]'`),
    check("operator_controls_reason_check", sql`${table.reason} ~ '[^[:space:]]'`),
    unique("operator_controls_tenant_id_key").on(table.tenantId, table.idempotencyKey),
  ],
)

export const processReleases = processSchema.table(
  "releases",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    definitionId: uuid("definition_id").notNull(),
    definitionVersion: integer("definition_version").notNull(),
    catalogVersion: integer("catalog_version").notNull(),
    checksum: text("checksum").notNull(),
    references: json("references").notNull(),
    approvedBy: text("approved_by").notNull(),
    approvalReason: text("approval_reason").notNull(),
    releasedBy: text("released_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "process_releases_tenant_id_fkey",
    }).onDelete("cascade"),
    check("process_releases_definition_version_check", sql`${table.definitionVersion} > 0`),
    check("process_releases_catalog_version_check", sql`${table.catalogVersion} > 0`),
    check("process_releases_checksum_check", sql`${table.checksum} ~ '[^[:space:]]'`),
    check("process_releases_approved_by_check", sql`${table.approvedBy} ~ '[^[:space:]]'`),
    check("process_releases_approval_reason_check", sql`${table.approvalReason} ~ '[^[:space:]]'`),
    check("process_releases_released_by_check", sql`${table.releasedBy} ~ '[^[:space:]]'`),
    unique("process_releases_tenant_id_id_key").on(table.tenantId, table.id),
    unique("process_releases_tenant_definition_key").on(
      table.tenantId,
      table.definitionId,
      table.definitionVersion,
    ),
  ],
)

export const processDeployments = processSchema.table(
  "deployments",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    environment: processRuntimeEnvironment("environment").notNull(),
    deployedBy: text("deployed_by").notNull(),
    promotionReason: text("promotion_reason").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "process_deployments_tenant_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.releaseId],
      foreignColumns: [processReleases.tenantId, processReleases.id],
      name: "process_deployments_release_fkey",
    }).onDelete("cascade"),
    check("process_deployments_deployed_by_check", sql`${table.deployedBy} ~ '[^[:space:]]'`),
    check("process_deployments_reason_check", sql`${table.promotionReason} ~ '[^[:space:]]'`),
    unique("process_deployments_tenant_release_environment_key").on(
      table.tenantId,
      table.releaseId,
      table.environment,
    ),
  ],
)

export const processReleaseAudits = processSchema.table(
  "release_audits",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    event: processReleaseAuditEvent("event").notNull(),
    actorPrincipalId: text("actor_principal_id").notNull(),
    environment: processRuntimeEnvironment("environment"),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "process_release_audits_tenant_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.releaseId],
      foreignColumns: [processReleases.tenantId, processReleases.id],
      name: "process_release_audits_release_fkey",
    }).onDelete("cascade"),
    check("process_release_audits_actor_check", sql`${table.actorPrincipalId} ~ '[^[:space:]]'`),
    check("process_release_audits_reason_check", sql`${table.reason} ~ '[^[:space:]]'`),
  ],
)

export const workflowRuns = processSchema.table(
  "workflow_runs",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    workflowType: text("workflow_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    status: workflowRunStatus("status").notNull().default("running"),
    payload: json("payload").notNull(),
    result: json("result"),
    recoveryReason: text("recovery_reason"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("workflow_runs_tenant_type_key").on(
      table.tenantId,
      table.workflowType,
      table.idempotencyKey,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "workflow_runs_tenant_id_fkey",
    }).onDelete("cascade"),
    check(
      "workflow_runs_type_check",
      sql`${table.workflowType} in ('sales.order.confirmation', 'sales.order.cancellation', 'sales.order.fulfillment')`,
    ),
    check("workflow_runs_idempotency_key_check", sql`${table.idempotencyKey} ~ '[^[:space:]]'`),
    check(
      "workflow_runs_state_check",
      sql`(${table.status} = 'running' and ${table.result} is null and ${table.recoveryReason} is null and ${table.completedAt} is null) or
      (${table.status} = 'succeeded' and ${table.result} is not null and ${table.recoveryReason} is null and ${table.completedAt} is not null) or
      (${table.status} = 'manual_recovery' and ${table.result} is null and ${table.recoveryReason} is not null and ${table.completedAt} is null)`,
    ),
  ],
)

export const processJobs = processSchema.table(
  "jobs",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    fenceScope: text("fence_scope")
      .notNull()
      .default(sql`'job:' || uuidv7()`),
    leaseGeneration: bigint("lease_generation", { mode: "string" }).notNull().default("0"),
    jobType: text("job_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    priority: integer("priority").notNull().default(0),
    status: processJobStatus("status").notNull().default("pending"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).defaultNow().notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    leaseOwner: text("lease_owner"),
    leaseToken: uuid("lease_token"),
    attempts: integer("attempts").notNull().default(0),
    payload: json("payload").notNull(),
    lastError: text("last_error"),
    correlationId: text("correlation_id").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("process_jobs_tenant_type_key").on(table.tenantId, table.jobType, table.idempotencyKey),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "process_jobs_tenant_id_fkey",
    }).onDelete("cascade"),
    check(
      "process_jobs_type_check",
      sql`${table.jobType} in ('process.order_confirmation.post_commit', 'process.order_cancellation.post_commit', 'process.order_fulfillment.post_commit', 'accounting.financial_operation.submit', 'accounting.financial_operation.reconcile')`,
    ),
    check("process_jobs_idempotency_key_check", sql`${table.idempotencyKey} ~ '[^[:space:]]'`),
    check("process_jobs_correlation_id_check", sql`${table.correlationId} ~ '[^[:space:]]'`),
    check("process_jobs_attempts_check", sql`${table.attempts} >= 0`),
    check("process_jobs_fence_scope_check", sql`${table.fenceScope} ~ '[^[:space:]]'`),
    check("process_jobs_lease_generation_check", sql`${table.leaseGeneration} >= 0`),
    check(
      "process_jobs_lease_state_check",
      sql`(${table.status} = 'leased' and ${table.leaseUntil} is not null and
        ${table.leaseOwner} is not null and ${table.leaseOwner} ~ '[^[:space:]]' and
        ${table.leaseToken} is not null) or
      (${table.status} <> 'leased' and ${table.leaseUntil} is null and
        ${table.leaseOwner} is null and ${table.leaseToken} is null)`,
    ),
    check(
      "process_jobs_state_check",
      sql`(${table.status} = 'pending' and ${table.leaseUntil} is null and ${table.completedAt} is null) or
      (${table.status} = 'leased' and ${table.leaseUntil} is not null and ${table.completedAt} is null) or
      (${table.status} = 'completed' and ${table.leaseUntil} is null and ${table.completedAt} is not null) or
      (${table.status} in ('failed', 'manual_recovery') and ${table.leaseUntil} is null and ${table.completedAt} is null)`,
    ),
  ],
)
