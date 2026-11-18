import * as Effect from "effect/Effect"

import { uuidv7 } from "../../../../framework/foundation/mod.ts"
import type { ImportBatch } from "./contract.ts"
import { ImportBatchNotFound, SourceIdentityAlreadyMapped } from "./errors.ts"
import type { OnboardingStore, RowCounts, SourceIdentity, StoredImportRow } from "./store.ts"

type MemoryRow = { -readonly [Key in keyof StoredImportRow]: StoredImportRow[Key] }

/**
 * A deterministic in-memory store for tests. It keeps the same uniqueness rules as the PostgreSQL
 * store, but it has no transactions: rollback of an owner command is proven only against PostgreSQL.
 */
export const makeOnboardingMemoryStore = (): OnboardingStore => {
  const batches = new Map<string, ImportBatch>()
  const rows = new Map<string, Array<MemoryRow>>()
  const identities = new Map<string, SourceIdentity & { readonly nativeKey: string }>()

  const fileKey = (
    batch: Pick<
      ImportBatch,
      "tenantId" | "sourceInstance" | "objectKind" | "fileChecksum" | "mappingRevision"
    >,
  ) =>
    JSON.stringify([
      batch.tenantId,
      batch.sourceInstance,
      batch.objectKind,
      batch.fileChecksum,
      batch.mappingRevision,
    ])

  const identityKey = (tenantId: string, sourceInstance: string, kind: string, sourceId: string) =>
    JSON.stringify([tenantId, sourceInstance, kind, sourceId])

  const rowsOf = (batchId: string) => rows.get(batchId) ?? []

  const countsOf = (batchId: string): RowCounts => ({
    pending: rowsOf(batchId).filter((row) => row.status === "pending").length,
    invalid: rowsOf(batchId).filter((row) => row.status === "invalid").length,
    applied: rowsOf(batchId).filter((row) => row.status === "applied").length,
  })

  const find = (tenantId: string, batchId: string) => {
    const batch = batches.get(batchId)

    return batch?.tenantId === tenantId ? batch : undefined
  }

  return {
    stageBatch: (batch, drafts) =>
      Effect.sync(() => {
        const existing = [...batches.values()].find(
          (candidate) => fileKey(candidate) === fileKey(batch),
        )

        if (existing !== undefined) return { batch: existing, created: false }

        const created: ImportBatch = {
          ...batch,
          id: uuidv7(),
          status: "staged",
          rowCount: drafts.length,
          rehearsal: null,
          rehearsedAt: null,
          appliedAt: null,
          createdAt: new Date().toISOString(),
        }

        batches.set(created.id, created)

        rows.set(
          created.id,
          drafts.map((draft) => ({
            rowNumber: draft.rowNumber,
            sourceId: draft.sourceId,
            contentHash: draft.contentHash,
            fields: draft.fields,
            status: draft.errors.length > 0 ? "invalid" : "pending",
            errors: draft.errors,
            nativeId: null,
          })),
        )

        return { batch: created, created: true }
      }),
    getBatch: (tenantId, batchId) => {
      const batch = find(tenantId, batchId)

      return batch === undefined
        ? Effect.fail(new ImportBatchNotFound({ tenantId, batchId }))
        : Effect.succeed(batch)
    },
    countRows: (_tenantId, batchId) => Effect.sync(() => countsOf(batchId)),
    listRows: (_tenantId, batchId, status, limit) =>
      Effect.sync(() =>
        rowsOf(batchId)
          .filter((row) => status === undefined || row.status === status)
          .slice(0, limit),
      ),
    findIdentities: (tenantId, sourceInstance, objectKind, sourceIds) =>
      Effect.sync(() =>
        sourceIds.flatMap((sourceId) => {
          const found = identities.get(identityKey(tenantId, sourceInstance, objectKind, sourceId))

          return found === undefined ? [] : [found]
        }),
      ),
    markRowsInvalid: (_tenantId, batchId, updates) =>
      Effect.sync(() => {
        for (const update of updates) {
          const row = rowsOf(batchId).find((candidate) => candidate.rowNumber === update.rowNumber)

          if (row?.status === "pending") {
            row.status = "invalid"
            row.errors = update.errors
          }
        }
      }),
    saveRehearsal: (tenantId, batchId, rehearsal) =>
      Effect.sync(() => {
        const batch = find(tenantId, batchId)

        if (batch === undefined) return

        batches.set(batchId, {
          ...batch,
          status: batch.status === "staged" ? "rehearsed" : batch.status,
          rehearsal,
          rehearsedAt: new Date().toISOString(),
        })
      }),
    recordApplied: (input) =>
      Effect.suspend(() => {
        const key = identityKey(
          input.batch.tenantId,
          input.batch.sourceInstance,
          input.batch.objectKind,
          input.sourceId,
        )

        const nativeKey = identityKey(
          input.batch.tenantId,
          input.batch.sourceInstance,
          input.batch.objectKind,
          input.nativeId,
        )

        if (
          input.newIdentity &&
          (identities.has(key) ||
            [...identities.values()].some((value) => value.nativeKey === nativeKey))
        ) {
          return Effect.fail(
            new SourceIdentityAlreadyMapped({
              tenantId: input.batch.tenantId,
              sourceId: input.sourceId,
            }),
          )
        }

        if (input.newIdentity) {
          identities.set(key, {
            sourceId: input.sourceId,
            nativeId: input.nativeId,
            contentHash: input.contentHash,
            nativeKey,
          })
        }

        const row = rowsOf(input.batch.id).find(
          (candidate) => candidate.rowNumber === input.rowNumber,
        )

        if (row?.status === "pending") {
          row.status = "applied"
          row.nativeId = input.nativeId
        }

        return Effect.void
      }),
    completeBatch: (tenantId, batchId) =>
      Effect.sync(() => {
        const batch = find(tenantId, batchId)
        const counts = countsOf(batchId)

        if (batch?.status === "rehearsed" && counts.pending === 0 && counts.invalid === 0) {
          batches.set(batchId, { ...batch, status: "applied", appliedAt: new Date().toISOString() })
        }
      }),
  }
}
