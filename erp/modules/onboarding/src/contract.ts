import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import type { DatabaseFailure } from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import type { EventIdempotencyConflict } from "../../../../framework/modules/messaging/mod.ts"
import type { PartyNotFound, PartyRoleAlreadyAssigned } from "../../party/mod.ts"
import type {
  ImportBatchHasBlockingErrors,
  ImportBatchNotFound,
  ImportBatchNotRehearsed,
  ImportFileInvalid,
  SourceRecordMappedConcurrently,
  UnsupportedMappingRevision,
} from "./errors.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const TrimmedNonBlankString = Schema.String.check(Schema.isPattern(/\S/), Schema.isTrimmed())

/** The most characters a staged file may hold; the API request body limit is the tighter bound. */
export const MaxCsvCharacters = 1_000_000

/** The most records one batch may hold, so one apply call stays bounded. */
export const MaxImportRows = 2_000

export const ImportObjectKind = Schema.Literals(["party"])
export const ImportBatchStatus = Schema.Literals(["staged", "rehearsed", "applied"])
export const ImportRowStatus = Schema.Literals(["pending", "invalid", "applied"])

export const ImportRowErrorCode = Schema.Literals([
  "row_malformed",
  "source_id_missing",
  "source_id_too_long",
  "source_id_duplicate",
  "kind_invalid",
  "name_blank",
  "role_invalid",
  "source_record_changed",
])

/** A per-record error. It names a field and a code, and never echoes a source value. */
export const ImportRowError = Schema.Struct({
  field: Schema.NullOr(Schema.String),
  code: ImportRowErrorCode,
  message: Schema.String,
})

export const ErrorCount = Schema.Struct({ code: ImportRowErrorCode, count: Schema.Int })

/** The saved dry-run preview. A rehearsal produces no business effect. */
export const ImportRehearsal = Schema.Struct({
  rows: Schema.Int,
  /** Pending rows the owner command would create. */
  accepted: Schema.Int,
  /** Pending rows whose source record is already mapped to a native record with the same content. */
  alreadyMapped: Schema.Int,
  alreadyApplied: Schema.Int,
  /** Rows with an error that blocks apply. */
  blocking: Schema.Int,
  errors: Schema.Array(ErrorCount),
  durationMs: Schema.Int,
})

export const ImportBatch = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  sourceInstance: TrimmedNonBlankString,
  sourceVersion: Schema.NullOr(TrimmedNonBlankString),
  objectKind: ImportObjectKind,
  fileChecksum: Schema.String,
  mappingRevision: Schema.String,
  uploadedBy: Schema.String,
  status: ImportBatchStatus,
  rowCount: Schema.Int,
  rehearsal: Schema.NullOr(ImportRehearsal),
  rehearsedAt: Schema.NullOr(Schema.String),
  appliedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
})

export const ImportBatchSummary = Schema.Struct({
  batch: ImportBatch,
  pending: Schema.Int,
  invalid: Schema.Int,
  applied: Schema.Int,
})

export const StagedImport = Schema.Struct({
  /** True when the same file and mapping revision were already staged, so nothing new was stored. */
  alreadyStaged: Schema.Boolean,
  summary: ImportBatchSummary,
})

export const ApplyImportResult = Schema.Struct({
  summary: ImportBatchSummary,
  /** Native records this call created through the owner command. */
  created: Schema.Int,
  /** Rows linked to a native record that an earlier import already created. */
  linked: Schema.Int,
  /** Rows whose source record changed since it was imported; they are reported, not applied. */
  changed: Schema.Int,
})

export const ImportRow = Schema.Struct({
  rowNumber: Schema.Int,
  /** Invalid rows are reported by row number and carry an empty source id. */
  sourceId: Schema.String,
  status: ImportRowStatus,
  errors: Schema.Array(ImportRowError),
  nativeId: Schema.NullOr(Uuid),
})

export const StageImportInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  sourceInstance: TrimmedNonBlankString.check(Schema.isMaxLength(120)),
  sourceVersion: Schema.optionalKey(TrimmedNonBlankString.check(Schema.isMaxLength(120))),
  objectKind: ImportObjectKind,
  mappingRevision: TrimmedNonBlankString,
  csv: Schema.String.check(Schema.isMaxLength(MaxCsvCharacters)),
})

export const GetImportBatchInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  batchId: Uuid,
})

export const ListImportRowsInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  batchId: Uuid,
  status: Schema.optionalKey(ImportRowStatus),
  /** Return rows after this row number, to page through a batch in row order. */
  afterRowNumber: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))),
})

export const RehearseImportInput = GetImportBatchInput
export const ApplyImportInput = GetImportBatchInput

export type ImportRowError = Schema.Schema.Type<typeof ImportRowError>

export type ImportRehearsal = Schema.Schema.Type<typeof ImportRehearsal>

export type ImportBatch = Schema.Schema.Type<typeof ImportBatch>

export type ImportBatchSummary = Schema.Schema.Type<typeof ImportBatchSummary>

export type StagedImport = Schema.Schema.Type<typeof StagedImport>

export type ApplyImportResult = Schema.Schema.Type<typeof ApplyImportResult>

export type ImportRow = Schema.Schema.Type<typeof ImportRow>

export type ImportRowStatus = Schema.Schema.Type<typeof ImportRowStatus>

export type ImportObjectKind = Schema.Schema.Type<typeof ImportObjectKind>

type Failure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

export interface OnboardingService {
  /** Parses and validates a file into per-record rows. Staging the same file again returns its batch. */
  readonly stage: (
    input: Schema.Codec.Encoded<typeof StageImportInput>,
  ) => Effect.Effect<StagedImport, ImportFileInvalid | UnsupportedMappingRevision | Failure>
  readonly getBatch: (
    input: Schema.Codec.Encoded<typeof GetImportBatchInput>,
  ) => Effect.Effect<ImportBatchSummary, ImportBatchNotFound | Failure>
  readonly listRows: (
    input: Schema.Codec.Encoded<typeof ListImportRowsInput>,
  ) => Effect.Effect<ReadonlyArray<ImportRow>, ImportBatchNotFound | Failure>
  /** A dry run: checks every record against the identity map and saves the preview. No owner command runs. */
  readonly rehearse: (
    input: Schema.Codec.Encoded<typeof RehearseImportInput>,
  ) => Effect.Effect<ImportBatchSummary, ImportBatchNotFound | Failure>
  /** Applies pending rows through owner commands, one transaction per record. Calling it again resumes. */
  readonly apply: (
    input: Schema.Codec.Encoded<typeof ApplyImportInput>,
  ) => Effect.Effect<
    ApplyImportResult,
    | ImportBatchNotFound
    | ImportBatchNotRehearsed
    | ImportBatchHasBlockingErrors
    | SourceRecordMappedConcurrently
    | PartyNotFound
    | PartyRoleAlreadyAssigned
    | EventIdempotencyConflict
    | Failure
  >
}

export const OnboardingService = Context.Service<OnboardingService>("RITSEI/OnboardingService")
