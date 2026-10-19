import * as Schema from "effect/Schema"

const Uuid = Schema.String.check(Schema.isUUID())
const LowercaseTrimmedNonEmptyString = Schema.String.check(
  Schema.makeFilter(
    (value) => /\S/.test(value) && value === value.trim() && value === value.toLowerCase(),
    { expected: "a trimmed lowercase nonblank string" },
  ),
)
const TrimmedNonEmptyString = Schema.String.check(
  Schema.makeFilter((value) => /\S/.test(value) && value === value.trim(), {
    expected: "a trimmed nonblank string",
  }),
)

export class CustomerAlreadyExists extends Schema.TaggedError<CustomerAlreadyExists>()(
  "CustomerAlreadyExists",
  {
    tenantId: Uuid,
    email: LowercaseTrimmedNonEmptyString,
  },
) {}
export class CustomerNotFound extends Schema.TaggedError<CustomerNotFound>()("CustomerNotFound", {
  tenantId: Uuid,
  customerId: Uuid,
}) {}
export class QuotationNotFound extends Schema.TaggedError<QuotationNotFound>()(
  "QuotationNotFound",
  {
    tenantId: Uuid,
    quotationId: Uuid,
  },
) {}
export class QuotationCustomerMismatch extends Schema.TaggedError<QuotationCustomerMismatch>()(
  "QuotationCustomerMismatch",
  {
    tenantId: Uuid,
    quotationId: Uuid,
    customerId: Uuid,
  },
) {}
export class SalesOrderNotFound extends Schema.TaggedError<SalesOrderNotFound>()(
  "SalesOrderNotFound",
  {
    tenantId: Uuid,
    orderId: Uuid,
  },
) {}
export class SalesOrderInvalidState extends Schema.TaggedError<SalesOrderInvalidState>()(
  "SalesOrderInvalidState",
  {
    tenantId: Uuid,
    orderId: Uuid,
    status: Schema.Literals(["draft", "confirmed", "cancelled"]),
  },
) {}
export class SalesOrderConfirmationIdempotencyConflict extends Schema.TaggedError<SalesOrderConfirmationIdempotencyConflict>()(
  "SalesOrderConfirmationIdempotencyConflict",
  { tenantId: Uuid, orderId: Uuid, idempotencyKey: TrimmedNonEmptyString },
) {}
