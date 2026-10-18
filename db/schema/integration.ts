import { sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, updatedAt, uuidv7 } from "./common.ts"

export const integrationSchema = pgSchema("integration")
export const externalReliabilityKind = integrationSchema.enum("external_reliability_kind", [
  "action",
  "event",
])
export const externalProviderStatus = integrationSchema.enum("external_provider_status", [
  "pending",
  "accepted",
  "rejected",
  "unknown",
])
export const externalDeliveryState = integrationSchema.enum("external_delivery_state", [
  "accepted",
  "retry",
  "dead_letter",
])
export const externalConnectorStatus = integrationSchema.enum("external_connector_status", [
  "draft",
  "reviewed",
  "active",
  "retired",
])
export const externalGovernanceAction = integrationSchema.enum("external_governance_action", [
  "registered",
  "reviewed",
  "activated",
  "retired",
  "delivery_control",
])

export const externalReliabilityRecords = integrationSchema.table(
  "reliability_records",
  {
    id: uuidv7("id")
      .default(sql`uuidv7()`)
      .notNull(),
    tenantId: uuid("tenant_id").notNull(),
    replayKey: text("replay_key").notNull(),
    kind: externalReliabilityKind("kind").notNull(),
    connectorId: text("connector_id").notNull(),
    operationId: text("operation_id").notNull(),
    providerStatus: externalProviderStatus("provider_status").notNull(),
    state: externalDeliveryState("state").notNull(),
    attempts: integer("attempts").notNull(),
    maxAttempts: integer("max_attempts").notNull(),
    payload: jsonb("payload").notNull(),
    payloadBytes: integer("payload_bytes").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    correlationId: text("correlation_id").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({
      name: "external_reliability_records_pkey",
      columns: [table.tenantId, table.id],
    }),
    unique("external_reliability_records_replay_key").on(table.tenantId, table.replayKey),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "external_reliability_records_tenant_id_fkey",
    }).onDelete("cascade"),
    check(
      "external_reliability_records_replay_key_check",
      sql`${table.replayKey} ~ '[^[:space:]]'`,
    ),
    check(
      "external_reliability_records_connector_id_check",
      sql`${table.connectorId} ~ '[^[:space:]]'`,
    ),
    check(
      "external_reliability_records_operation_id_check",
      sql`${table.operationId} ~ '[^[:space:]]'`,
    ),
    check("external_reliability_records_attempts_check", sql`${table.attempts} >= 0`),
    check("external_reliability_records_max_attempts_check", sql`${table.maxAttempts} > 0`),
    check("external_reliability_records_payload_bytes_check", sql`${table.payloadBytes} >= 0`),
    check(
      "external_reliability_records_correlation_id_check",
      sql`${table.correlationId} ~ '[^[:space:]]'`,
    ),
  ],
)

export const externalConnectorGovernance = integrationSchema.table(
  "connector_governance",
  {
    id: uuidv7("id")
      .default(sql`uuidv7()`)
      .notNull(),
    tenantId: uuid("tenant_id").notNull(),
    connectorId: text("connector_id").notNull(),
    version: integer("version").notNull(),
    status: externalConnectorStatus("status").notNull(),
    owner: text("owner").notNull(),
    minimumVersion: integer("minimum_version").notNull(),
    maximumVersion: integer("maximum_version").notNull(),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({
      name: "external_connector_governance_pkey",
      columns: [table.tenantId, table.id],
    }),
    unique("external_connector_governance_identity").on(
      table.tenantId,
      table.connectorId,
      table.version,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "external_connector_governance_tenant_id_fkey",
    }).onDelete("cascade"),
    check(
      "external_connector_governance_connector_id_check",
      sql`${table.connectorId} ~ '[^[:space:]]'`,
    ),
    check("external_connector_governance_owner_check", sql`${table.owner} ~ '[^[:space:]]'`),
    check("external_connector_governance_version_check", sql`${table.version} > 0`),
    check("external_connector_governance_minimum_version_check", sql`${table.minimumVersion} > 0`),
    check("external_connector_governance_maximum_version_check", sql`${table.maximumVersion} > 0`),
    check(
      "external_connector_governance_compatibility_check",
      sql`${table.minimumVersion} <= ${table.maximumVersion}`,
    ),
  ],
)

export const externalGovernanceAudit = integrationSchema.table(
  "governance_audit",
  {
    id: uuidv7("id")
      .default(sql`uuidv7()`)
      .notNull(),
    tenantId: uuid("tenant_id").notNull(),
    connectorId: text("connector_id").notNull(),
    connectorVersion: integer("connector_version").notNull(),
    action: externalGovernanceAction("action").notNull(),
    actor: text("actor").notNull(),
    operationId: text("operation_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    reason: text("reason").notNull(),
    retentionUntil: timestamp("retention_until", { withTimezone: true }).notNull(),
    details: jsonb("details").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      name: "external_governance_audit_pkey",
      columns: [table.tenantId, table.id],
    }),
    unique("external_governance_audit_idempotency_key").on(table.tenantId, table.idempotencyKey),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "external_governance_audit_tenant_id_fkey",
    }).onDelete("cascade"),
    check(
      "external_governance_audit_connector_id_check",
      sql`${table.connectorId} ~ '[^[:space:]]'`,
    ),
    check("external_governance_audit_actor_check", sql`${table.actor} ~ '[^[:space:]]'`),
    check(
      "external_governance_audit_idempotency_key_check",
      sql`${table.idempotencyKey} ~ '[^[:space:]]'`,
    ),
    check("external_governance_audit_reason_check", sql`${table.reason} ~ '[^[:space:]]'`),
    check("external_governance_audit_version_check", sql`${table.connectorVersion} > 0`),
  ],
)
