import { and, desc, eq } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Data from "effect/Data"

import { financialStagingEvidence } from "../../../../db/schema/accounting.ts"
import { Database, DatabaseFailure } from "../../../../framework/foundation/mod.ts"
import { FinancialStagingEvidenceRecord } from "./contract.ts"
import { FinancialStagingEvidenceConflict, FinancialStagingEvidenceInvalid } from "./errors.ts"
import {
  FINANCIAL_STAGING_EVIDENCE_CANONICALIZATION_VERSION,
  FinancialStagingEvidence as KernelFinancialStagingEvidence,
  hashFinancialStagingEvidence,
} from "./financial-store-contract.ts"

const Uuid = Schema.String.check(Schema.isUUID())

const Uuidv7 = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
)

const Hash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))
const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const LookupLimit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 }))

type FinancialStagingEvidenceRecordType = Schema.Schema.Type<typeof FinancialStagingEvidenceRecord>

const StoreAppendFinancialStagingEvidenceInput = Schema.Struct({
  tenantId: Uuid,
  evidence: KernelFinancialStagingEvidence,
  canonicalizationVersion: Schema.Literal(FINANCIAL_STAGING_EVIDENCE_CANONICALIZATION_VERSION),
  evidenceHash: Hash,
})

const StoreFinancialStagingEvidenceLookupInput = Schema.Struct({
  tenantId: Uuid,
  legalEntityId: Schema.optionalKey(Uuid),
  gateId: Schema.optionalKey(NonEmptyString),
  cohortId: Schema.optionalKey(NonEmptyString),
  deploymentRevision: Schema.optionalKey(NonEmptyString),
  limit: LookupLimit,
}).check(
  Schema.makeFilter(
    (input) =>
      input.gateId !== undefined ||
      input.cohortId !== undefined ||
      input.deploymentRevision !== undefined,
    { expected: "staging evidence lookup requires gate, cohort, or deployment scope" },
  ),
)

export type FinancialStagingEvidenceAppendResult = Readonly<{
  readonly record: FinancialStagingEvidenceRecordType
  readonly duplicate: boolean
}>

type FinancialStagingEvidenceStoreError =
  | DatabaseFailure
  | FinancialStagingEvidenceConflict
  | FinancialStagingEvidenceInvalid
  | Schema.SchemaError

type FinancialStagingEvidenceListError =
  | DatabaseFailure
  | FinancialStagingEvidenceInvalid
  | Schema.SchemaError

/**
 * Provider port for append-only staging evidence. It has no update/delete operation by design.
 * PostgreSQL is a local durable adapter; production must supply an approved immutable/WORM adapter.
 */
export interface FinancialStagingEvidenceStoreService {
  readonly append: (
    input: Schema.Codec.Encoded<typeof StoreAppendFinancialStagingEvidenceInput>,
  ) => Effect.Effect<FinancialStagingEvidenceAppendResult, FinancialStagingEvidenceStoreError>
  readonly get: (
    tenantId: string,
    recordId: string,
  ) => Effect.Effect<
    FinancialStagingEvidenceRecordType | undefined,
    FinancialStagingEvidenceInvalid | DatabaseFailure
  >
  readonly list: (
    input: Schema.Codec.Encoded<typeof StoreFinancialStagingEvidenceLookupInput>,
  ) => Effect.Effect<
    readonly FinancialStagingEvidenceRecordType[],
    FinancialStagingEvidenceListError
  >
}

export const FinancialStagingEvidenceStore = Context.Service<FinancialStagingEvidenceStoreService>(
  "RITSEI/FinancialStagingEvidenceStore",
)

const invalid = (
  tenantId: string,
  recordId: string,
  reason: ConstructorParameters<typeof FinancialStagingEvidenceInvalid>[0]["reason"],
) => new FinancialStagingEvidenceInvalid({ tenantId, recordId, reason })

const prepare = (input: Schema.Codec.Encoded<typeof StoreAppendFinancialStagingEvidenceInput>) =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(StoreAppendFinancialStagingEvidenceInput)(
      input,
    )

    if (
      decoded.evidence.tenantId !== decoded.tenantId ||
      decoded.evidence.legalEntityId !== decoded.evidence.cohort.legalEntityId ||
      decoded.evidence.tenantId !== decoded.evidence.cohort.tenantId
    ) {
      return yield* Effect.fail(
        invalid(decoded.tenantId, decoded.evidence.recordId, "scope_mismatch"),
      )
    }

    const computedHash = yield* hashFinancialStagingEvidence(decoded.evidence)

    if (computedHash !== decoded.evidenceHash) {
      return yield* Effect.fail(
        invalid(decoded.tenantId, decoded.evidence.recordId, "hash_mismatch"),
      )
    }

    return yield* Schema.decodeUnknownEffect(FinancialStagingEvidenceRecord)({
      recordId: decoded.evidence.recordId,
      tenantId: decoded.tenantId,
      legalEntityId: decoded.evidence.legalEntityId,
      gateId: decoded.evidence.gateId,
      cohortId: decoded.evidence.cohort.cohortId,
      deploymentRevision: decoded.evidence.deploymentRevision,
      schemaVersion: decoded.evidence.schemaVersion,
      canonicalizationVersion: decoded.canonicalizationVersion,
      evidenceHash: decoded.evidenceHash,
      evidence: decoded.evidence,
      persistedAt: new Date().toISOString(),
    })
  })

/** Recomputes and verifies persisted evidence before any caller receives it. */
export const verifyFinancialStagingEvidenceRecord = (
  record: FinancialStagingEvidenceRecordType,
): Effect.Effect<FinancialStagingEvidenceRecordType, FinancialStagingEvidenceInvalid> =>
  Effect.gen(function* () {
    if (record.canonicalizationVersion !== FINANCIAL_STAGING_EVIDENCE_CANONICALIZATION_VERSION) {
      return yield* Effect.fail(
        invalid(record.tenantId, record.recordId, "canonicalization_version"),
      )
    }

    if (
      ![
        record.recordId === record.evidence.recordId,
        record.tenantId === record.evidence.tenantId,
        record.legalEntityId === record.evidence.legalEntityId,
        record.gateId === record.evidence.gateId,
        record.cohortId === record.evidence.cohort.cohortId,
        record.deploymentRevision === record.evidence.deploymentRevision,
        record.schemaVersion === record.evidence.schemaVersion,
      ].every(Boolean)
    ) {
      return yield* Effect.fail(invalid(record.tenantId, record.recordId, "scope_mismatch"))
    }

    const computedHash = yield* hashFinancialStagingEvidence(record.evidence)

    if (computedHash !== record.evidenceHash) {
      return yield* Effect.fail(invalid(record.tenantId, record.recordId, "hash_mismatch"))
    }

    return record
  })

const sameEvidence = (
  left: FinancialStagingEvidenceRecordType,
  right: FinancialStagingEvidenceRecordType,
) =>
  left.canonicalizationVersion === right.canonicalizationVersion &&
  left.evidenceHash === right.evidenceHash &&
  left.recordId === right.recordId &&
  left.tenantId === right.tenantId &&
  left.legalEntityId === right.legalEntityId &&
  left.gateId === right.gateId &&
  left.cohortId === right.cohortId &&
  left.deploymentRevision === right.deploymentRevision

const validateGet = (tenantId: string, recordId: string) =>
  Schema.is(Uuid)(tenantId) && Schema.is(Uuidv7)(recordId)
    ? Effect.succeed(undefined)
    : Effect.fail(invalid(tenantId, recordId, "scope_mismatch"))

const validateStoredRow = (row: {
  readonly recordId: string
  readonly tenantId: string
  readonly legalEntityId: string
  readonly gateId: string
  readonly cohortId: string
  readonly deploymentRevision: string
  readonly schemaVersion: number
  readonly canonicalizationVersion: number
  readonly evidenceHash: string
  readonly evidence: unknown
  readonly operatorPrincipalId: string
  readonly providerIdentityRef: string
  readonly result: string
  readonly mismatchCount: number
  readonly orphanCount: number
  readonly startedAt: Date
  readonly completedAt: Date
  readonly createdAt: Date
}) =>
  Effect.gen(function* () {
    const record = yield* Schema.decodeUnknownEffect(FinancialStagingEvidenceRecord)({
      recordId: row.recordId,
      tenantId: row.tenantId,
      legalEntityId: row.legalEntityId,
      gateId: row.gateId,
      cohortId: row.cohortId,
      deploymentRevision: row.deploymentRevision,
      schemaVersion: row.schemaVersion,
      canonicalizationVersion: row.canonicalizationVersion,
      evidenceHash: row.evidenceHash,
      evidence: row.evidence,
      persistedAt: row.createdAt.toISOString(),
    }).pipe(Effect.mapError(() => invalid(row.tenantId, row.recordId, "stored_payload_invalid")))

    if (
      ![
        row.operatorPrincipalId === record.evidence.operatorPrincipalId,
        row.providerIdentityRef === record.evidence.providerIdentityRef,
        row.result === record.evidence.result,
        row.mismatchCount === record.evidence.mismatchCount,
        row.orphanCount === record.evidence.orphanCount,
        row.startedAt.toISOString() === record.evidence.startedAt,
        row.completedAt.toISOString() === record.evidence.completedAt,
      ].every(Boolean)
    ) {
      return yield* Effect.fail(invalid(row.tenantId, row.recordId, "stored_payload_invalid"))
    }

    return yield* verifyFinancialStagingEvidenceRecord(record)
  })

const dbValues = (record: FinancialStagingEvidenceRecordType) => ({
  recordId: record.recordId,
  tenantId: record.tenantId,
  legalEntityId: record.legalEntityId,
  gateId: record.gateId,
  cohortId: record.cohortId,
  deploymentRevision: record.deploymentRevision,
  schemaVersion: record.schemaVersion,
  canonicalizationVersion: record.canonicalizationVersion,
  evidenceHash: record.evidenceHash,
  evidence: record.evidence,
  operatorPrincipalId: record.evidence.operatorPrincipalId,
  providerIdentityRef: record.evidence.providerIdentityRef,
  result: record.evidence.result,
  mismatchCount: record.evidence.mismatchCount,
  orphanCount: record.evidence.orphanCount,
  startedAt: new Date(record.evidence.startedAt),
  completedAt: new Date(record.evidence.completedAt),
})

const key = (tenantId: string, recordId: string) => `${tenantId}:${recordId}`

export const makeMemoryFinancialStagingEvidenceStore = (): FinancialStagingEvidenceStoreService => {
  const records = new Map<string, FinancialStagingEvidenceRecordType>()

  return {
    append: (input) =>
      Effect.gen(function* () {
        const candidate = yield* prepare(input)
        const existing = records.get(key(candidate.tenantId, candidate.recordId))

        if (existing === undefined) {
          records.set(key(candidate.tenantId, candidate.recordId), candidate)

          return { record: candidate, duplicate: false }
        }

        if (!sameEvidence(existing, candidate)) {
          return yield* Effect.fail(
            new FinancialStagingEvidenceConflict({
              tenantId: candidate.tenantId,
              recordId: candidate.recordId,
              reason: "different_content",
            }),
          )
        }

        return { record: yield* verifyFinancialStagingEvidenceRecord(existing), duplicate: true }
      }),
    get: (tenantId, recordId) =>
      Effect.gen(function* () {
        yield* validateGet(tenantId, recordId)
        const record = records.get(key(tenantId, recordId))

        return record === undefined
          ? undefined
          : yield* verifyFinancialStagingEvidenceRecord(record)
      }),
    list: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(StoreFinancialStagingEvidenceLookupInput)(
          input,
        )

        const values = [...records.values()]
          .filter(
            (record) =>
              record.tenantId === decoded.tenantId &&
              (decoded.legalEntityId === undefined ||
                record.legalEntityId === decoded.legalEntityId) &&
              (decoded.gateId === undefined || record.gateId === decoded.gateId) &&
              (decoded.cohortId === undefined || record.cohortId === decoded.cohortId) &&
              (decoded.deploymentRevision === undefined ||
                record.deploymentRevision === decoded.deploymentRevision),
          )
          .toSorted(
            (left, right) =>
              right.persistedAt.localeCompare(left.persistedAt) ||
              right.recordId.localeCompare(left.recordId),
          )
          .slice(0, decoded.limit)

        return yield* Effect.forEach(values, verifyFinancialStagingEvidenceRecord)
      }),
  }
}

export type AppendOutcome = Data.TaggedEnum<{
  Inserted: {
    readonly row: {
      tenantId: string
      recordId: string
      legalEntityId: string
      gateId: string
      cohortId: string
      deploymentRevision: string
      schemaVersion: number
      canonicalizationVersion: number
      evidenceHash: string
      evidence: unknown
      operatorPrincipalId: string
      providerIdentityRef: string
      result: string
      mismatchCount: number
      orphanCount: number
      startedAt: Date
      completedAt: Date
      createdAt: Date
    }
  }
  Missing: {}
  Existing: {
    readonly row: {
      recordId: string
      tenantId: string
      legalEntityId: string
      gateId: string
      cohortId: string
      deploymentRevision: string
      schemaVersion: number
      canonicalizationVersion: number
      evidenceHash: string
      evidence: unknown
      operatorPrincipalId: string
      providerIdentityRef: string
      result: string
      mismatchCount: number
      orphanCount: number
      startedAt: Date
      completedAt: Date
      createdAt: Date
    }
  }
}>

export const AppendOutcome = Data.taggedEnum<AppendOutcome>()

export const makePostgresFinancialStagingEvidenceStore = Effect.gen(function* () {
  const database = yield* Database

  return {
    append: (input: Schema.Codec.Encoded<typeof StoreAppendFinancialStagingEvidenceInput>) =>
      Effect.gen(function* () {
        const candidate = yield* prepare(input)

        const result = yield* database.transaction(async (transaction) => {
          const [inserted] = await transaction
            .insert(financialStagingEvidence)
            .values(dbValues(candidate))
            .onConflictDoNothing()
            .returning()

          if (inserted !== undefined) return AppendOutcome.Inserted({ row: inserted })

          const [existing] = await transaction
            .select()
            .from(financialStagingEvidence)
            .where(
              and(
                eq(financialStagingEvidence.tenantId, candidate.tenantId),
                eq(financialStagingEvidence.recordId, candidate.recordId),
              ),
            )
            .for("update")

          return existing === undefined
            ? AppendOutcome.Missing()
            : AppendOutcome.Existing({ row: existing })
        }, "accounting.financial_staging_evidence.append")

        if (AppendOutcome.$is("Missing")(result)) {
          return yield* Effect.fail(
            new DatabaseFailure({
              operation: "accounting.financial_staging_evidence.append",
              cause: "evidence row disappeared during append",
            }),
          )
        }

        const record = yield* validateStoredRow(result.row)

        if (AppendOutcome.$is("Inserted")(result)) return { record, duplicate: false }

        if (!sameEvidence(record, candidate)) {
          return yield* Effect.fail(
            new FinancialStagingEvidenceConflict({
              tenantId: candidate.tenantId,
              recordId: candidate.recordId,
              reason: "different_content",
            }),
          )
        }

        return { record, duplicate: true }
      }),
    get: (tenantId: string, recordId: string) =>
      Effect.gen(function* () {
        yield* validateGet(tenantId, recordId)

        const rows = yield* database.query(
          (db) =>
            db
              .select()
              .from(financialStagingEvidence)
              .where(
                and(
                  eq(financialStagingEvidence.tenantId, tenantId),
                  eq(financialStagingEvidence.recordId, recordId),
                ),
              )
              .limit(1),
          "accounting.financial_staging_evidence.get",
        )

        const row = rows[0]

        return row === undefined ? undefined : yield* validateStoredRow(row)
      }),
    list: (input: Schema.Codec.Encoded<typeof StoreFinancialStagingEvidenceLookupInput>) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(StoreFinancialStagingEvidenceLookupInput)(
          input,
        )

        const conditions = [eq(financialStagingEvidence.tenantId, decoded.tenantId)]

        if (decoded.legalEntityId !== undefined) {
          conditions.push(eq(financialStagingEvidence.legalEntityId, decoded.legalEntityId))
        }

        if (decoded.gateId !== undefined) {
          conditions.push(eq(financialStagingEvidence.gateId, decoded.gateId))
        }

        if (decoded.cohortId !== undefined) {
          conditions.push(eq(financialStagingEvidence.cohortId, decoded.cohortId))
        }

        if (decoded.deploymentRevision !== undefined) {
          conditions.push(
            eq(financialStagingEvidence.deploymentRevision, decoded.deploymentRevision),
          )
        }

        const rows = yield* database.query(
          (db) =>
            db
              .select()
              .from(financialStagingEvidence)
              .where(and(...conditions))
              .orderBy(
                desc(financialStagingEvidence.createdAt),
                desc(financialStagingEvidence.recordId),
              )
              .limit(decoded.limit),
          "accounting.financial_staging_evidence.list",
        )

        return yield* Effect.forEach(rows, validateStoredRow)
      }),
  } satisfies FinancialStagingEvidenceStoreService
})

export const FinancialStagingEvidencePostgresLive = Layer.effect(
  FinancialStagingEvidenceStore,
  makePostgresFinancialStagingEvidenceStore,
)
