import * as Schema from "effect/Schema"

const Uuid = Schema.String.check(Schema.isUUID())

/** No module released custom fields for this document type. */
export class CustomFieldDocumentTypeNotReleased extends Schema.TaggedError<CustomFieldDocumentTypeNotReleased>()(
  "CustomFieldDocumentTypeNotReleased",
  { tenantId: Uuid, documentType: Schema.String },
) {}

export class CustomFieldAlreadyDefined extends Schema.TaggedError<CustomFieldAlreadyDefined>()(
  "CustomFieldAlreadyDefined",
  { tenantId: Uuid, documentType: Schema.String, key: Schema.String },
) {}

/** A value names a field the tenant has not defined for the document type. */
export class CustomFieldNotDefined extends Schema.TaggedError<CustomFieldNotDefined>()(
  "CustomFieldNotDefined",
  { tenantId: Uuid, documentType: Schema.String, key: Schema.String },
) {}

/** A value does not fit its field's kind, or is not one of its choices. */
export class CustomFieldValueInvalid extends Schema.TaggedError<CustomFieldValueInvalid>()(
  "CustomFieldValueInvalid",
  { tenantId: Uuid, documentType: Schema.String, key: Schema.String, expected: Schema.String },
) {}

/** A required field would be left without a value. */
export class CustomFieldRequired extends Schema.TaggedError<CustomFieldRequired>()(
  "CustomFieldRequired",
  { tenantId: Uuid, documentType: Schema.String, key: Schema.String },
) {}
