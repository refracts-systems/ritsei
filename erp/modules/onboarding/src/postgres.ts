import { and, asc, count, eq, gt, inArray, ne, notExists } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { importBatches, importRows, sourceIdentities } from "../../../../db/schema/onboarding.ts"
import { Database, isDatabaseConstraint } from "../../../../framework/foundation/mod.ts"
import { type ImportBatch, ImportRehearsal, ImportRowError } from "./contract.ts"
import { ImportBatchNotFound, SourceIdentityAlreadyMapped } from "./errors.ts"
import type { OnboardingStore, StoredImportRow } from "./store.ts"

const decodeErrors = Schema.decodeUnknownSync(Schema.Array(ImportRowError))
const decodeRehearsal = Schema.decodeUnknownSync(ImportRehearsal)

const toBatch = (row: typeof importBatches.$inferSelect): ImportBatch => ({
  id: row.id,
  tenantId: row.tenantId,
  sourceInstance: row.sourceInstance,
  sourceVersion: row.sourceVersion,
  objectKind: row.objectKind,
  fileChecksum: row.fileChecksum,
  mappingRevision: row.mappingRevision,
  uploadedBy: row.uploadedBy,
  status: row.status,
  rowCount: row.rowCount,
  rehearsal: row.rehearsal === null ? null : decodeRehearsal(row.rehearsal),
  rehearsedAt: row.rehearsedAt?.toISOString() ?? null,
  appliedAt: row.appliedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})

const toRow = (row: typeof importRows.$inferSelect): StoredImportRow => ({
  rowNumber: row.rowNumber,
  sourceId: row.sourceId,
  contentHash: row.contentHash,
  fields: row.fields,
  status: row.status,
  errors: decodeErrors(row.errors),
  nativeId: row.nativeId,
})

export const makeOnboardingPostgresStore = Effect.fn("Onboarding.makePostgresStore")(function* () {
  const database = yield* Database

  return {
    stageBatch: (batch, rows) =>
      database
        .transaction(async (tx) => {
          const inserted = await tx
            .insert(importBatches)
            .values({ ...batch, rowCount: rows.length })
            .onConflictDoNothing({
              target: [
                importBatches.tenantId,
                importBatches.sourceInstance,
                importBatches.objectKind,
                importBatches.fileChecksum,
                importBatches.mappingRevision,
              ],
            })
            .returning()

          if (inserted[0] !== undefined) {
            await tx.insert(importRows).values(
              rows.map((row) => ({
                tenantId: batch.tenantId,
                batchId: inserted[0]!.id,
                rowNumber: row.rowNumber,
                sourceId: row.sourceId,
                contentHash: row.contentHash,
                fields: row.fields,
                status: row.errors.length > 0 ? ("invalid" as const) : ("pending" as const),
                errors: row.errors,
              })),
            )

            return { row: inserted[0], created: true }
          }

          const existing = await tx
            .select()
            .from(importBatches)
            .where(
              and(
                eq(importBatches.tenantId, batch.tenantId),
                eq(importBatches.sourceInstance, batch.sourceInstance),
                eq(importBatches.objectKind, batch.objectKind),
                eq(importBatches.fileChecksum, batch.fileChecksum),
                eq(importBatches.mappingRevision, batch.mappingRevision),
              ),
            )

          return { row: existing[0]!, created: false }
        }, "onboarding.import_batch.stage")
        .pipe(Effect.map(({ row, created }) => ({ batch: toBatch(row), created }))),
    getBatch: (tenantId, batchId) =>
      database
        .query(
          (db) =>
            db
              .select()
              .from(importBatches)
              .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, batchId))),
          "onboarding.import_batch.get",
        )
        .pipe(
          Effect.flatMap((rows) =>
            rows[0] === undefined
              ? Effect.fail(new ImportBatchNotFound({ tenantId, batchId }))
              : Effect.succeed(toBatch(rows[0])),
          ),
        ),
    countRows: (tenantId, batchId) =>
      database
        .query(
          (db) =>
            db
              .select({ status: importRows.status, total: count() })
              .from(importRows)
              .where(and(eq(importRows.tenantId, tenantId), eq(importRows.batchId, batchId)))
              .groupBy(importRows.status),
          "onboarding.import_row.count",
        )
        .pipe(
          Effect.map((rows) => {
            const total = (status: "pending" | "invalid" | "applied") =>
              rows.find((row) => row.status === status)?.total ?? 0

            return {
              pending: total("pending"),
              invalid: total("invalid"),
              applied: total("applied"),
            }
          }),
        ),
    listRows: (tenantId, batchId, status, afterRowNumber, limit) =>
      database
        .query(
          (db) =>
            db
              .select()
              .from(importRows)
              .where(
                and(
                  eq(importRows.tenantId, tenantId),
                  eq(importRows.batchId, batchId),
                  gt(importRows.rowNumber, afterRowNumber),
                  status === undefined ? undefined : eq(importRows.status, status),
                ),
              )
              .orderBy(asc(importRows.rowNumber))
              .limit(limit),
          "onboarding.import_row.list",
        )
        .pipe(Effect.map((rows) => rows.map(toRow))),
    findIdentities: (tenantId, sourceInstance, objectKind, sourceIds) =>
      sourceIds.length === 0
        ? Effect.succeed([])
        : database.query(
            (db) =>
              db
                .select({
                  sourceId: sourceIdentities.sourceId,
                  nativeId: sourceIdentities.nativeId,
                  contentHash: sourceIdentities.contentHash,
                })
                .from(sourceIdentities)
                .where(
                  and(
                    eq(sourceIdentities.tenantId, tenantId),
                    eq(sourceIdentities.sourceInstance, sourceInstance),
                    eq(sourceIdentities.objectKind, objectKind),
                    inArray(sourceIdentities.sourceId, [...sourceIds]),
                  ),
                ),
            "onboarding.source_identity.find",
          ),
    markRowsInvalid: (tenantId, batchId, rows) =>
      database.transaction(async (tx) => {
        for (const row of rows) {
          await tx
            .update(importRows)
            .set({ status: "invalid", errors: row.errors })
            .where(
              and(
                eq(importRows.tenantId, tenantId),
                eq(importRows.batchId, batchId),
                eq(importRows.rowNumber, row.rowNumber),
                eq(importRows.status, "pending"),
              ),
            )
        }
      }, "onboarding.import_row.mark_invalid"),
    saveRehearsal: (tenantId, batchId, rehearsal) =>
      database.transaction(async (tx) => {
        const now = new Date()
        const batch = and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, batchId))

        await tx
          .update(importBatches)
          .set({ status: "rehearsed", rehearsal, rehearsedAt: now, updatedAt: now })
          .where(and(batch, eq(importBatches.status, "staged")))

        await tx
          .update(importBatches)
          .set({ rehearsal, rehearsedAt: now, updatedAt: now })
          .where(and(batch, ne(importBatches.status, "staged")))
      }, "onboarding.import_batch.rehearse"),
    recordApplied: (input) =>
      database
        .transaction(async (tx) => {
          if (input.newIdentity) {
            await tx.insert(sourceIdentities).values({
              tenantId: input.batch.tenantId,
              sourceInstance: input.batch.sourceInstance,
              objectKind: input.batch.objectKind,
              sourceId: input.sourceId,
              nativeId: input.nativeId,
              contentHash: input.contentHash,
              batchId: input.batch.id,
            })
          }

          await tx
            .update(importRows)
            .set({ status: "applied", nativeId: input.nativeId, appliedAt: new Date() })
            .where(
              and(
                eq(importRows.tenantId, input.batch.tenantId),
                eq(importRows.batchId, input.batch.id),
                eq(importRows.rowNumber, input.rowNumber),
                eq(importRows.status, "pending"),
              ),
            )
        }, "onboarding.source_identity.record")
        .pipe(
          Effect.mapError((error) =>
            isDatabaseConstraint(error, "source_identities_source_key") ||
            isDatabaseConstraint(error, "source_identities_native_key")
              ? new SourceIdentityAlreadyMapped({
                  tenantId: input.batch.tenantId,
                  sourceId: input.sourceId,
                })
              : error,
          ),
        ),
    completeBatch: (tenantId, batchId) =>
      database
        .query(
          (db) =>
            db
              .update(importBatches)
              .set({ status: "applied", appliedAt: new Date(), updatedAt: new Date() })
              .where(
                and(
                  eq(importBatches.tenantId, tenantId),
                  eq(importBatches.id, batchId),
                  eq(importBatches.status, "rehearsed"),
                  notExists(
                    db
                      .select()
                      .from(importRows)
                      .where(
                        and(eq(importRows.batchId, batchId), ne(importRows.status, "applied")),
                      ),
                  ),
                ),
              ),
          "onboarding.import_batch.complete",
        )
        .pipe(Effect.asVoid),
  } satisfies OnboardingStore
})
