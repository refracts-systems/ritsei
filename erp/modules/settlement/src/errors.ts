import * as Schema from "effect/Schema"

const Uuid = Schema.String.check(Schema.isUUID())

export class PaymentTermAlreadyExists extends Schema.TaggedError<PaymentTermAlreadyExists>()(
  "PaymentTermAlreadyExists",
  { tenantId: Uuid, code: Schema.String },
) {}

export class PaymentTermNotFound extends Schema.TaggedError<PaymentTermNotFound>()(
  "PaymentTermNotFound",
  { tenantId: Uuid, paymentTermId: Uuid },
) {}

export class PaymentNotFound extends Schema.TaggedError<PaymentNotFound>()("PaymentNotFound", {
  tenantId: Uuid,
  paymentId: Uuid,
}) {}

export class AllocationExceedsPayment extends Schema.TaggedError<AllocationExceedsPayment>()(
  "AllocationExceedsPayment",
  { tenantId: Uuid, paymentId: Uuid, unallocated: Schema.String, requested: Schema.String },
) {}

/** A payment cannot be allocated before it exists. */
export class AllocationBeforePayment extends Schema.TaggedError<AllocationBeforePayment>()(
  "AllocationBeforePayment",
  { tenantId: Uuid, paymentId: Uuid, paymentDate: Schema.String, allocatedOn: Schema.String },
) {}

/** The document belongs to another party or legal entity, or to the other side of the ledger. */
export class AllocationMismatch extends Schema.TaggedError<AllocationMismatch>()(
  "AllocationMismatch",
  { tenantId: Uuid, paymentId: Uuid, invoiceId: Uuid },
) {}
