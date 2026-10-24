import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { Amount, CalendarDate, Uuid } from "../../shared/schemas.ts"
import {
  decodeInput,
  decodeResponse,
  mutationRequest,
  querySuffix,
  requestJson,
  routeWithId,
} from "../../shared/api.ts"
import {
  AccountingConfiguration,
  accountingRoutes,
} from "../../shared/contracts/generated/accounting.ts"
import { PurchaseOrder, procurementRoutes } from "../../shared/contracts/generated/procurement.ts"
import { Customer, SalesOrder, salesRoutes } from "../../shared/contracts/generated/sales.ts"

/** Browser view of the Billing transport contract served by the billing module. */
export const BillingSide = Schema.Literals(["receivable", "payable"])

const InvoiceKind = Schema.Literals([
  "customer_invoice",
  "customer_credit_note",
  "supplier_bill",
  "supplier_credit_note",
])

const BillingDocumentLine = Schema.Struct({
  id: Uuid,
  productId: Schema.NullOr(Uuid),
  description: Schema.String,
  quantity: Schema.String,
  unitPrice: Amount,
  netAmount: Amount,
  taxCodeId: Schema.NullOr(Uuid),
  taxAmount: Amount,
})

export const BillingDocument = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  legalEntityId: Uuid,
  kind: InvoiceKind,
  partyId: Uuid,
  number: Schema.String,
  invoiceDate: CalendarDate,
  subtotal: Amount,
  taxTotal: Amount,
  total: Amount,
  openAmount: Amount,
  sourceType: Schema.NullOr(Schema.String),
  sourceId: Schema.NullOr(Uuid),
  creditedInvoiceId: Schema.NullOr(Uuid),
  supplierReference: Schema.NullOr(Schema.String),
  lines: Schema.Array(BillingDocumentLine).check(Schema.isMaxLength(1000)),
})

export type BillingDocument = Schema.Schema.Type<typeof BillingDocument>

export type BillingSide = Schema.Schema.Type<typeof BillingSide>

const BillingDocumentList = Schema.Array(BillingDocument).check(Schema.isMaxLength(1000))
const ConfigurationList = Schema.Array(AccountingConfiguration).check(Schema.isMaxLength(200))

const ListDocumentsInput = Schema.Struct({
  legalEntityId: Uuid,
  side: Schema.optionalKey(BillingSide),
})

const documentsRoute = "/billing/documents"

export const listBillingDocuments = Effect.fn("Frontend.Billing.listBillingDocuments")(function* (
  input: Schema.Codec.Encoded<typeof ListDocumentsInput>,
) {
  const decoded = yield* decodeInput(ListDocumentsInput, input)
  const body = yield* requestJson(`${documentsRoute}${querySuffix(decoded)}`)

  return yield* decodeResponse(BillingDocumentList, body)
})

export const getBillingDocument = Effect.fn("Frontend.Billing.getBillingDocument")(function* (
  id: string,
) {
  const decoded = yield* decodeInput(Uuid, id)
  const body = yield* requestJson(routeWithId(`${documentsRoute}/:id`, decoded))

  return yield* decodeResponse(BillingDocument, body)
})

/** Legal entities that accounting is configured for; billing documents belong to one of them. */
export const listLegalEntities = Effect.fn("Frontend.Billing.listLegalEntities")(function* () {
  const body = yield* requestJson(accountingRoutes.listConfigurations)

  return yield* decodeResponse(ConfigurationList, body)
})

const OrderList = Schema.Array(SalesOrder).check(Schema.isMaxLength(200))
const CustomerList = Schema.Array(Customer).check(Schema.isMaxLength(200))
const InvoiceOrderInput = Schema.Struct({ orderId: Uuid, invoiceDate: CalendarDate })

/** Confirmed orders are the ones that can have delivered quantities to invoice. */
export const listConfirmedOrders = Effect.fn("Frontend.Billing.listConfirmedOrders")(function* () {
  const body = yield* requestJson(
    `${salesRoutes.listOrders}${querySuffix({ status: "confirmed", limit: 200 })}`,
  )

  return yield* decodeResponse(OrderList, body)
})

export const listCustomers = Effect.fn("Frontend.Billing.listCustomers")(function* () {
  const body = yield* requestJson(`${salesRoutes.listCustomers}${querySuffix({ limit: 200 })}`)

  return yield* decodeResponse(CustomerList, body)
})

export const invoiceSalesOrder = Effect.fn("Frontend.Billing.invoiceSalesOrder")(function* (
  input: Schema.Codec.Encoded<typeof InvoiceOrderInput>,
) {
  const decoded = yield* decodeInput(InvoiceOrderInput, input)
  const body = yield* mutationRequest("/billing/invoices", decoded)

  return yield* decodeResponse(BillingDocument, body, "unknown-outcome")
})

/** What the user is told for the business failures invoicing can return. */
export const invoiceFailureMessages = {
  NothingToInvoice:
    "Nothing is left to invoice on this order. Deliver goods first, or everything delivered is already invoiced.",
  SalesOrderInvalidState: "Only confirmed orders can be invoiced.",
  SalesOrderNotFound: "This order is no longer available. Reload and choose another.",
  CustomerLegalEntityRequired: "This customer is not linked to a legal entity yet.",
  AccountingPeriodNotOpen: "The accounting period for that invoice date is not open.",
  PostingRuleNotFound:
    "A posting rule is missing for this legal entity. Apply a chart template in Finance first.",
  AccountingLegalEntityNotFound: "This legal entity is not configured for accounting.",
  TaxCodeNotFound: "A tax code used by this order no longer exists.",
  ProductNotFound: "A product on this order no longer exists.",
} as const

const Money = Schema.String.check(Schema.isPattern(/^\d+(\.\d{1,2})?$/))

const RecordPaymentInput = Schema.Struct({
  side: BillingSide,
  legalEntityId: Uuid,
  partyId: Uuid,
  invoiceId: Uuid,
  paymentDate: CalendarDate,
  amount: Money,
})

const RecordedPayment = Schema.Struct({
  id: Uuid,
  number: Schema.String,
  amount: Amount,
  unallocatedAmount: Amount,
})

export type RecordedPayment = Schema.Schema.Type<typeof RecordedPayment>

/** Receives (receivable) or makes (payable) a payment that settles one billing document. */
export const recordPayment = Effect.fn("Frontend.Billing.recordPayment")(function* (
  input: Schema.Codec.Encoded<typeof RecordPaymentInput>,
) {
  const decoded = yield* decodeInput(RecordPaymentInput, input)

  const body = yield* mutationRequest(
    decoded.side === "receivable" ? "/settlement/receipts" : "/settlement/payments",
    {
      legalEntityId: decoded.legalEntityId,
      partyId: decoded.partyId,
      paymentDate: decoded.paymentDate,
      amount: decoded.amount,
      allocations: [{ invoiceId: decoded.invoiceId, amount: decoded.amount }],
    },
  )

  return yield* decodeResponse(RecordedPayment, body, "unknown-outcome")
})

/** What the user is told for the business failures a payment can return. */
export const paymentFailureMessages = {
  SettlementExceedsOpenAmount: "The amount is more than what is still open on this document.",
  SettlementConflict: "This document was settled by another change. Reload and try again.",
  BillingDocumentNotFound: "This document is no longer available. Reload the workspace.",
  AllocationMismatch: "This document belongs to a different party or side than the payment.",
  AccountingPeriodNotOpen: "The accounting period for that payment date is not open.",
  PostingRuleNotFound:
    "A posting rule (cash or receivables) is missing. Apply a chart template in Finance first.",
  AccountingLegalEntityNotFound: "This legal entity is not configured for accounting.",
} as const

const PurchaseOrderList = Schema.Array(PurchaseOrder).check(Schema.isMaxLength(200))

const OrderMatching = Schema.Struct({
  purchaseOrderId: Uuid,
  partyId: Uuid,
  legalEntityId: Uuid,
  lines: Schema.Array(
    Schema.Struct({
      purchaseOrderLineId: Uuid,
      productId: Uuid,
      ordered: Schema.String,
      received: Schema.String,
      returned: Schema.String,
      unitPrice: Amount,
    }),
  ).check(Schema.isMaxLength(200)),
})

export type OrderMatching = Schema.Schema.Type<typeof OrderMatching>

const BillOrderInput = Schema.Struct({
  purchaseOrderId: Uuid,
  billDate: CalendarDate,
  supplierReference: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  lines: Schema.Array(
    Schema.Struct({
      purchaseOrderLineId: Uuid,
      quantity: Schema.String.check(Schema.isPattern(/^[1-9]\d*$/)),
      unitPrice: Schema.String.check(Schema.isPattern(/^\d+(\.\d{1,2})?$/)),
    }),
  ).check(Schema.isMinLength(1)),
})

/** Released orders are the ones with goods that can have been received and billed. */
export const listReleasedOrders = Effect.fn("Frontend.Billing.listReleasedOrders")(function* () {
  const body = yield* requestJson(
    `${procurementRoutes.listPurchaseOrders}${querySuffix({ status: "confirmed", limit: 200 })}`,
  )

  return yield* decodeResponse(PurchaseOrderList, body)
})

export const getOrderMatching = Effect.fn("Frontend.Billing.getOrderMatching")(function* (
  id: string,
) {
  const decoded = yield* decodeInput(Uuid, id)
  const body = yield* requestJson(routeWithId("/procurement/purchase-orders/:id/matching", decoded))

  return yield* decodeResponse(OrderMatching, body)
})

export const billPurchaseOrder = Effect.fn("Frontend.Billing.billPurchaseOrder")(function* (
  input: Schema.Codec.Encoded<typeof BillOrderInput>,
) {
  const decoded = yield* decodeInput(BillOrderInput, input)
  const body = yield* mutationRequest("/billing/supplier-bills", decoded)

  return yield* decodeResponse(BillingDocument, body, "unknown-outcome")
})

/** What the user is told for the business failures billing a purchase order can return. */
export const billFailureMessages = {
  BillExceedsReceipt:
    "This bills more than was received and not yet billed. Receive the goods first, or lower the quantity.",
  NothingToInvoice: "Nothing is left to bill on this order.",
  PurchaseOrderInvalidState: "Only released orders can be billed.",
  PurchaseOrderNotFound: "This purchase order is no longer available. Reload and choose another.",
  PartyRelationshipNotFound: "This supplier is no longer an active supplier relationship.",
  AccountingPeriodNotOpen: "The accounting period for that bill date is not open.",
  PostingRuleNotFound:
    "A posting rule is missing for this legal entity. Apply a chart template in Finance first.",
  TaxCodeNotFound: "A tax code used by this order no longer exists.",
  ProductNotFound: "A product on this order no longer exists.",
} as const
