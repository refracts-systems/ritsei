import { and, desc, eq } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Match from "effect/Match"
import * as Data from "effect/Data"

import {
  externalConnectorGovernance,
  externalGovernanceAudit,
} from "../../../../db/schema/integration.ts"
import {
  Database,
  DatabaseFailure,
  type DrizzleTransaction,
  isDatabaseConstraint,
  uuidv7,
} from "../../../foundation/mod.ts"
import { CompatibilityRangeSchema } from "../../module/mod.ts"
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
    input: Schema.Codec.Encoded<typeof RegisterExternalConnectorInput>,
  ) => Effect.Effect<ExternalGovernanceMutation, GovernanceStoreError>
  readonly transition: (
    input: Schema.Codec.Encoded<typeof ExternalConnectorTransitionInput>,
  ) => Effect.Effect<ExternalGovernanceMutation, GovernanceStoreError>
  readonly recordDeliveryControl: (
    input: Schema.Codec.Encoded<typeof ExternalDeliveryControlInput>,
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
  // SAFETY: audit details are written only from ExternalGovernanceAuditRecord["details"].
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

type TransitionResult = Data.TaggedEnum<{
  Updated: { readonly row: GovernanceRow; readonly audit: AuditRow }
  Duplicate: { readonly row: GovernanceRow; readonly audit: AuditRow }
  Missing: {}
  Conflict: {}
  NotReviewed: {}
  Retired: {}
}>

const TransitionResult = Data.taggedEnum<TransitionResult>()

type TransitionDecision = Data.TaggedEnum<{
  Advance: { readonly status: GovernanceRow["status"] }
  Conflict: {}
  NotReviewed: {}
  Retired: {}
}>

const TransitionDecision = Data.taggedEnum<TransitionDecision>()

const transitionStatus = (
  row: GovernanceRow,
  input: ExternalConnectorTransitionInput,
): TransitionDecision => {
  if (row.status === "retired") return TransitionDecision.Retired()

  if (input.action === "review") {
    return row.status === "draft"
      ? TransitionDecision.Advance({ status: "reviewed" })
      : TransitionDecision.Conflict()
  }

  if (input.action === "activate") {
    return row.status === "reviewed"
      ? TransitionDecision.Advance({ status: "active" })
      : TransitionDecision.NotReviewed()
  }

  return TransitionDecision.Advance({ status: "retired" })
}

const transitionAuditAction = (
  action: ExternalConnectorTransitionInput["action"],
): AuditRow["action"] =>
  Match.value(action).pipe(
    Match.when("review", () => "reviewed" as const),
    Match.when("activate", () => "activated" as const),
    Match.when("retire", () => "retired" as const),
    Match.exhaustive,
  )

const mapMutationFailure = (
  kind: "NotReviewed" | "Retired" | "Other",
  input: { readonly connectorId: string; readonly version: number },
): Effect.Effect<never, GovernanceStoreError> => {
  if (kind === "NotReviewed") {
    return Effect.fail(
      new ExternalConnectorNotReviewed({
        connectorId: input.connectorId,
        version: input.version,
      }),
    )
  }

  if (kind === "Retired") {
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
    ? TransitionResult.Duplicate({ row, audit })
    : TransitionResult.Conflict()
}

const applyTransition = async (
  transaction: DrizzleTransaction,
  input: ExternalConnectorTransitionInput,
  existing: GovernanceRow,
): Promise<TransitionResult> => {
  const next = transitionStatus(existing, input)

  if (TransitionDecision.$is("Conflict")(next)) return TransitionResult.Conflict()

  if (TransitionDecision.$is("NotReviewed")(next)) return TransitionResult.NotReviewed()

  if (TransitionDecision.$is("Retired")(next)) return TransitionResult.Retired()

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

  if (row === undefined) return TransitionResult.Missing()

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

  return audit === undefined ? TransitionResult.Missing() : TransitionResult.Updated({ row, audit })
}

export type RecordDeliveryControlOutcome = Data.TaggedEnum<{
  Duplicate: { readonly audit: AuditRow }
  Conflict: {}
  Missing: {}
  Retired: {}
  Created: {
    readonly audit: {
      tenantId: string
      connectorId: string
      actor: string
      idempotencyKey: string
      reason: string
      retentionUntil: Date
      id: string
      createdAt: Date
      action: "retired" | "reviewed" | "registered" | "activated" | "delivery_control"
      connectorVersion: number
      operationId: string | null
      details: unknown
    }
  }
}>

export const RecordDeliveryControlOutcome = Data.taggedEnum<RecordDeliveryControlOutcome>()

export type RegisterOutcome = Data.TaggedEnum<{
  Missing: {}
  Duplicate: { readonly row: GovernanceRow; readonly audit: AuditRow }
  Conflict: {}
  Updated: {
    readonly row: {
      minimumVersion: number
      maximumVersion: number
      tenantId: string
      connectorId: string
      version: number
      owner: string
      reviewedBy: string | null
      reviewedAt: Date | null
      retiredAt: Date | null
      id: string
      status: "retired" | "draft" | "reviewed" | "active"
      createdAt: Date
      updatedAt: Date
    }
    readonly audit: {
      tenantId: string
      connectorId: string
      actor: string
      idempotencyKey: string
      reason: string
      retentionUntil: Date
      id: string
      createdAt: Date
      action: "retired" | "reviewed" | "registered" | "activated" | "delivery_control"
      connectorVersion: number
      operationId: string | null
      details: unknown
    }
  }
}>

export const RegisterOutcome = Data.taggedEnum<RegisterOutcome>()

export const makePostgresExternalGovernanceStore = Effect.gen(function* () {
  const database = yield* Database

  const register = (input: Schema.Codec.Encoded<typeof RegisterExternalConnectorInput>) =>
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
            ? RegisterOutcome.Missing()
            : audit.action === "registered" &&
                audit.connectorId === decoded.connectorId &&
                audit.connectorVersion === decoded.version
              ? RegisterOutcome.Duplicate({ row, audit })
              : RegisterOutcome.Conflict()
        }

        const existing = await selectGovernance(
          transaction,
          decoded.tenantId,
          decoded.connectorId,
          decoded.version,
          true,
        )

        if (existing !== undefined) return RegisterOutcome.Conflict()

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

        if (row === undefined) return RegisterOutcome.Missing()

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
          ? RegisterOutcome.Missing()
          : RegisterOutcome.Updated({ row, audit: createdAudit })
      }, "integration.connector.register")

      if (RegisterOutcome.$is("Conflict")(result)) {
        return yield* Effect.fail(mapIdempotencyFailure(decoded.tenantId, decoded.idempotencyKey))
      }

      if (RegisterOutcome.$is("Missing")(result)) {
        return yield* Effect.fail(
          new DatabaseFailure({
            operation: "integration.connector.register",
            cause: "governance record was not persisted",
          }),
        )
      }

      return {
        record: toGovernanceRecord(result.row),
        duplicate: RegisterOutcome.$is("Duplicate")(result),
      }
    }).pipe(
      Effect.catchIf(
        (error) =>
          error instanceof DatabaseFailure &&
          (isDatabaseConstraint(error, "external_connector_governance_identity") ||
            isDatabaseConstraint(error, "external_governance_audit_idempotency_key")),
        (error) => Effect.fail(error),
      ),
    )

  const transition = (input: Schema.Codec.Encoded<typeof ExternalConnectorTransitionInput>) =>
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

        if (existing === undefined) return TransitionResult.Missing()

        return applyTransition(transaction, decoded, existing)
      }, "integration.connector.transition")

      return yield* TransitionResult.$match(result, {
        Missing: () => mapMutationFailure("Other", decoded),
        Conflict: () =>
          Effect.fail(mapIdempotencyFailure(decoded.tenantId, decoded.idempotencyKey)),
        NotReviewed: () => mapMutationFailure("NotReviewed", decoded),
        Retired: () => mapMutationFailure("Retired", decoded),
        Updated: ({ row }) => Effect.succeed({ record: toGovernanceRecord(row), duplicate: false }),
        Duplicate: ({ row }) =>
          Effect.succeed({ record: toGovernanceRecord(row), duplicate: true }),
      })
    })

  const recordDeliveryControl = (
    input: Schema.Codec.Encoded<typeof ExternalDeliveryControlInput>,
  ) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(ExternalDeliveryControlInput)(input)

      const result = yield* database.transaction(async (transaction) => {
        const audit = await selectAuditByKey(transaction, decoded.tenantId, decoded.idempotencyKey)

        if (audit !== undefined) {
          return audit.action === "delivery_control" &&
            audit.connectorId === decoded.connectorId &&
            audit.connectorVersion === decoded.version
            ? RecordDeliveryControlOutcome.Duplicate({ audit })
            : RecordDeliveryControlOutcome.Conflict()
        }

        const connector = await selectGovernance(
          transaction,
          decoded.tenantId,
          decoded.connectorId,
          decoded.version,
          true,
        )

        if (connector === undefined) return RecordDeliveryControlOutcome.Missing()

        if (connector.status === "retired") return RecordDeliveryControlOutcome.Retired()

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
          ? RecordDeliveryControlOutcome.Missing()
          : RecordDeliveryControlOutcome.Created({ audit: createdAudit })
      }, "integration.delivery.control")

      if (RecordDeliveryControlOutcome.$is("Conflict")(result)) {
        return yield* Effect.fail(mapIdempotencyFailure(decoded.tenantId, decoded.idempotencyKey))
      }

      if (RecordDeliveryControlOutcome.$is("Retired")(result)) {
        return yield* Effect.fail(
          new ExternalConnectorRetired({
            connectorId: decoded.connectorId,
            version: decoded.version,
          }),
        )
      }

      if (RecordDeliveryControlOutcome.$is("Missing")(result)) {
        return yield* Effect.fail(invalid(`${decoded.connectorId}:${decoded.version}`))
      }

      return {
        audit: toAuditRecord(result.audit),
        duplicate: RecordDeliveryControlOutcome.$is("Duplicate")(result),
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
