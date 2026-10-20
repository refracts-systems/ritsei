import type * as Schema from "effect/Schema"

/** A selected row: the aliased columns of the query, each holding a JSON value. */
export type SqlRow<Column extends string> = { readonly [Name in Column]: Schema.Json }

export type WorkflowRunRow = SqlRow<
  | "id"
  | "tenantId"
  | "workflowType"
  | "idempotencyKey"
  | "aggregateId"
  | "status"
  | "payload"
  | "result"
  | "recoveryReason"
  | "completedAt"
>

export type OutboxEventRow = SqlRow<
  | "eventId"
  | "eventType"
  | "eventVersion"
  | "tenantId"
  | "aggregateType"
  | "aggregateId"
  | "commandId"
  | "correlationId"
  | "causationId"
  | "idempotencyKey"
  | "actorPrincipalId"
  | "occurredAt"
  | "payload"
  | "publishedAt"
  | "attempts"
>

export type ProcessJobRow = SqlRow<
  | "jobId"
  | "tenantId"
  | "fenceScope"
  | "leaseGeneration"
  | "jobType"
  | "idempotencyKey"
  | "priority"
  | "status"
  | "scheduledAt"
  | "leaseUntil"
  | "attempts"
  | "payload"
  | "correlationId"
>
