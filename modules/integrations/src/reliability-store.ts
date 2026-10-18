import { and, desc, eq } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import { externalReliabilityRecords } from "../../../db/schema/integration.ts"
import { Database, DatabaseFailure, uuidv7 } from "../../../foundation/mod.ts"
import { ExternalCatalogLimits } from "./contract.ts"
import {
  ExternalCompatibilityMismatch,
  ExternalIdempotencyConflict,
  ExternalPayloadInvalid,
  ExternalPayloadLimitExceeded,
} from "./errors.ts"
import {
  assessExternalDelivery,
  ExternalDeliveryState,
  ExternalProviderStatus,
} from "./reliability.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const NonEmptyString = Schema.String.check(
  Schema.isPattern(/\S/),
  Schema.isMaxLength(ExternalCatalogLimits.maxIdentifierLength),
)
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const AttemptCount = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: ExternalCatalogLimits.maxAttempts }),
)
const MaxPayloadBytes = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: ExternalCatalogLimits.maxPayloadBytes }),
)
const InstantString = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
)

export const ExternalReliabilityKind = Schema.Literals(["action", "event"])

const ReliabilityInput = Schema.Struct({
  connectorId: NonEmptyString,
  connectorVersion: PositiveInt,
  operationId: NonEmptyString,
  providerStatus: ExternalProviderStatus,
  attempts: AttemptCount,
  maxAttempts: AttemptCount.check(Schema.isGreaterThan(0)),
  maxPayloadBytes: MaxPayloadBytes,
  payload: Schema.Json,
  sentAtMs: NonNegativeInt,
  observedAtMs: NonNegativeInt,
  compatibilityRange: Schema.Struct({
    minimumVersion: PositiveInt,
    maximumVersion: PositiveInt,
  }),
})

export const ExternalReliabilityRecordInput = Schema.Struct({
  tenantId: Uuid,
  replayKey: NonEmptyString,
  kind: ExternalReliabilityKind,
  correlationId: NonEmptyString,
  reliability: ReliabilityInput,
})
export type ExternalReliabilityRecordInput = Schema.Schema.Type<
  typeof ExternalReliabilityRecordInput
>

export const ExternalReliabilityRecord = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  replayKey: NonEmptyString,
  kind: ExternalReliabilityKind,
  connectorId: NonEmptyString,
  operationId: NonEmptyString,
  providerStatus: ExternalProviderStatus,
  state: ExternalDeliveryState,
  attempts: AttemptCount,
  maxAttempts: AttemptCount.check(Schema.isGreaterThan(0)),
  payload: Schema.Json,
  payloadBytes: NonNegativeInt,
  sentAt: InstantString,
  observedAt: InstantString,
  correlationId: NonEmptyString,
  createdAt: InstantString,
  updatedAt: InstantString,
})
export type ExternalReliabilityRecord = Schema.Schema.Type<typeof ExternalReliabilityRecord>

export const ExternalReliabilityHealth = Schema.Struct({
  tenantId: Uuid,
  connectorId: NonEmptyString,
  sampleSize: NonNegativeInt,
  accepted: NonNegativeInt,
  retrying: NonNegativeInt,
  deadLetters: NonNegativeInt,
  unknownProviderStatus: NonNegativeInt,
  maxLagMs: NonNegativeInt,
  averageLagMs: NonNegativeInt,
})
export type ExternalReliabilityHealth = Schema.Schema.Type<typeof ExternalReliabilityHealth>

// Durable integration evidence: dead letter handling, replay protection, provider status,
// redaction, compatibility, payload limits, and connector health/lag metrics.
export type ExternalReliabilityRecordResult = {
  readonly record: ExternalReliabilityRecord
  readonly duplicate: boolean
}

type ExternalReliabilityStoreError =
  | DatabaseFailure
  | ExternalCompatibilityMismatch
  | ExternalIdempotencyConflict
  | ExternalPayloadInvalid
  | ExternalPayloadLimitExceeded
  | Schema.SchemaError

export interface ExternalReliabilityStore {
  readonly record: (
    input: unknown,
  ) => Effect.Effect<ExternalReliabilityRecordResult, ExternalReliabilityStoreError>
  readonly get: (
    tenantId: string,
    replayKey: string,
  ) => Effect.Effect<
    ExternalReliabilityRecord | undefined,
    DatabaseFailure | ExternalPayloadInvalid
  >
  readonly health: (
    tenantId: string,
    connectorId: string,
    sampleLimit?: number,
  ) => Effect.Effect<ExternalReliabilityHealth, DatabaseFailure | ExternalPayloadInvalid>
}

const invalid = (boundary: string, identifier: string) =>
  new ExternalPayloadInvalid({ boundary, identifier })

const dateFromMilliseconds = (
  value: number,
  boundary: string,
  identifier: string,
): Effect.Effect<Date, ExternalPayloadInvalid> => {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? Effect.succeed(date)
    : Effect.fail(invalid(boundary, identifier))
}

const payloadBytes = (payload: unknown): number =>
  new TextEncoder().encode(JSON.stringify(payload)!).byteLength

const prepare = (input: unknown) =>
  Effect.gen(function*() {
    const decoded = yield* Schema.decodeUnknownEffect(ExternalReliabilityRecordInput)(input)
    const decision = yield* assessExternalDelivery(decoded.reliability)
    const sentAt = yield* dateFromMilliseconds(
      decoded.reliability.sentAtMs,
      "integration.reliability.sent-at",
      decoded.replayKey,
    )
    const observedAt = yield* dateFromMilliseconds(
      decoded.reliability.observedAtMs,
      "integration.reliability.observed-at",
      decoded.replayKey,
    )
    const now = new Date().toISOString()
    return yield* Schema.decodeUnknownEffect(ExternalReliabilityRecord)({
      id: uuidv7(),
      tenantId: decoded.tenantId,
      replayKey: decoded.replayKey,
      kind: decoded.kind,
      connectorId: decision.connectorId,
      operationId: decision.operationId,
      providerStatus: decision.providerStatus,
      state: decision.state,
      attempts: decision.attempts,
      maxAttempts: decoded.reliability.maxAttempts,
      payload: decision.payload,
      payloadBytes: payloadBytes(decoded.reliability.payload),
      sentAt: sentAt.toISOString(),
      observedAt: observedAt.toISOString(),
      correlationId: decoded.correlationId,
      createdAt: now,
      updatedAt: now,
    })
  })

const canonicalJson = (value: unknown): string =>
  JSON.stringify(
    value,
    (_key, child) =>
      typeof child === "object" && child !== null && !Array.isArray(child)
        ? Object.fromEntries(
          Object.entries(child).toSorted(([left], [right]) => left.localeCompare(right)),
        )
        : child,
  ) ?? ""

const replayFingerprint = (record: ExternalReliabilityRecord): string =>
  JSON.stringify([
    record.tenantId,
    record.replayKey,
    record.kind,
    record.connectorId,
    record.operationId,
    record.maxAttempts,
    record.correlationId,
  ])

const recordFingerprint = (record: ExternalReliabilityRecord): string =>
  JSON.stringify([
    replayFingerprint(record),
    record.providerStatus,
    record.state,
    record.attempts,
    record.payloadBytes,
    canonicalJson(record.payload),
  ])

const merge = (
  existing: ExternalReliabilityRecord,
  candidate: ExternalReliabilityRecord,
): ExternalReliabilityRecordResult | "conflict" => {
  if (replayFingerprint(existing) !== replayFingerprint(candidate)) return "conflict"
  if (recordFingerprint(existing) === recordFingerprint(candidate)) {
    return { record: existing, duplicate: true }
  }
  if (existing.state !== "retry") return "conflict"
  if (candidate.attempts < existing.attempts) return { record: existing, duplicate: true }
  if (candidate.attempts === existing.attempts && candidate.state === "retry") return "conflict"
  return {
    record: {
      ...candidate,
      id: existing.id,
      createdAt: existing.createdAt,
    },
    duplicate: false,
  }
}

type ReliabilityRow = {
  readonly id: string
  readonly tenantId: string
  readonly replayKey: string
  readonly kind: "action" | "event"
  readonly connectorId: string
  readonly operationId: string
  readonly providerStatus: "pending" | "accepted" | "rejected" | "unknown"
  readonly state: "accepted" | "retry" | "dead_letter"
  readonly attempts: number
  readonly maxAttempts: number
  readonly payload: unknown
  readonly payloadBytes: number
  readonly sentAt: Date
  readonly observedAt: Date
  readonly correlationId: string
  readonly createdAt: Date
  readonly updatedAt: Date
}

const rowToRecord = (row: ReliabilityRow): ExternalReliabilityRecord | undefined => {
  try {
    const result = Schema.decodeUnknownResult(ExternalReliabilityRecord)({
      id: row.id,
      tenantId: row.tenantId,
      replayKey: row.replayKey,
      kind: row.kind,
      connectorId: row.connectorId,
      operationId: row.operationId,
      providerStatus: row.providerStatus,
      state: row.state,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      payload: row.payload,
      payloadBytes: row.payloadBytes,
      sentAt: row.sentAt.toISOString(),
      observedAt: row.observedAt.toISOString(),
      correlationId: row.correlationId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })
    return Result.isSuccess(result) ? result.success : undefined
  } catch {
    return undefined
  }
}

const dbValues = (record: ExternalReliabilityRecord) => ({
  id: record.id,
  tenantId: record.tenantId,
  replayKey: record.replayKey,
  kind: record.kind,
  connectorId: record.connectorId,
  operationId: record.operationId,
  providerStatus: record.providerStatus,
  state: record.state,
  attempts: record.attempts,
  maxAttempts: record.maxAttempts,
  payload: record.payload,
  payloadBytes: record.payloadBytes,
  sentAt: new Date(record.sentAt),
  observedAt: new Date(record.observedAt),
  correlationId: record.correlationId,
})

const dbUpdate = (record: ExternalReliabilityRecord) => ({
  providerStatus: record.providerStatus,
  state: record.state,
  attempts: record.attempts,
  payload: record.payload,
  payloadBytes: record.payloadBytes,
  sentAt: new Date(record.sentAt),
  observedAt: new Date(record.observedAt),
  updatedAt: new Date(record.updatedAt),
})

const makeHealth = (
  tenantId: string,
  connectorId: string,
  records: readonly ExternalReliabilityRecord[],
): ExternalReliabilityHealth => {
  const lags = records.map((record) =>
    Math.max(0, new Date(record.observedAt).getTime() - new Date(record.sentAt).getTime())
  )
  const totalLag = lags.reduce((total, lag) => total + lag, 0)
  return {
    tenantId,
    connectorId,
    sampleSize: records.length,
    accepted: records.filter((record) => record.state === "accepted").length,
    retrying: records.filter((record) => record.state === "retry").length,
    deadLetters: records.filter((record) => record.state === "dead_letter").length,
    unknownProviderStatus: records.filter((record) => record.providerStatus === "unknown").length,
    maxLagMs: Math.max(0, ...lags),
    averageLagMs: records.length === 0 ? 0 : Math.round(totalLag / records.length),
  }
}

const validateLookup = (
  tenantId: string,
  identifier: string,
  boundary: string,
): Effect.Effect<void, ExternalPayloadInvalid> =>
  Schema.is(Uuid)(tenantId) && Schema.is(NonEmptyString)(identifier)
    ? Effect.succeed(undefined)
    : Effect.fail(invalid(boundary, identifier || "reliability"))

const validateSampleLimit = (
  sampleLimit: number,
  connectorId: string,
): Effect.Effect<number, ExternalPayloadInvalid> =>
  Number.isInteger(sampleLimit) && sampleLimit > 0
    ? Effect.succeed(Math.min(sampleLimit, 1_000))
    : Effect.fail(invalid("integration.reliability.health", connectorId))

export const makeMemoryExternalReliabilityStore = (): ExternalReliabilityStore => {
  const records = new Map<string, ExternalReliabilityRecord>()
  const key = (tenantId: string, replayKey: string) => `${tenantId}:${replayKey}`

  return {
    record: (input) =>
      Effect.gen(function*() {
        const candidate = yield* prepare(input)
        const recordKey = key(candidate.tenantId, candidate.replayKey)
        const existing = records.get(recordKey)
        if (existing === undefined) {
          records.set(recordKey, candidate)
          return { record: candidate, duplicate: false }
        }
        const merged = merge(existing, candidate)
        if (merged === "conflict") {
          return yield* Effect.fail(
            new ExternalIdempotencyConflict({
              tenantId: candidate.tenantId,
              idempotencyKey: candidate.replayKey,
            }),
          )
        }
        records.set(recordKey, merged.record)
        return merged
      }),
    get: (tenantId, replayKey) =>
      validateLookup(tenantId, replayKey, "integration.reliability.get").pipe(
        Effect.map(() => records.get(key(tenantId, replayKey))),
      ),
    health: (tenantId, connectorId, sampleLimit = 100) =>
      Effect.gen(function*() {
        yield* validateLookup(tenantId, connectorId, "integration.reliability.health")
        const limit = yield* validateSampleLimit(sampleLimit, connectorId)
        const values = [...records.values()]
          .filter((record) => record.tenantId === tenantId && record.connectorId === connectorId)
          .toSorted((left, right) => right.observedAt.localeCompare(left.observedAt))
          .slice(0, limit)
        return makeHealth(tenantId, connectorId, values)
      }),
  }
}

type PersistedRecordResult =
  | {
    readonly _tag: "result"
    readonly record: ExternalReliabilityRecord
    readonly duplicate: boolean
  }
  | { readonly _tag: "missing" }
  | { readonly _tag: "conflict" }
  | { readonly _tag: "invalid" }

export const makePostgresExternalReliabilityStore = Effect.gen(function*() {
  const database = yield* Database
  return {
    record: (input: unknown) =>
      Effect.gen(function*() {
        const candidate = yield* prepare(input)
        const result = yield* database.transaction(
          async (transaction): Promise<PersistedRecordResult> => {
            const [inserted] = await transaction.insert(externalReliabilityRecords).values(
              dbValues(candidate),
            ).onConflictDoNothing().returning()
            if (inserted !== undefined) {
              const record = rowToRecord(inserted)
              return record === undefined
                ? { _tag: "invalid" }
                : { _tag: "result", record, duplicate: false }
            }

            const [existingRow] = await transaction.select().from(externalReliabilityRecords).where(
              and(
                eq(externalReliabilityRecords.tenantId, candidate.tenantId),
                eq(externalReliabilityRecords.replayKey, candidate.replayKey),
              ),
            ).for("update")
            if (existingRow === undefined) return { _tag: "missing" }

            const existing = rowToRecord(existingRow)
            if (existing === undefined) return { _tag: "invalid" }
            const merged = merge(existing, candidate)
            if (merged === "conflict") return { _tag: "conflict" }
            if (merged.duplicate) {
              return { _tag: "result", record: merged.record, duplicate: true }
            }
            const [updated] = await transaction.update(externalReliabilityRecords).set(
              dbUpdate(merged.record),
            ).where(and(
              eq(externalReliabilityRecords.tenantId, candidate.tenantId),
              eq(externalReliabilityRecords.id, existingRow.id),
            )).returning()
            if (updated === undefined) return { _tag: "missing" }
            const record = rowToRecord(updated)
            return record === undefined
              ? { _tag: "invalid" }
              : { _tag: "result", record, duplicate: false }
          },
          "integration.reliability.record",
        )
        if (result._tag === "conflict") {
          return yield* Effect.fail(
            new ExternalIdempotencyConflict({
              tenantId: candidate.tenantId,
              idempotencyKey: candidate.replayKey,
            }),
          )
        }
        if (result._tag === "missing") {
          return yield* Effect.fail(
            new DatabaseFailure({
              operation: "integration.reliability.record",
              cause: "replay record disappeared during persistence",
            }),
          )
        }
        if (result._tag === "invalid") {
          return yield* Effect.fail(
            new DatabaseFailure({
              operation: "integration.reliability.record",
              cause: "persisted reliability record failed validation",
            }),
          )
        }
        return { record: result.record, duplicate: result.duplicate }
      }),
    get: (tenantId: string, replayKey: string) =>
      Effect.gen(function*() {
        yield* validateLookup(tenantId, replayKey, "integration.reliability.get")
        const rows = yield* database.query(
          (db) =>
            db.select().from(externalReliabilityRecords).where(and(
              eq(externalReliabilityRecords.tenantId, tenantId),
              eq(externalReliabilityRecords.replayKey, replayKey),
            )).limit(1),
          "integration.reliability.get",
        )
        const row = rows[0]
        if (row === undefined) return undefined
        const record = rowToRecord(row)
        return record === undefined
          ? yield* Effect.fail(
            new DatabaseFailure({
              operation: "integration.reliability.get",
              cause: "persisted reliability record failed validation",
            }),
          )
          : record
      }),
    health: (tenantId: string, connectorId: string, sampleLimit = 100) =>
      Effect.gen(function*() {
        yield* validateLookup(tenantId, connectorId, "integration.reliability.health")
        const limit = yield* validateSampleLimit(sampleLimit, connectorId)
        const rows = yield* database.query(
          (db) =>
            db.select().from(externalReliabilityRecords).where(and(
              eq(externalReliabilityRecords.tenantId, tenantId),
              eq(externalReliabilityRecords.connectorId, connectorId),
            )).orderBy(desc(externalReliabilityRecords.observedAt)).limit(limit),
          "integration.reliability.health",
        )
        const records: ExternalReliabilityRecord[] = []
        for (const row of rows) {
          const record = rowToRecord(row)
          if (record === undefined) {
            return yield* Effect.fail(
              new DatabaseFailure({
                operation: "integration.reliability.health",
                cause: "persisted reliability record failed validation",
              }),
            )
          }
          records.push(record)
        }
        return makeHealth(tenantId, connectorId, records)
      }),
  } satisfies ExternalReliabilityStore
})
