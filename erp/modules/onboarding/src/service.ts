import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

import { Database } from "../../../../framework/foundation/mod.ts"
import {
  AuthorizationService,
  scopedCommand,
} from "../../../../framework/modules/authorization/mod.ts"
import { PartyService } from "../../party/mod.ts"
import { OnboardingCapabilities } from "./capabilities.ts"
import {
  ApplyImportInput,
  type ApplyImportResult,
  GetImportBatchInput,
  type ImportBatch,
  type ImportBatchSummary,
  type ImportRehearsal,
  type ImportRow,
  type ImportRowStatus,
  type ImportRowError,
  ListImportRowsInput,
  MaxImportRows,
  OnboardingService,
  RehearseImportInput,
  StageImportInput,
} from "./contract.ts"
import { sha256Hex } from "./csv.ts"
import {
  ImportBatchHasBlockingErrors,
  ImportBatchNotRehearsed,
  SourceIdentityAlreadyMapped,
  SourceRecordMappedConcurrently,
  UnsupportedMappingRevision,
} from "./errors.ts"
import {
  applyPartyRow,
  PartyMappingRevision,
  PartyRowFields,
  readPartyFile,
} from "./party-import.ts"
import type { OnboardingStore, StoredImportRow } from "./store.ts"

const sourceRecordChanged: ImportRowError = {
  field: null,
  code: "source_record_changed",
  message:
    "The source record was imported before with different content. Updates are not applied by this import.",
}

const toImportRow = (row: StoredImportRow): ImportRow => ({
  rowNumber: row.rowNumber,
  // Older staged batches may still contain an invalid row's source id.
  sourceId: row.status === "invalid" ? "" : row.sourceId,
  status: row.status,
  errors: row.errors,
  nativeId: row.nativeId,
})

export const makeOnboardingServiceFromStore = <R>(
  store: Effect.Effect<OnboardingStore, never, R>,
) =>
  Effect.gen(function* () {
    const onboardingStore = yield* store
    const authorization = yield* AuthorizationService
    const party = yield* PartyService
    const databaseOption = yield* Effect.serviceOption(Database)
    const authorized = scopedCommand(authorization)

    /** Every row of a batch in one status; a batch holds at most `MaxImportRows`. */
    const allRows = (tenantId: string, batchId: string, status: ImportRowStatus) =>
      onboardingStore.listRows(tenantId, batchId, status, 0, MaxImportRows)

    const summarize = Effect.fn("OnboardingService.summarize")(function* (batch: ImportBatch) {
      const counts = yield* onboardingStore.countRows(batch.tenantId, batch.id)

      return { batch, ...counts } satisfies ImportBatchSummary
    })

    const stage = Effect.fn("OnboardingService.stage")(function* (
      input: Schema.Codec.Encoded<typeof StageImportInput>,
    ) {
      const decoded = yield* authorized(StageImportInput, OnboardingCapabilities.importStage)(input)

      if (decoded.mappingRevision !== PartyMappingRevision) {
        return yield* Effect.fail(
          new UnsupportedMappingRevision({
            tenantId: decoded.tenantId,
            objectKind: decoded.objectKind,
            mappingRevision: decoded.mappingRevision,
          }),
        )
      }

      const drafts = yield* readPartyFile(decoded.tenantId, decoded.csv)
      const fileChecksum = yield* sha256Hex(decoded.csv)

      const { batch, created } = yield* onboardingStore.stageBatch(
        {
          tenantId: decoded.tenantId,
          sourceInstance: decoded.sourceInstance,
          sourceVersion: decoded.sourceVersion ?? null,
          objectKind: decoded.objectKind,
          fileChecksum,
          mappingRevision: decoded.mappingRevision,
          uploadedBy: decoded.principal.userAccountId,
        },
        drafts,
      )

      return { alreadyStaged: !created, summary: yield* summarize(batch) }
    })

    const getBatch = Effect.fn("OnboardingService.getBatch")(function* (
      input: Schema.Codec.Encoded<typeof GetImportBatchInput>,
    ) {
      const decoded = yield* authorized(
        GetImportBatchInput,
        OnboardingCapabilities.importRead,
      )(input)

      return yield* summarize(yield* onboardingStore.getBatch(decoded.tenantId, decoded.batchId))
    })

    const listRows = Effect.fn("OnboardingService.listRows")(function* (
      input: Schema.Codec.Encoded<typeof ListImportRowsInput>,
    ) {
      const decoded = yield* authorized(
        ListImportRowsInput,
        OnboardingCapabilities.importRead,
      )(input)

      yield* onboardingStore.getBatch(decoded.tenantId, decoded.batchId)

      const rows = yield* onboardingStore.listRows(
        decoded.tenantId,
        decoded.batchId,
        decoded.status,
        decoded.afterRowNumber ?? 0,
        decoded.limit ?? 200,
      )

      return rows.map(toImportRow)
    })

    const rehearse = Effect.fn("OnboardingService.rehearse")(function* (
      input: Schema.Codec.Encoded<typeof RehearseImportInput>,
    ) {
      const decoded = yield* authorized(
        RehearseImportInput,
        OnboardingCapabilities.importRehearse,
      )(input)

      const { tenantId, batchId } = decoded
      const batch = yield* onboardingStore.getBatch(tenantId, batchId)
      const startedAt = yield* Clock.currentTimeMillis

      const pending = yield* allRows(tenantId, batchId, "pending")

      const identities = yield* onboardingStore.findIdentities(
        tenantId,
        batch.sourceInstance,
        batch.objectKind,
        pending.map((row) => row.sourceId),
      )

      const mapped = new Map(identities.map((identity) => [identity.sourceId, identity]))

      const known = pending.filter((row) => mapped.has(row.sourceId))

      const changed = known.filter(
        (row) => mapped.get(row.sourceId)?.contentHash !== row.contentHash,
      )

      // Only the rehearsal's own bookkeeping is written: no owner command runs and no event is published.
      yield* onboardingStore.markRowsInvalid(
        tenantId,
        batchId,
        changed.map((row) => ({ rowNumber: row.rowNumber, errors: [sourceRecordChanged] })),
      )

      const counts = yield* onboardingStore.countRows(tenantId, batchId)
      const invalid = yield* allRows(tenantId, batchId, "invalid")

      const tally = new Map<ImportRowError["code"], number>()

      for (const error of invalid.flatMap((row) => row.errors)) {
        tally.set(error.code, (tally.get(error.code) ?? 0) + 1)
      }

      const finishedAt = yield* Clock.currentTimeMillis

      const rehearsal: ImportRehearsal = {
        rows: batch.rowCount,
        accepted: pending.length - known.length,
        alreadyMapped: known.length - changed.length,
        alreadyApplied: counts.applied,
        blocking: counts.invalid,
        errors: [...tally]
          .map(([code, count]) => ({ code, count }))
          .toSorted((left, right) => left.code.localeCompare(right.code)),
        durationMs: finishedAt - startedAt,
      }

      yield* onboardingStore.saveRehearsal(tenantId, batchId, rehearsal)

      return yield* summarize(yield* onboardingStore.getBatch(tenantId, batchId))
    })

    const apply = Effect.fn("OnboardingService.apply")(function* (
      input: Schema.Codec.Encoded<typeof ApplyImportInput>,
    ) {
      const decoded = yield* authorized(ApplyImportInput, OnboardingCapabilities.importApply)(input)
      const { principal, tenantId, batchId } = decoded
      const batch = yield* onboardingStore.getBatch(tenantId, batchId)

      if (batch.status === "staged") {
        return yield* Effect.fail(new ImportBatchNotRehearsed({ tenantId, batchId }))
      }

      const counts = yield* onboardingStore.countRows(tenantId, batchId)

      if (counts.invalid > 0) {
        return yield* Effect.fail(
          new ImportBatchHasBlockingErrors({ tenantId, batchId, invalidRows: counts.invalid }),
        )
      }

      const pending = yield* allRows(tenantId, batchId, "pending")

      /**
       * One record, one transaction: the owner command, the identity-map entry, and the row's
       * checkpoint commit together or not at all, so no crash can leave a created record that the
       * map does not know. The map's unique key rejects a concurrent second creation.
       */
      const applyOnce = (row: StoredImportRow) =>
        Effect.gen(function* () {
          const [existing] = yield* onboardingStore.findIdentities(
            tenantId,
            batch.sourceInstance,
            batch.objectKind,
            [row.sourceId],
          )

          const record = {
            batch,
            rowNumber: row.rowNumber,
            sourceId: row.sourceId,
            contentHash: row.contentHash,
          }

          if (existing === undefined) {
            const fields = yield* Schema.decodeUnknownEffect(PartyRowFields)(row.fields)
            const nativeId = yield* applyPartyRow(party, principal, tenantId, fields)
            yield* onboardingStore.recordApplied({ ...record, nativeId, newIdentity: true })

            return "created" as const
          }

          if (existing.contentHash !== row.contentHash) {
            yield* onboardingStore.markRowsInvalid(tenantId, batchId, [
              { rowNumber: row.rowNumber, errors: [sourceRecordChanged] },
            ])

            return "changed" as const
          }

          yield* onboardingStore.recordApplied({
            ...record,
            nativeId: existing.nativeId,
            newIdentity: false,
          })

          return "linked" as const
        })

      const inTransaction = (row: StoredImportRow) =>
        Option.isSome(databaseOption)
          ? databaseOption.value.withTransaction(applyOnce(row), "onboarding.import_row.apply")
          : applyOnce(row)

      // A concurrent import may map the source record first. The rolled-back attempt is rerun once,
      // and the rerun links to the record that won.
      const applyRow = (row: StoredImportRow) =>
        inTransaction(row).pipe(
          Effect.retry({
            times: 1,
            while: (error) => error instanceof SourceIdentityAlreadyMapped,
          }),
          Effect.catchTag("SourceIdentityAlreadyMapped", () =>
            Effect.fail(
              new SourceRecordMappedConcurrently({ tenantId, batchId, rowNumber: row.rowNumber }),
            ),
          ),
        )

      const tally = { created: 0, linked: 0, changed: 0 }

      for (const row of pending) tally[yield* applyRow(row)]++

      yield* onboardingStore.completeBatch(tenantId, batchId)

      return {
        summary: yield* summarize(yield* onboardingStore.getBatch(tenantId, batchId)),
        ...tally,
      } satisfies ApplyImportResult
    })

    return { stage, getBatch, listRows, rehearse, apply } satisfies OnboardingService
  })
