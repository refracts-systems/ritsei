import * as Schema from "effect/Schema"

const Uuid = Schema.String.check(Schema.isUUID())

export class BillingDocumentNotFound extends Schema.TaggedError<BillingDocumentNotFound>()(
  "BillingDocumentNotFound",
  { tenantId: Uuid, invoiceId: Uuid },
) {}

/** No retained document has this id in the tenant. */
export class ImportedArtifactNotFound extends Schema.TaggedError<ImportedArtifactNotFound>()(
  "ImportedArtifactNotFound",
  { tenantId: Uuid, artifactId: Uuid },
) {}

/** The source document was retained before with different bytes, filename, type, or invoice. */
export class ImportedArtifactConflict extends Schema.TaggedError<ImportedArtifactConflict>()(
  "ImportedArtifactConflict",
  { tenantId: Uuid, sourceSystem: Schema.String, sourceReference: Schema.String },
) {}

/** The source has no delivered or received quantity left to bill. */
export class NothingToInvoice extends Schema.TaggedError<NothingToInvoice>()("NothingToInvoice", {
  tenantId: Uuid,
  sourceId: Uuid,
}) {}

/** Crediting the line would exceed the quantity it billed, net of earlier credits. */
export class CreditExceedsInvoice extends Schema.TaggedError<CreditExceedsInvoice>()(
  "CreditExceedsInvoice",
  { tenantId: Uuid, invoiceLineId: Uuid, available: Schema.String },
) {}

export class SettlementExceedsOpenAmount extends Schema.TaggedError<SettlementExceedsOpenAmount>()(
  "SettlementExceedsOpenAmount",
  { tenantId: Uuid, invoiceId: Uuid, openAmount: Schema.String, requested: Schema.String },
) {}

/** The same settlement source was applied before with a different amount. */
export class SettlementConflict extends Schema.TaggedError<SettlementConflict>()(
  "SettlementConflict",
  { tenantId: Uuid, invoiceId: Uuid, sourceId: Uuid },
) {}

/** Billing more than was received (net of returns and earlier bills) without an approved variance. */
export class BillExceedsReceipt extends Schema.TaggedError<BillExceedsReceipt>()(
  "BillExceedsReceipt",
  {
    tenantId: Uuid,
    purchaseOrderLineId: Uuid,
    billable: Schema.String,
    requested: Schema.String,
  },
) {}
