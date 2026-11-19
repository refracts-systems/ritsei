import * as Schema from "effect/Schema"

const Uuid = Schema.String.check(Schema.isUUID())

/** The file cannot be read as the object kind's CSV. The operator fixes the export and stages again. */
export class ImportFileInvalid extends Schema.TaggedError<ImportFileInvalid>()(
  "ImportFileInvalid",
  {
    tenantId: Uuid,
    reason: Schema.Literals(["empty", "malformed_csv", "missing_column", "too_many_rows"]),
    column: Schema.NullOr(Schema.String),
  },
) {}

export class UnsupportedMappingRevision extends Schema.TaggedError<UnsupportedMappingRevision>()(
  "UnsupportedMappingRevision",
  { tenantId: Uuid, objectKind: Schema.String, mappingRevision: Schema.String },
) {}

export class ImportBatchNotFound extends Schema.TaggedError<ImportBatchNotFound>()(
  "ImportBatchNotFound",
  { tenantId: Uuid, batchId: Uuid },
) {}

/** Apply needs a saved rehearsal of this exact batch (same file checksum and mapping revision). */
export class ImportBatchNotRehearsed extends Schema.TaggedError<ImportBatchNotRehearsed>()(
  "ImportBatchNotRehearsed",
  { tenantId: Uuid, batchId: Uuid },
) {}

/** Rows with blocking errors cannot be applied; the operator corrects the file and stages it again. */
export class ImportBatchHasBlockingErrors extends Schema.TaggedError<ImportBatchHasBlockingErrors>()(
  "ImportBatchHasBlockingErrors",
  { tenantId: Uuid, batchId: Uuid, invalidRows: Schema.Int },
) {}

/** Another import mapped the same source record while this one applied it; apply again to resume. */
export class SourceRecordMappedConcurrently extends Schema.TaggedError<SourceRecordMappedConcurrently>()(
  "SourceRecordMappedConcurrently",
  { tenantId: Uuid, batchId: Uuid, rowNumber: Schema.Int },
) {}

/** Raised by the store when the identity map already holds the source record; never public. */
export class SourceIdentityAlreadyMapped extends Schema.TaggedError<SourceIdentityAlreadyMapped>()(
  "SourceIdentityAlreadyMapped",
  { tenantId: Uuid, sourceId: Schema.String },
) {}
