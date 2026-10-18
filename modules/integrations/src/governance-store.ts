import { and, desc, eq } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  externalConnectorGovernance,
  externalGovernanceAudit,
} from "../../../db/schema/integration.ts"
import {
  Database,
  DatabaseFailure,
  type DrizzleTransaction,
  isDatabaseConstraint,
  uuidv7,
} from "../../../foundation/mod.ts"
import { CompatibilityRangeSchema } from "../../catalog/mod.ts"
import {
  ExternalConnectorNotReviewed,
  ExternalConnectorRetired,
  ExternalIdempotencyConflict,
  ExternalPayloadInvalid,
} from "./errors.ts"
import { ExternalConnectorStatus, ExternalDeliveryControlKind } from "./governance.ts"

const Uuid = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
)
const NonEmptyString = Schema.String.check(Schema.isPattern(/.*\S.*/))
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const InstantString = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
)
export const ExternalGovernanceAuditAction = Schema.Literals([
  "registered",
  "reviewed",
  "activated",
  "retired",
  "delivery_control",
])

export const RegisterExternalConnectorInput = Schema.Struct({
  tenantId: Uuid,
  connectorId: NonEmptyString,
  version: PositiveInt,
  owner: NonEmptyString,
  compatibilityRange: CompatibilityRangeSchema,
  actor: NonEmptyString,
  idempotencyKey: NonEmptyString,
  reason: NonEmptyString,
  retentionUntil: InstantString,
})
export type RegisterExternalConnectorInput = Schema.Schema.Type<
  typeof RegisterExternalConnectorInput
>

export const ExternalConnectorTransitionInput = Schema.Struct({
  tenantId: Uuid,
  connectorId: NonEmptyString,
  version: PositiveInt,
  action: Schema.Literals(["review", "activate", "retire"]),
  actor: NonEmptyString,
  idempotencyKey: NonEmptyString,
  reason: NonEmptyString,
  occurredAt: InstantString,
  retentionUntil: InstantString,
})
export type ExternalConnectorTransitionInput = Schema.Schema.Type<
  typeof ExternalConnectorTransitionInput
>

export const ExternalDeliveryControlInput = Schema.Struct({
  tenantId: Uuid,
  connectorId: NonEmptyString,
  version: PositiveInt,
  actor: NonEmptyString,
  idempotencyKey: NonEmptyString,
  reason: NonEmptyString,
  retentionUntil: InstantString,
  control: Schema.Struct({
    kind: ExternalDeliveryControlKind,
    operationId: NonEmptyString,
    reason: NonEmptyString,
  }),
})
export type ExternalDeliveryControlInput = Schema.Schema.Type<typeof ExternalDeliveryControlInput>

export const ExternalConnectorGovernanceRecord = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  connectorId: NonEmptyString,
  version: PositiveInt,
  status: ExternalConnectorStatus,
  owner: NonEmptyString,
  minimumVersion: PositiveInt,
  maximumVersion: PositiveInt,
  reviewedBy: Schema.NullOr(NonEmptyString),
  reviewedAt: Schema.NullOr(InstantString),
  retiredAt: Schema.NullOr(InstantString),
  createdAt: InstantString,
  updatedAt: InstantString,
})
export type ExternalConnectorGovernanceRecord = Schema.Schema.Type<
  typeof ExternalConnectorGovernanceRecord
>

export const ExternalGovernanceAuditRecord = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  connectorId: NonEmptyString,
  connectorVersion: PositiveInt,
  action: ExternalGovernanceAuditAction,
  actor: NonEmptyString,
  operationId: Schema.NullOr(NonEmptyString),
  idempotencyKey: NonEmptyString,
  reason: NonEmptyString,
  retentionUntil: InstantString,
  details: Schema.Json,
  createdAt: InstantString,
})
export type ExternalGovernanceAuditRecord = Schema.Schema.Type<typeof ExternalGovernanceAuditRecord>

export type ExternalGovernanceMutation = {
  readonly record: ExternalConnectorGovernanceRecord
  readonly duplicate: boolean
}

export type ExternalGovernanceAuditMutation = {
  readonly audit: ExternalGovernanceAuditRecord
  readonly duplicate: boolean
}

// Durable governance evidence: reviewed connector lifecycle, connector retirement, delivery controls,
// and append-only audit records with retention.
type GovernanceStoreError =
  | DatabaseFailure
  | ExternalConnectorNotReviewed
  | ExternalConnectorRetired
  | ExternalIdempotencyConflict
  | ExternalPayloadInvalid
  | Schema.SchemaError

export interface ExternalGovernanceStore {
  readonly register: (
    input: unknown,
  ) => Effect.Effect<ExternalGovernanceMutation, GovernanceStoreError>
  readonly transition: (
    input: unknown,
  ) => Effect.Effect<ExternalGovernanceMutation, GovernanceStoreError>
  readonly recordDeliveryControl: (
    input: unknown,
  ) => Effect.Effect<ExternalGovernanceAuditMutation, GovernanceStoreError>
  readonly get: (
    tenantId: string,
    connectorId: string,
    version: number,
  ) => Effect.Effect<
    ExternalConnectorGovernanceRecord | undefined,
    DatabaseFailure | ExternalPayloadInvalid
  >
  readonly listAudit: (
    tenantId: string,
    connectorId: string,
    version: number,
    limit?: number,
  ) => Effect.Effect<
    readonly ExternalGovernanceAuditRecord[],
    DatabaseFailure | ExternalPayloadInvalid
  >
}

type GovernanceRow = {
  readonly id: string
  readonly tenantId: string
  readonly connectorId: string
  readonly version: number
  readonly status: "draft" | "reviewed" | "active" | "retired"
  readonly owner: string
  readonly minimumVersion: number
  readonly maximumVersion: number
  readonly reviewedBy: string | null
  readonly reviewedAt: Date | null
  readonly retiredAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

type AuditRow = {
  readonly id: string
  readonly tenantId: string
  readonly connectorId: string
  readonly connectorVersion: number
  readonly action: "registered" | "reviewed" | "activated" | "retired" | "delivery_control"
  readonly actor: string
  readonly operationId: string | null
  readonly idempotencyKey: string
  readonly reason: string
  readonly retentionUntil: Date
  readonly details: unknown
  readonly createdAt: Date
}

const selectGovernance = async (
  transaction: DrizzleTransaction,
  tenantId: string,
  connectorId: string,
  version: number,
  lock = false,
): Promise<GovernanceRow | undefined> => {
  const query = transaction
    .select()
    .from(externalConnectorGovernance)
    .where(
      and(
        eq(externalConnectorGovernance.tenantId, tenantId),
        eq(externalConnectorGovernance.connectorId, connectorId),
        eq(externalConnectorGovernance.version, version),
      ),
    )
  const rows = lock ? await query.for("update") : await query
  return rows[0]
}

const selectAuditByKey = async (
  transaction: DrizzleTransaction,
  tenantId: string,
  idempotencyKey: string,
): Promise<AuditRow | undefined> => {
  const rows = await transaction
    .select()
    .from(externalGovernanceAudit)
    .where(
      and(
        eq(externalGovernanceAudit.tenantId, tenantId),
        eq(externalGovernanceAudit.idempotencyKey, idempotencyKey),
      ),
    )
    .for("update")
  return rows[0]
}

const toGovernanceRecord = (row: GovernanceRow): ExternalConnectorGovernanceRecord => ({
  id: row.id,
  tenantId: row.tenantId,
  connectorId: row.connectorId,
  version: row.version,
  status: row.status,
  owner: row.owner,
  minimumVersion: row.minimumVersion,
  maximumVersion: row.maximumVersion,
  reviewedBy: row.reviewedBy,
  reviewedAt: row.reviewedAt?.toISOString() ?? null,
  retiredAt: row.retiredAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const toAuditRecord = (row: AuditRow): ExternalGovernanceAuditRecord => ({
  id: row.id,
  tenantId: row.tenantId,
  connectorId: row.connectorId,
  connectorVersion: row.connectorVersion,
  action: row.action,
  actor: row.actor,
  operationId: row.operationId,
  idempotencyKey: row.idempotencyKey,
  reason: row.reason,
  retentionUntil: row.retentionUntil.toISOString(),
  details: row.details as ExternalGovernanceAuditRecord["details"],
  createdAt: row.createdAt.toISOString(),
})

const invalid = (identifier: string) =>
  new ExternalPayloadInvalid({ boundary: "integration.connector.governance", identifier })

const validateLookup = (
  tenantId: string,
  connectorId: string,
  version: number,
): Effect.Effect<void, ExternalPayloadInvalid> =>
  Schema.is(Uuid)(tenantId) &&
  Schema.is(NonEmptyString)(connectorId) &&
  Schema.is(PositiveInt)(version)
    ? Effect.succeed(undefined)
    : Effect.fail(invalid(connectorId || "connector"))

const auditValues = (input: {
  readonly tenantId: string
  readonly connectorId: string
  readonly version: number
  readonly action: AuditRow["action"]
  readonly actor: string
  readonly operationId?: string
  readonly idempotencyKey: string
  readonly reason: string
  readonly retentionUntil: string
  readonly details: Schema.Schema.Type<typeof Schema.Json>
}) => ({
  id: uuidv7(),
  tenantId: input.tenantId,
  connectorId: input.connectorId,
  connectorVersion: input.version,
  action: input.action,
  actor: input.actor,
  operationId: input.operationId,
  idempotencyKey: input.idempotencyKey,
  reason: input.reason,
  retentionUntil: new Date(input.retentionUntil),
  details: input.details,
})

type TransitionResult =
  | { readonly _tag: "updated"; readonly row: GovernanceRow; readonly audit: AuditRow }
  | { readonly _tag: "duplicate"; readonly row: GovernanceRow; readonly audit: AuditRow }
  | { readonly _tag: "missing" }
  | { readonly _tag: "conflict" }
  | { readonly _tag: "not_reviewed" }
  | { readonly _tag: "retired" }

type TransitionDecision =
  | { readonly _tag: "updated"; readonly status: GovernanceRow["status"] }
  | "conflict"
  | "not_reviewed"
  | "retired"

const transitionStatus = (
  row: GovernanceRow,
  input: ExternalConnectorTransitionInput,
): TransitionDecision => {
  if (row.status === "retired") return "retired"
  if (input.action === "review") {
    return row.status === "draft" ? { _tag: "updated", status: "reviewed" } : "conflict"
  }
  if (input.action === "activate") {
    return row.status === "reviewed" ? { _tag: "updated", status: "active" } : "not_reviewed"
  }
  return { _tag: "updated", status: "retired" }
}

const transitionAuditAction = (
  action: ExternalConnectorTransitionInput["action"],
): AuditRow["action"] =>
  action === "review" ? "reviewed" : action === "activate" ? "activated" : "retired"

const mapMutationFailure = (
  result: TransitionResult,
  input: { readonly connectorId: string; readonly version: number },
): Effect.Effect<never, GovernanceStoreError> => {
  if (result._tag === "not_reviewed") {
    return Effect.fail(
      new ExternalConnectorNotReviewed({
        connectorId: input.connectorId,
        version: input.version,
      }),
    )
  }
  if (result._tag === "retired") {
    return Effect.fail(
      new ExternalConnectorRetired({
        connectorId: input.connectorId,
        version: input.version,
      }),
    )
  }
  return Effect.fail(invalid(`${input.connectorId}:${input.version}`))
}

const mapIdempotencyFailure = (
  tenantId: string,
  idempotencyKey: string,
): ExternalIdempotencyConflict => new ExternalIdempotencyConflict({ tenantId, idempotencyKey })

const findTransitionReplay = async (
  transaction: DrizzleTransaction,
  input: ExternalConnectorTransitionInput,
): Promise<TransitionResult | undefined> => {
  const audit = await selectAuditByKey(transaction, input.tenantId, input.idempotencyKey)
  if (audit === undefined) return undefined
  const row = await selectGovernance(transaction, input.tenantId, input.connectorId, input.version)
  return row !== undefined &&
    audit.connectorId === input.connectorId &&
    audit.connectorVersion === input.version
    ? { _tag: "duplicate", row, audit }
    : { _tag: "conflict" }
}

const applyTransition = async (
  transaction: DrizzleTransaction,
  input: ExternalConnectorTransitionInput,
  existing: GovernanceRow,
): Promise<TransitionResult> => {
  const next = transitionStatus(existing, input)
  if (typeof next === "string") return { _tag: next }
  const [row] = await transaction
    .update(externalConnectorGovernance)
    .set({
      status: next.status,
      reviewedBy: input.action === "review" ? input.actor : existing.reviewedBy,
      reviewedAt: input.action === "review" ? new Date(input.occurredAt) : existing.reviewedAt,
      retiredAt: input.action === "retire" ? new Date(input.occurredAt) : existing.retiredAt,
      updatedAt: new Date(input.occurredAt),
    })
    .where(
      and(
        eq(externalConnectorGovernance.tenantId, input.tenantId),
        eq(externalConnectorGovernance.id, existing.id),
      ),
    )
    .returning()
  if (row === undefined) return { _tag: "missing" }
  const [audit] = await transaction
    .insert(externalGovernanceAudit)
    .values(
      auditValues({
        tenantId: input.tenantId,
        connectorId: input.connectorId,
        version: input.version,
        action: transitionAuditAction(input.action),
        actor: input.actor,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        retentionUntil: input.retentionUntil,
        details: { status: next.status },
      }),
    )
    .returning()
  return audit === undefined ? { _tag: "missing" } : { _tag: "updated", row, audit }
}

export const makePostgresExternalGovernanceStore = Effect.gen(function* () {
  const database = yield* Database

  const register = (input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(RegisterExternalConnectorInput)(input)
      const result = yield* database.transaction(async (transaction) => {
        const audit = await selectAuditByKey(transaction, decoded.tenantId, decoded.idempotencyKey)
        if (audit !== undefined) {
          const row = await selectGovernance(
            transaction,
            audit.tenantId,
            audit.connectorId,
            audit.connectorVersion,
          )
          return row === undefined
            ? { _tag: "missing" as const }
            : audit.action === "registered" &&
                audit.connectorId === decoded.connectorId &&
                audit.connectorVersion === decoded.version
              ? { _tag: "duplicate" as const, row, audit }
              : { _tag: "conflict" as const }
        }
        const existing = await selectGovernance(
          transaction,
          decoded.tenantId,
          decoded.connectorId,
          decoded.version,
          true,
        )
        if (existing !== undefined) return { _tag: "conflict" as const }
        const [row] = await transaction
          .insert(externalConnectorGovernance)
          .values({
            id: uuidv7(),
            tenantId: decoded.tenantId,
            connectorId: decoded.connectorId,
            version: decoded.version,
            status: "draft",
            owner: decoded.owner,
            minimumVersion: decoded.compatibilityRange.minimumVersion,
            maximumVersion: decoded.compatibilityRange.maximumVersion,
          })
          .returning()
        if (row === undefined) return { _tag: "missing" as const }
        const [createdAudit] = await transaction
          .insert(externalGovernanceAudit)
          .values(
            auditValues({
              tenantId: decoded.tenantId,
              connectorId: decoded.connectorId,
              version: decoded.version,
              action: "registered",
              actor: decoded.actor,
              idempotencyKey: decoded.idempotencyKey,
              reason: decoded.reason,
              retentionUntil: decoded.retentionUntil,
              details: { status: "draft", owner: decoded.owner },
            }),
          )
          .returning()
        return createdAudit === undefined
          ? { _tag: "missing" as const }
          : { _tag: "updated" as const, row, audit: createdAudit }
      }, "integration.connector.register")
      if (result._tag === "conflict") {
        return yield* Effect.fail(mapIdempotencyFailure(decoded.tenantId, decoded.idempotencyKey))
      }
      if (result._tag === "missing") {
        return yield* Effect.fail(
          new DatabaseFailure({
            operation: "integration.connector.register",
            cause: "governance record was not persisted",
          }),
        )
      }
      return { record: toGovernanceRecord(result.row), duplicate: result._tag === "duplicate" }
    }).pipe(
      Effect.catchIf(
        (error) =>
          error instanceof DatabaseFailure &&
          (isDatabaseConstraint(error, "external_connector_governance_identity") ||
            isDatabaseConstraint(error, "external_governance_audit_idempotency_key")),
        (error) => Effect.fail(error),
      ),
    )

  const transition = (input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(ExternalConnectorTransitionInput)(input)
      const result = yield* database.transaction(async (transaction): Promise<TransitionResult> => {
        const replay = await findTransitionReplay(transaction, decoded)
        if (replay !== undefined) return replay
        const existing = await selectGovernance(
          transaction,
          decoded.tenantId,
          decoded.connectorId,
          decoded.version,
          true,
        )
        if (existing === undefined) return { _tag: "missing" }
        return applyTransition(transaction, decoded, existing)
      }, "integration.connector.transition")
      if (result._tag === "missing") {
        return yield* Effect.fail(invalid(`${decoded.connectorId}:${decoded.version}`))
      }
      if (result._tag === "conflict") {
        return yield* Effect.fail(mapIdempotencyFailure(decoded.tenantId, decoded.idempotencyKey))
      }
      if (result._tag === "not_reviewed" || result._tag === "retired") {
        return yield* mapMutationFailure(result, decoded)
      }
      return { record: toGovernanceRecord(result.row), duplicate: result._tag === "duplicate" }
    })

  const recordDeliveryControl = (input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(ExternalDeliveryControlInput)(input)
      const result = yield* database.transaction(async (transaction) => {
        const audit = await selectAuditByKey(transaction, decoded.tenantId, decoded.idempotencyKey)
        if (audit !== undefined) {
          return audit.action === "delivery_control" &&
            audit.connectorId === decoded.connectorId &&
            audit.connectorVersion === decoded.version
            ? { _tag: "duplicate" as const, audit }
            : { _tag: "conflict" as const }
        }
        const connector = await selectGovernance(
          transaction,
          decoded.tenantId,
          decoded.connectorId,
          decoded.version,
          true,
        )
        if (connector === undefined) return { _tag: "missing" as const }
        if (connector.status === "retired") return { _tag: "retired" as const }
        const [createdAudit] = await transaction
          .insert(externalGovernanceAudit)
          .values(
            auditValues({
              tenantId: decoded.tenantId,
              connectorId: decoded.connectorId,
              version: decoded.version,
              action: "delivery_control",
              actor: decoded.actor,
              operationId: decoded.control.operationId,
              idempotencyKey: decoded.idempotencyKey,
              reason: decoded.reason,
              retentionUntil: decoded.retentionUntil,
              details: { kind: decoded.control.kind, reason: decoded.control.reason },
            }),
          )
          .returning()
        return createdAudit === undefined
          ? { _tag: "missing" as const }
          : { _tag: "created" as const, audit: createdAudit }
      }, "integration.delivery.control")
      if (result._tag === "conflict") {
        return yield* Effect.fail(mapIdempotencyFailure(decoded.tenantId, decoded.idempotencyKey))
      }
      if (result._tag === "retired") {
        return yield* Effect.fail(
          new ExternalConnectorRetired({
            connectorId: decoded.connectorId,
            version: decoded.version,
          }),
        )
      }
      if (result._tag === "missing") {
        return yield* Effect.fail(invalid(`${decoded.connectorId}:${decoded.version}`))
      }
      return {
        audit: toAuditRecord(result.audit),
        duplicate: result._tag === "duplicate",
      }
    })

  return {
    register,
    transition,
    recordDeliveryControl,
    get: (tenantId, connectorId, version) =>
      Effect.gen(function* () {
        yield* validateLookup(tenantId, connectorId, version)
        const rows = yield* database.query(
          (db) =>
            db
              .select()
              .from(externalConnectorGovernance)
              .where(
                and(
                  eq(externalConnectorGovernance.tenantId, tenantId),
                  eq(externalConnectorGovernance.connectorId, connectorId),
                  eq(externalConnectorGovernance.version, version),
                ),
              )
              .limit(1),
          "integration.connector.get",
        )
        const row = rows[0]
        return row === undefined ? undefined : toGovernanceRecord(row)
      }),
    listAudit: (tenantId, connectorId, version, limit = 100) =>
      Effect.gen(function* () {
        yield* validateLookup(tenantId, connectorId, version)
        if (!Number.isInteger(limit) || limit <= 0) {
          return yield* Effect.fail(invalid(`${connectorId}:${version}`))
        }
        const rows = yield* database.query(
          (db) =>
            db
              .select()
              .from(externalGovernanceAudit)
              .where(
                and(
                  eq(externalGovernanceAudit.tenantId, tenantId),
                  eq(externalGovernanceAudit.connectorId, connectorId),
                  eq(externalGovernanceAudit.connectorVersion, version),
                ),
              )
              .orderBy(desc(externalGovernanceAudit.createdAt))
              .limit(Math.min(limit, 1_000)),
          "integration.connector.audit",
        )
        return rows.map(toAuditRecord)
      }),
  } satisfies ExternalGovernanceStore
})
