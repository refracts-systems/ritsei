import * as Schema from "effect/Schema"

const Uuid = Schema.String.check(Schema.isUUID())

/** The document a chain was requested for does not exist in the tenant. */
export class DocumentNotFound extends Schema.TaggedError<DocumentNotFound>()("DocumentNotFound", {
  tenantId: Uuid,
  documentType: Schema.String,
  documentId: Uuid,
}) {}
