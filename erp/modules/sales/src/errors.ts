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

/** The party relationship is missing, inactive, or not a customer relationship. */
export class CustomerPartyRoleInvalid extends Schema.TaggedError<CustomerPartyRoleInvalid>()(
  "CustomerPartyRoleInvalid",
  { tenantId: Uuid, partyRelationshipId: Uuid },
) {}

/** Documents that post or deliver need a customer bound to a party in a legal entity. */
export class CustomerLegalEntityRequired extends Schema.TaggedError<CustomerLegalEntityRequired>()(
  "CustomerLegalEntityRequired",
  { tenantId: Uuid, customerId: Uuid },
) {}

export class PriceListNotFound extends Schema.TaggedError<PriceListNotFound>()(
  "PriceListNotFound",
  { tenantId: Uuid, priceListId: Uuid },
) {}

export class PriceListAlreadyExists extends Schema.TaggedError<PriceListAlreadyExists>()(
  "PriceListAlreadyExists",
  { tenantId: Uuid, name: Schema.String },
) {}

/** No explicit price and no price on the customer's price list. */
export class ProductPriceNotFound extends Schema.TaggedError<ProductPriceNotFound>()(
  "ProductPriceNotFound",
  { tenantId: Uuid, productId: Uuid },
) {}

export class QuotationInvalidState extends Schema.TaggedError<QuotationInvalidState>()(
  "QuotationInvalidState",
  {
    tenantId: Uuid,
    quotationId: Uuid,
    status: Schema.Literals(["draft", "sent", "accepted", "rejected", "expired"]),
  },
) {}

export class OrderLineNotFound extends Schema.TaggedError<OrderLineNotFound>()(
  "OrderLineNotFound",
  { tenantId: Uuid, orderId: Uuid, orderLineId: Uuid },
) {}

/** The delivery would bring a line's delivered quantity above its ordered quantity. */
export class DeliveryExceedsOrder extends Schema.TaggedError<DeliveryExceedsOrder>()(
  "DeliveryExceedsOrder",
  { tenantId: Uuid, orderLineId: Uuid, ordered: Schema.String, requested: Schema.String },
) {}

/** Confirming the order would take the customer past their credit limit (ADR-0108). */
export class CreditLimitExceeded extends Schema.TaggedError<CreditLimitExceeded>()(
  "CreditLimitExceeded",
  {
    tenantId: Uuid,
    orderId: Uuid,
    customerId: Uuid,
    creditLimit: Schema.String,
    receivableBalance: Schema.String,
    orderTotal: Schema.String,
  },
) {}
