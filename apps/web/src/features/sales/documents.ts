import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
  decodeInput,
  decodeResponse,
  mutationRequest,
  querySuffix,
  requestJson,
  routeWithId,
} from "../../shared/api.ts"
import { Warehouse, inventoryRoutes } from "../../shared/contracts/generated/inventory.ts"
import { Amount, CalendarDate, Uuid } from "../../shared/schemas.ts"

/** Browser view of the Sales document contract (quotations with lines, order fulfillment). */
export const QuotationStatus = Schema.Literals(["draft", "sent", "accepted", "rejected", "expired"])

const PricedLine = Schema.Struct({
  id: Uuid,
  productId: Uuid,
  quantity: Schema.String,
  listPrice: Amount,
  discountPercent: Schema.String,
  unitPrice: Amount,
  taxCodeId: Schema.NullOr(Uuid),
  lineTotal: Amount,
})

export const QuotationDocument = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  customerId: Uuid,
  legalEntityId: Uuid,
  status: QuotationStatus,
  validUntil: CalendarDate,
  total: Amount,
  lines: Schema.Array(PricedLine).check(Schema.isMaxLength(200)),
})

export type QuotationDocument = Schema.Schema.Type<typeof QuotationDocument>

const FulfillmentLine = Schema.Struct({
  orderLineId: Uuid,
  productId: Uuid,
  quantity: Schema.String,
  unitPrice: Amount,
  taxCodeId: Schema.NullOr(Uuid),
  delivered: Schema.String,
})

export const OrderFulfillment = Schema.Struct({
  orderId: Uuid,
  tenantId: Uuid,
  legalEntityId: Uuid,
  customerId: Uuid,
  partyId: Uuid,
  status: Schema.Literals(["draft", "confirmed", "cancelled"]),
  lines: Schema.Array(FulfillmentLine).check(Schema.isMaxLength(200)),
})

export type OrderFulfillment = Schema.Schema.Type<typeof OrderFulfillment>

const DeliveredOrder = Schema.Struct({
  delivery: Schema.Struct({ id: Uuid, number: Schema.String, deliveryDate: CalendarDate }),
})

const Product = Schema.Struct({
  id: Uuid,
  code: Schema.String,
  name: Schema.String,
  type: Schema.Literals(["stockable", "consumable", "service"]),
})

export type Product = Schema.Schema.Type<typeof Product>

const ProductList = Schema.Array(Product).check(Schema.isMaxLength(200))
const WarehouseList = Schema.Array(Warehouse).check(Schema.isMaxLength(200))

const DraftQuotationInput = Schema.Struct({
  customerId: Uuid,
  validUntil: CalendarDate,
  lines: Schema.Array(
    Schema.Struct({
      productId: Uuid,
      quantity: Schema.String.check(Schema.isPattern(/^[1-9]\d*$/)),
      discountPercent: Schema.optionalKey(Schema.String),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
})

const DeliverOrderInput = Schema.Struct({
  orderId: Uuid,
  warehouseId: Uuid,
  deliveryDate: CalendarDate,
  lines: Schema.Array(
    Schema.Struct({
      orderLineId: Uuid,
      quantity: Schema.String.check(Schema.isPattern(/^[1-9]\d*$/)),
    }),
  ).check(Schema.isMinLength(1)),
})

export const quotationActions = ["send", "accept", "reject", "convert"] as const

export type QuotationAction = (typeof quotationActions)[number]

const quotationDocuments = "/sales/quotation-documents"

export const draftQuotation = Effect.fn("Frontend.Sales.draftQuotation")(function* (
  input: Schema.Codec.Encoded<typeof DraftQuotationInput>,
) {
  const decoded = yield* decodeInput(DraftQuotationInput, input)
  const body = yield* mutationRequest(quotationDocuments, decoded)

  return yield* decodeResponse(QuotationDocument, body, "unknown-outcome")
})

export const getQuotationDocument = Effect.fn("Frontend.Sales.getQuotationDocument")(function* (
  id: string,
) {
  const decoded = yield* decodeInput(Uuid, id)
  const body = yield* requestJson(routeWithId(`${quotationDocuments}/:id`, decoded))

  return yield* decodeResponse(QuotationDocument, body)
})

const ConvertedQuotation = Schema.Struct({ orderId: Uuid })

export type QuotationActionResult =
  | QuotationDocument
  | Schema.Schema.Type<typeof ConvertedQuotation>

export const advanceQuotation = Effect.fn("Frontend.Sales.advanceQuotation")(function* (
  id: string,
  action: QuotationAction,
) {
  const decoded = yield* decodeInput(Uuid, id)
  const path = routeWithId(`${quotationDocuments}/:id/${action}`, decoded)
  const body = yield* mutationRequest(path)

  return action === "convert"
    ? yield* decodeResponse(ConvertedQuotation, body, "unknown-outcome")
    : yield* decodeResponse(QuotationDocument, body, "unknown-outcome")
})

export const getOrderFulfillment = Effect.fn("Frontend.Sales.getOrderFulfillment")(function* (
  orderId: string,
) {
  const decoded = yield* decodeInput(Uuid, orderId)
  const body = yield* requestJson(routeWithId("/sales/orders/:id/fulfillment", decoded))

  return yield* decodeResponse(OrderFulfillment, body)
})

export const deliverOrder = Effect.fn("Frontend.Sales.deliverOrder")(function* (
  input: Schema.Codec.Encoded<typeof DeliverOrderInput>,
) {
  const decoded = yield* decodeInput(DeliverOrderInput, input)
  const body = yield* mutationRequest("/process/order-deliveries", decoded)

  return yield* decodeResponse(DeliveredOrder, body, "unknown-outcome")
})

export const listProducts = Effect.fn("Frontend.Sales.listProducts")(function* () {
  const body = yield* requestJson(`/product/products${querySuffix({ limit: 200 })}`)

  return yield* decodeResponse(ProductList, body)
})

export const listWarehouses = Effect.fn("Frontend.Sales.listWarehouses")(function* () {
  const body = yield* requestJson(`${inventoryRoutes.listWarehouses}${querySuffix({ limit: 200 })}`)

  return yield* decodeResponse(WarehouseList, body)
})

/** What the user is told for the business failures quotation documents can return. */
export const quotationFailureMessages = {
  CustomerLegalEntityRequired: "This customer is not linked to a legal entity yet.",
  ProductPriceNotFound:
    "A product has no price for this customer. Set a price in the customer's price list first.",
  CustomerNotFound: "This customer is no longer available. Reload and choose another.",
  QuotationInvalidState: "The quotation is not in a state that allows this step.",
  QuotationNotFound: "This quotation is no longer available. Reload the workspace.",
} as const

/** What the user is told for the business failures a delivery can return. */
export const deliveryFailureMessages = {
  DeliveryExceedsOrder: "A line is delivering more than what is still undelivered on the order.",
  SalesOrderInvalidState: "Only confirmed orders can be delivered.",
  SalesOrderNotFound: "This order is no longer available. Reload the workspace.",
  OrderLineNotFound: "A delivery line does not belong to this order.",
  StockUnavailable: "There is not enough stock in this warehouse for the delivered quantities.",
  StockValuationUnavailable:
    "A delivered product has no stock cost yet. Receive stock for it before delivering.",
  InventoryReferenceNotFound: "A stockable product is not registered as an inventory item.",
  CustomerLegalEntityRequired: "This customer is not linked to a legal entity yet.",
  AccountingPeriodNotOpen: "The accounting period for that delivery date is not open.",
  PostingRuleNotFound:
    "A posting rule is missing for this legal entity. Apply a chart template in Finance first.",
} as const
