import * as Schema from "effect/Schema"

const Uuid = Schema.String.check(Schema.isUUID())

export class BillingDocumentNotFound extends Schema.TaggedError<BillingDocumentNotFound>()(
  "BillingDocumentNotFound",
  { tenantId: Uuid, invoiceId: Uuid },
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
