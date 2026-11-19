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

/** The withheld amount leaves no cash in the payment, or is not allocated to documents. */
export class InvalidWithholding extends Schema.TaggedError<InvalidWithholding>()(
  "InvalidWithholding",
  { tenantId: Uuid, reason: Schema.Literals(["not_below_payment", "not_allocated"]) },
) {}

/** The statement file does not follow the import profile; nothing is imported. */
export class InvalidBankStatement extends Schema.TaggedError<InvalidBankStatement>()(
  "InvalidBankStatement",
  { row: Schema.Int, reason: Schema.String },
) {}

export class BankLineNotFound extends Schema.TaggedError<BankLineNotFound>()("BankLineNotFound", {
  tenantId: Uuid,
  lineId: Uuid,
}) {}

export class BankMatchNotFound extends Schema.TaggedError<BankMatchNotFound>()(
  "BankMatchNotFound",
  { tenantId: Uuid, matchId: Uuid },
) {}

/** The line and the payment belong to another legal entity or bank account, or the other direction. */
export class BankMatchMismatch extends Schema.TaggedError<BankMatchMismatch>()(
  "BankMatchMismatch",
  {
    tenantId: Uuid,
    lineId: Uuid,
    paymentId: Uuid,
    reason: Schema.Literals(["legal_entity", "bank_account", "direction"]),
  },
) {}

/** The amount is more than what is still unmatched on the line or on the payment's cash. */
export class BankMatchExceedsAvailable extends Schema.TaggedError<BankMatchExceedsAvailable>()(
  "BankMatchExceedsAvailable",
  {
    tenantId: Uuid,
    lineId: Uuid,
    paymentId: Uuid,
    available: Schema.String,
    requested: Schema.String,
  },
) {}
