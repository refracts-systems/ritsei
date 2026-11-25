import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  CalendarDate,
  type DatabaseFailure,
  FinancialMajorAmount,
  Uuid,
  TrimmedText,
  PositiveQuantity,
  NonNegativeQuantity,
} from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import type { PartyNotFound, PartyRelationshipNotFound } from "../../party/mod.ts"
import type { CreditStanding } from "./credit.ts"
import type {
  CustomerAlreadyExists,
  CustomerLegalEntityRequired,
  CustomerNotFound,
  CustomerPartyRoleInvalid,
  DeliveryExceedsOrder,
  OrderLineNotFound,
  PriceListAlreadyExists,
  PriceListNotFound,
  ProductPriceNotFound,
  QuotationInvalidState,
  QuotationNotFound,
  SalesOrderInvalidState,
  SalesOrderNotFound,
} from "./errors.ts"

const Text = TrimmedText(256)

const Email = Schema.String.check(
  Schema.makeFilter((value) => /^[^\s@]+@[^\s@]+$/.test(value), { expected: "an email address" }),
)

const Quantity = PositiveQuantity

/** Percent with up to two decimals between 0 and 100. */
export const DiscountPercent = Schema.String.check(
  Schema.makeFilter((value) => /^\d{1,3}(\.\d{1,2})?$/.test(value) && Number(value) <= 100, {
    expected: "a discount percent between 0 and 100 with at most two decimals",
  }),
)

const ScopedInput = { principal: Principal, tenantId: Uuid }

export const PartyCustomer = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  name: Text,
  email: Schema.String,
  partyId: Uuid,
  partyRelationshipId: Uuid,
  legalEntityId: Uuid,
  priceListId: Schema.NullOr(Uuid),
})

export type PartyCustomer = Schema.Schema.Type<typeof PartyCustomer>

export const PriceList = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  name: Text,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
})

export type PriceList = Schema.Schema.Type<typeof PriceList>

export const PriceListItem = Schema.Struct({
  priceListId: Uuid,
  productId: Uuid,
  unitPrice: FinancialMajorAmount,
})

export const PricedLine = Schema.Struct({
  id: Uuid,
  productId: Uuid,
  quantity: Quantity,
  listPrice: FinancialMajorAmount,
  discountPercent: Schema.String,
  /** Net unit price after discount, before tax. */
  unitPrice: FinancialMajorAmount,
  taxCodeId: Schema.NullOr(Uuid),
  lineTotal: FinancialMajorAmount,
})

export type PricedLine = Schema.Schema.Type<typeof PricedLine>

export const QuotationStatus = Schema.Literals(["draft", "sent", "accepted", "rejected", "expired"])

export const SalesQuotation = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  customerId: Uuid,
  legalEntityId: Uuid,
  status: QuotationStatus,
  /** The ADR-0095 number, allocated when the quotation is sent; null while it is a draft. */
  number: Schema.NullOr(Schema.String),
  validUntil: CalendarDate,
  total: FinancialMajorAmount,
  lines: Schema.Array(PricedLine),
})

export type SalesQuotation = Schema.Schema.Type<typeof SalesQuotation>

export const FulfillmentLine = Schema.Struct({
  orderLineId: Uuid,
  productId: Uuid,
  quantity: Quantity,
  unitPrice: FinancialMajorAmount,
  taxCodeId: Schema.NullOr(Uuid),
  delivered: NonNegativeQuantity,
})

export const OrderFulfillment = Schema.Struct({
  orderId: Uuid,
  tenantId: Uuid,
  legalEntityId: Uuid,
  customerId: Uuid,
  partyId: Uuid,
  status: Schema.Literals(["draft", "confirmed", "cancelled"]),
  lines: Schema.Array(FulfillmentLine),
})

export type OrderFulfillment = Schema.Schema.Type<typeof OrderFulfillment>

export const Delivery = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  number: Schema.String,
  orderId: Uuid,
  legalEntityId: Uuid,
  warehouseId: Uuid,
  deliveryDate: CalendarDate,
  lines: Schema.Array(Schema.Struct({ orderLineId: Uuid, productId: Uuid, quantity: Quantity })),
})

export type Delivery = Schema.Schema.Type<typeof Delivery>

export const CreatePartyCustomerInput = Schema.Struct({
  ...ScopedInput,
  partyRelationshipId: Uuid,
  email: Email,
})

export const CreatePriceListInput = Schema.Struct({
  ...ScopedInput,
  name: Text,
  currency: PriceList.fields.currency,
})

export const SetPriceInput = Schema.Struct({
  ...ScopedInput,
  priceListId: Uuid,
  productId: Uuid,
  unitPrice: FinancialMajorAmount,
})

export const AssignCustomerPriceListInput = Schema.Struct({
  ...ScopedInput,
  customerId: Uuid,
  priceListId: Uuid,
})

export const DraftQuotationInput = Schema.Struct({
  ...ScopedInput,
  customerId: Uuid,
  validUntil: CalendarDate,
  lines: Schema.Array(
    Schema.Struct({
      productId: Uuid,
      quantity: Quantity,
      /** Overrides the customer's price list. */
      listPrice: Schema.optionalKey(FinancialMajorAmount),
      discountPercent: Schema.optionalKey(DiscountPercent),
      /** Overrides the product's default sales tax code. */
      taxCodeId: Schema.optionalKey(Schema.NullOr(Uuid)),
    }),
  )
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(200)),
})

export const CreditStandingInput = Schema.Struct({ ...ScopedInput, customerId: Uuid })

export const SetCreditLimitInput = Schema.Struct({
  ...ScopedInput,
  customerId: Uuid,
  /** Null removes the limit. */
  creditLimit: Schema.NullOr(FinancialMajorAmount),
})

export const QuotationCommandInput = Schema.Struct({ ...ScopedInput, quotationId: Uuid })
export const ExpireQuotationsInput = Schema.Struct({ ...ScopedInput, asOf: CalendarDate })
export const OrderQueryInput = Schema.Struct({ ...ScopedInput, orderId: Uuid })

export const RecordDeliveryInput = Schema.Struct({
  ...ScopedInput,
  /** Client-chosen id that makes a retried delivery return the recorded one. */
  deliveryId: Schema.optionalKey(Uuid),
  orderId: Uuid,
  warehouseId: Uuid,
  deliveryDate: CalendarDate,
  lines: Schema.Array(Schema.Struct({ orderLineId: Uuid, quantity: Quantity }))
    .check(Schema.isMinLength(1))
    .check(
      Schema.makeFilter(
        (lines) => new Set(lines.map((line) => line.orderLineId)).size === lines.length,
        { expected: "each order line appears once per delivery" },
      ),
    ),
})

export const NumberLookupInput = Schema.Struct({ ...ScopedInput, number: TrimmedText(64) })

/** A document found by its number: where to open it, not proof that the caller may. */
export const NumberCandidate = Schema.Struct({
  type: Schema.Literals(["sales.quotation", "sales.order", "sales.delivery"]),
  id: Uuid,
  number: Schema.String,
  legalEntityId: Uuid,
})

export type NumberCandidate = Schema.Schema.Type<typeof NumberCandidate>

export const PipelineFactsInput = Schema.Struct({ ...ScopedInput, legalEntityId: Uuid })

export const DeliverySummaryInput = Schema.Struct({ ...ScopedInput, deliveryId: Uuid })

/** A delivery with the customer it went to: what a serial lookup needs from Sales. */
export const DeliverySummary = Schema.Struct({
  deliveryId: Uuid,
  number: Schema.String,
  deliveryDate: CalendarDate,
  orderId: Uuid,
  customerId: Uuid,
  customerName: Schema.String,
})

export type DeliverySummary = Schema.Schema.Type<typeof DeliverySummary>

export const UndeliveredInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Uuid,
  asOf: CalendarDate,
})

/**
 * Confirmed orders with something still to deliver on a date, and what that is worth at order
 * prices. An order cancelled since that date is not counted, because a cancellation has no date.
 */
export const UndeliveredOrders = Schema.Struct({
  legalEntityId: Uuid,
  asOf: CalendarDate,
  orders: Schema.Int,
  value: FinancialMajorAmount,
})

export type UndeliveredOrders = Schema.Schema.Type<typeof UndeliveredOrders>

/** How many documents are at a stage, and the date of the oldest. */
export const StageFacts = Schema.Struct({
  count: Schema.Int,
  oldestDate: Schema.NullOr(CalendarDate),
})

/**
 * What Sales knows of its documents' stages in one legal entity (Yard, E3). Whether a delivered
 * order is fully invoiced is Billing's fact, so the delivered quantities come out per order line
 * for the documents module to set against Billing's.
 */
export const SalesPipelineFacts = Schema.Struct({
  /** Quotations sent or accepted, with no order made from them; dated by sending. */
  quotations: StageFacts,
  /** Confirmed orders with nothing delivered; dated by confirmation. */
  orders: StageFacts,
  /** Confirmed orders with a delivery; dated by the first delivery. */
  delivered: Schema.Array(
    Schema.Struct({
      orderId: Uuid,
      firstDeliveryDate: CalendarDate,
      lines: Schema.Array(Schema.Struct({ orderLineId: Uuid, delivered: NonNegativeQuantity })),
    }),
  ),
})

export type SalesPipelineFacts = Schema.Schema.Type<typeof SalesPipelineFacts>

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

/**
 * Order-to-Cash documents owned by Sales (ADR-0099, ADR-0101): customers as party roles, price
 * lists, quotations with lines and lifecycle, conversion to orders, and delivery evidence.
 */
export interface SalesDocumentService {
  readonly createPartyCustomer: (
    input: Schema.Codec.Encoded<typeof CreatePartyCustomerInput>,
  ) => Effect.Effect<
    PartyCustomer,
    | CustomerAlreadyExists
    | CustomerPartyRoleInvalid
    | PartyNotFound
    | PartyRelationshipNotFound
    | CommonFailure
  >
  /** What the customer may owe, what they owe now, and what is left. */
  readonly getCreditStanding: (
    input: Schema.Codec.Encoded<typeof CreditStandingInput>,
  ) => Effect.Effect<CreditStanding, CustomerNotFound | CommonFailure>
  /** Sets or removes the limit that gates confirming the customer's orders (ADR-0108). */
  readonly setCreditLimit: (
    input: Schema.Codec.Encoded<typeof SetCreditLimitInput>,
  ) => Effect.Effect<CreditStanding, CustomerNotFound | CommonFailure>
  readonly createPriceList: (
    input: Schema.Codec.Encoded<typeof CreatePriceListInput>,
  ) => Effect.Effect<PriceList, PriceListAlreadyExists | CommonFailure>
  readonly setPrice: (
    input: Schema.Codec.Encoded<typeof SetPriceInput>,
  ) => Effect.Effect<
    Schema.Schema.Type<typeof PriceListItem>,
    PriceListNotFound | ProductPriceNotFound | CommonFailure
  >
  readonly assignCustomerPriceList: (
    input: Schema.Codec.Encoded<typeof AssignCustomerPriceListInput>,
  ) => Effect.Effect<PartyCustomer, CustomerNotFound | PriceListNotFound | CommonFailure>
  readonly draftQuotation: (
    input: Schema.Codec.Encoded<typeof DraftQuotationInput>,
  ) => Effect.Effect<
    SalesQuotation,
    CustomerNotFound | CustomerLegalEntityRequired | ProductPriceNotFound | CommonFailure
  >
  readonly getQuotation: (
    input: Schema.Codec.Encoded<typeof QuotationCommandInput>,
  ) => Effect.Effect<SalesQuotation, QuotationNotFound | CommonFailure>
  readonly sendQuotation: (
    input: Schema.Codec.Encoded<typeof QuotationCommandInput>,
  ) => Effect.Effect<SalesQuotation, QuotationNotFound | QuotationInvalidState | CommonFailure>
  readonly acceptQuotation: (
    input: Schema.Codec.Encoded<typeof QuotationCommandInput>,
  ) => Effect.Effect<SalesQuotation, QuotationNotFound | QuotationInvalidState | CommonFailure>
  readonly rejectQuotation: (
    input: Schema.Codec.Encoded<typeof QuotationCommandInput>,
  ) => Effect.Effect<SalesQuotation, QuotationNotFound | QuotationInvalidState | CommonFailure>
  /** Expires every sent quotation whose validity ended before `asOf`; returns the expired ids. */
  readonly expireQuotations: (
    input: Schema.Codec.Encoded<typeof ExpireQuotationsInput>,
  ) => Effect.Effect<ReadonlyArray<string>, CommonFailure>
  /** Creates the draft order for an accepted quotation, or returns the one already created. */
  readonly convertQuotation: (
    input: Schema.Codec.Encoded<typeof QuotationCommandInput>,
  ) => Effect.Effect<
    { readonly orderId: string },
    QuotationNotFound | QuotationInvalidState | CommonFailure
  >
  readonly getFulfillment: (
    input: Schema.Codec.Encoded<typeof OrderQueryInput>,
  ) => Effect.Effect<
    OrderFulfillment,
    SalesOrderNotFound | CustomerLegalEntityRequired | CommonFailure
  >
  /** The quotations, orders, and deliveries with exactly this number, in any legal entity. */
  readonly findByNumber: (
    input: Schema.Codec.Encoded<typeof NumberLookupInput>,
  ) => Effect.Effect<ReadonlyArray<NumberCandidate>, CommonFailure>
  /** The stages of the quotations, orders, and deliveries of one legal entity. */
  readonly getPipelineFacts: (
    input: Schema.Codec.Encoded<typeof PipelineFactsInput>,
  ) => Effect.Effect<SalesPipelineFacts, CommonFailure>
  /** Confirmed orders not yet fully delivered on a date, for one legal entity. */
  readonly getUndeliveredOrders: (
    input: Schema.Codec.Encoded<typeof UndeliveredInput>,
  ) => Effect.Effect<UndeliveredOrders, CommonFailure>
  /** One delivery with its customer, or null when there is none in the tenant. */
  readonly getDeliverySummary: (
    input: Schema.Codec.Encoded<typeof DeliverySummaryInput>,
  ) => Effect.Effect<DeliverySummary | null, CommonFailure>
  /** The order's deliveries, oldest first. */
  readonly listDeliveries: (
    input: Schema.Codec.Encoded<typeof OrderQueryInput>,
  ) => Effect.Effect<
    ReadonlyArray<Delivery>,
    SalesOrderNotFound | CustomerLegalEntityRequired | CommonFailure
  >
  readonly recordDelivery: (
    input: Schema.Codec.Encoded<typeof RecordDeliveryInput>,
  ) => Effect.Effect<
    Delivery,
    | SalesOrderNotFound
    | SalesOrderInvalidState
    | CustomerLegalEntityRequired
    | OrderLineNotFound
    | DeliveryExceedsOrder
    | CommonFailure
  >
}

export const SalesDocumentService = Context.Service<SalesDocumentService>(
  "RITSEI/SalesDocumentService",
)
