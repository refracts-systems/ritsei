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
import { Amount, CalendarDate, Uuid } from "../../shared/schemas.ts"

/** Browser view of the Procurement document contract (priced orders, matching, valued receipts). */
const MatchingLine = Schema.Struct({
  purchaseOrderLineId: Uuid,
  productId: Uuid,
  ordered: Schema.String,
  received: Schema.String,
  returned: Schema.String,
  unitPrice: Amount,
  taxCodeId: Schema.NullOr(Uuid),
})

export const PurchaseMatching = Schema.Struct({
  purchaseOrderId: Uuid,
  supplierAccountId: Uuid,
  partyId: Uuid,
  legalEntityId: Uuid,
  status: Schema.Literals(["draft", "confirmed", "cancelled"]),
  lines: Schema.Array(MatchingLine).check(Schema.isMaxLength(200)),
})

export type PurchaseMatching = Schema.Schema.Type<typeof PurchaseMatching>

const PricedPurchaseOrder = Schema.Struct({
  purchaseOrderId: Uuid,
  total: Amount,
  /** Present when the total needs an approval before the order can be released. */
  approval: Schema.NullOr(Schema.Unknown),
})

export type PricedPurchaseOrder = Schema.Schema.Type<typeof PricedPurchaseOrder>

const StockDocument = Schema.Struct({ id: Uuid, purchaseOrderId: Uuid, number: Schema.String })

const DraftPurchaseOrderInput = Schema.Struct({
  supplierAccountId: Uuid,
  lines: Schema.Array(
    Schema.Struct({
      productId: Uuid,
      quantity: Schema.String.check(Schema.isPattern(/^[1-9]\d*$/)),
      unitPrice: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^\d+(\.\d{1,2})?$/))),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
})

const StockDocumentInput = Schema.Struct({
  purchaseOrderId: Uuid,
  warehouseId: Uuid,
  date: CalendarDate,
  lines: Schema.Array(
    Schema.Struct({
      purchaseOrderLineId: Uuid,
      quantity: Schema.String.check(Schema.isPattern(/^[1-9]\d*$/)),
    }),
  ).check(Schema.isMinLength(1)),
})

const orders = "/procurement/purchase-orders"

export const draftPurchaseOrder = Effect.fn("Frontend.Procurement.draftPurchaseOrder")(function* (
  input: Schema.Codec.Encoded<typeof DraftPurchaseOrderInput>,
) {
  const decoded = yield* decodeInput(DraftPurchaseOrderInput, input)
  const body = yield* mutationRequest("/procurement/purchase-order-drafts", decoded)

  return yield* decodeResponse(PricedPurchaseOrder, body, "unknown-outcome")
})

export const getPurchaseMatching = Effect.fn("Frontend.Procurement.getPurchaseMatching")(function* (
  id: string,
) {
  const decoded = yield* decodeInput(Uuid, id)
  const body = yield* requestJson(routeWithId(`${orders}/:id/matching`, decoded))

  return yield* decodeResponse(PurchaseMatching, body)
})

export const releasePurchaseOrder = Effect.fn("Frontend.Procurement.releasePurchaseOrder")(
  function* (id: string) {
    const decoded = yield* decodeInput(Uuid, id)

    const body = yield* mutationRequest(routeWithId(`${orders}/:id/release`, decoded), {
      idempotencyKey: `release:${decoded}`,
    })

    return yield* decodeResponse(PurchaseMatching, body, "unknown-outcome")
  },
)

export const receiveValued = Effect.fn("Frontend.Procurement.receiveValued")(function* (
  input: Schema.Codec.Encoded<typeof StockDocumentInput>,
) {
  const decoded = yield* decodeInput(StockDocumentInput, input)

  const body = yield* mutationRequest(
    routeWithId(`${orders}/:id/valued-receipts`, decoded.purchaseOrderId),
    { warehouseId: decoded.warehouseId, receiptDate: decoded.date, lines: decoded.lines },
  )

  return yield* decodeResponse(StockDocument, body, "unknown-outcome")
})

export const returnToSupplier = Effect.fn("Frontend.Procurement.returnToSupplier")(function* (
  input: Schema.Codec.Encoded<typeof StockDocumentInput>,
) {
  const decoded = yield* decodeInput(StockDocumentInput, input)

  const body = yield* mutationRequest(
    routeWithId(`${orders}/:id/returns`, decoded.purchaseOrderId),
    { warehouseId: decoded.warehouseId, returnDate: decoded.date, lines: decoded.lines },
  )

  return yield* decodeResponse(StockDocument, body, "unknown-outcome")
})

/** What the user is told for the business failures drafting an order can return. */
export const draftFailureMessages = {
  SupplierAccountNotFound:
    "This supplier account is no longer available. Reload and choose another.",
  SupplierPriceNotFound:
    "A product has no price for this supplier. Enter a unit price on that line, or set a supplier price first.",
  PurchaseLineNotStockable: "A product on this order cannot be received into stock.",
  ProductNotFound: "A product on this order no longer exists.",
  PartyRelationshipNotFound: "This supplier is no longer an active supplier relationship.",
} as const

/** What the user is told for the business failures releasing an order can return. */
export const releaseFailureMessages = {
  PurchaseOrderApprovalRequired:
    "This order is above the approval limit and has an approval request pending. It can be released once the request is approved.",
  PurchaseOrderInvalidState: "Only draft orders can be released.",
  PurchaseOrderNotFound: "This purchase order is no longer available. Reload the workspace.",
  PurchaseOrderConfirmationIdempotencyConflict:
    "This order was released with different details. Reload the workspace.",
  PartyRelationshipNotFound: "This supplier is no longer an active supplier relationship.",
} as const

/** What the user is told for the business failures a receipt or return can return. */
export const stockFailureMessages = {
  PurchaseReceiptQuantityExceeded: "A line receives more than what is still to be received.",
  PurchaseReturnExceedsReceipt: "A line returns more than what was received and not yet returned.",
  PurchaseOrderInvalidState: "Only released orders can be received.",
  PurchaseOrderNotFound: "This purchase order is no longer available. Reload the workspace.",
  StockUnavailable: "There is not enough stock in this warehouse to return that quantity.",
  StockValuationUnavailable: "A product has no stock cost yet, so it cannot be returned.",
  InventoryReferenceNotFound: "A stockable product is not registered as an inventory item.",
  AccountingPeriodNotOpen: "The accounting period for that date is not open.",
  PostingRuleNotFound:
    "A posting rule is missing for this legal entity. Apply a chart template in Finance first.",
} as const

const SupplierPrice = Schema.Struct({ supplierAccountId: Uuid, productId: Uuid, unitPrice: Amount })

export type SupplierPrice = Schema.Schema.Type<typeof SupplierPrice>

const SupplierPriceList = Schema.Array(SupplierPrice).check(Schema.isMaxLength(500))

const SetSupplierPriceInput = Schema.Struct({
  supplierAccountId: Uuid,
  productId: Uuid,
  unitPrice: Schema.String.check(Schema.isPattern(/^\d+(\.\d{1,2})?$/)),
})

export const listSupplierPrices = Effect.fn("Frontend.Procurement.listSupplierPrices")(function* (
  supplierAccountId: string,
) {
  const decoded = yield* decodeInput(Uuid, supplierAccountId)

  const body = yield* requestJson(
    `/procurement/supplier-prices${querySuffix({ supplierAccountId: decoded })}`,
  )

  return yield* decodeResponse(SupplierPriceList, body)
})

export const setSupplierPrice = Effect.fn("Frontend.Procurement.setSupplierPrice")(function* (
  input: Schema.Codec.Encoded<typeof SetSupplierPriceInput>,
) {
  const decoded = yield* decodeInput(SetSupplierPriceInput, input)
  const body = yield* mutationRequest("/procurement/supplier-prices", decoded)

  return yield* decodeResponse(SupplierPrice, body, "unknown-outcome")
})

/** What the user is told for the business failures setting a supplier price can return. */
export const priceFailureMessages = {
  SupplierAccountNotFound: "This supplier account is no longer available. Reload the workspace.",
  ProductNotFound: "This product no longer exists. Reload the workspace.",
} as const
