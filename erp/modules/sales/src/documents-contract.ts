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
