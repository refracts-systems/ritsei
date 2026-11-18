import type * as Effect from "effect/Effect"

import type { DatabaseFailure } from "../../../../framework/foundation/mod.ts"
import type {
  ImportBatch,
  ImportObjectKind,
  ImportRehearsal,
  ImportRowError,
  ImportRowStatus,
} from "./contract.ts"
import type { ImportBatchNotFound, SourceIdentityAlreadyMapped } from "./errors.ts"
import type { StagedRowDraft } from "./party-import.ts"

export interface NewImportBatch {
  readonly tenantId: string
  readonly sourceInstance: string
  readonly sourceVersion: string | null
  readonly objectKind: ImportObjectKind
  readonly fileChecksum: string
  readonly mappingRevision: string
  readonly uploadedBy: string
}

export interface StoredImportRow {
  readonly rowNumber: number
  readonly sourceId: string
  readonly contentHash: string
  /** The mapped fields of a valid row; the service decodes them for the owner command. */
  readonly fields: unknown
  readonly status: ImportRowStatus
  readonly errors: ReadonlyArray<ImportRowError>
  readonly nativeId: string | null
}

export interface RowCounts {
  readonly pending: number
  readonly invalid: number
  readonly applied: number
}

export interface SourceIdentity {
  readonly sourceId: string
  readonly nativeId: string
  readonly contentHash: string
}

/** Private persistence port of the onboarding module (batches, rows, and the source identity map). */
export interface OnboardingStore {
  /**
   * Stores a new batch and its rows, or returns the batch already staged for the same tenant,
   * source instance, object kind, file checksum, and mapping revision.
   */
  readonly stageBatch: (
    batch: NewImportBatch,
    rows: ReadonlyArray<StagedRowDraft>,
  ) => Effect.Effect<{ batch: ImportBatch; created: boolean }, DatabaseFailure>
  readonly getBatch: (
    tenantId: string,
    batchId: string,
  ) => Effect.Effect<ImportBatch, ImportBatchNotFound | DatabaseFailure>
  readonly countRows: (
    tenantId: string,
    batchId: string,
  ) => Effect.Effect<RowCounts, DatabaseFailure>
  /** Rows in row-number order. */
  readonly listRows: (
    tenantId: string,
    batchId: string,
    status: ImportRowStatus | undefined,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<StoredImportRow>, DatabaseFailure>
  readonly findIdentities: (
    tenantId: string,
    sourceInstance: string,
    objectKind: ImportObjectKind,
    sourceIds: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<SourceIdentity>, DatabaseFailure>
  /** Marks pending rows invalid with the given errors. Other rows are left as they are. */
  readonly markRowsInvalid: (
    tenantId: string,
    batchId: string,
    rows: ReadonlyArray<{
      readonly rowNumber: number
      readonly errors: ReadonlyArray<ImportRowError>
    }>,
  ) => Effect.Effect<void, DatabaseFailure>
  /** Saves the preview and moves a staged batch to rehearsed; an applied batch keeps its status. */
  readonly saveRehearsal: (
    tenantId: string,
    batchId: string,
    rehearsal: ImportRehearsal,
  ) => Effect.Effect<void, DatabaseFailure>
  /**
   * Marks a pending row applied to a native record and, for a new native record, adds its
   * identity-map entry. The service runs this in the owner command's transaction, so the map entry
   * commits or rolls back with the owner's write. The map's unique key is the duplicate guard.
   */
  readonly recordApplied: (input: {
    readonly batch: ImportBatch
    readonly rowNumber: number
    readonly sourceId: string
    readonly contentHash: string
    readonly nativeId: string
    readonly newIdentity: boolean
  }) => Effect.Effect<void, SourceIdentityAlreadyMapped | DatabaseFailure>
  /** Moves a rehearsed batch to applied when every row is applied. */
  readonly completeBatch: (
    tenantId: string,
    batchId: string,
  ) => Effect.Effect<void, DatabaseFailure>
}
