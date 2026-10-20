import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  CalendarDate,
  type DatabaseFailure,
  FinancialMajorAmount,
} from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import type { PostEntryFailure } from "../../accounting/mod.ts"
import type { ProductNotFound } from "../../product/mod.ts"
import type {
  CustomerLegalEntityRequired,
  SalesOrderInvalidState,
  SalesOrderNotFound,
} from "../../sales/mod.ts"
import type { PartyRelationshipNotFound } from "../../party/mod.ts"
import type { PurchaseOrderInvalidState, PurchaseOrderNotFound } from "../../procurement/mod.ts"
import type { TaxCodeNotFound } from "../../tax/mod.ts"
import type * as BillingErrors from "./errors.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const Quantity = Schema.String.check(
  Schema.makeFilter(
    (value) => /^[1-9]\d*$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n,
    { expected: "a positive PostgreSQL bigint quantity" },
  ),
)
const SignedAmount = Schema.String.check(Schema.isPattern(/^-?\d{1,20}\.\d{2}$/))
const SourceType = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_.]*$/))
const ScopedInput = { principal: Principal, tenantId: Uuid }

export const InvoiceKind = Schema.Literals([
  "customer_invoice",
  "customer_credit_note",
  "supplier_bill",
  "supplier_credit_note",
])
export type InvoiceKind = Schema.Schema.Type<typeof InvoiceKind>

/** Receivable documents raise what customers owe; payable documents what is owed to suppliers. */
export const BillingSide = Schema.Literals(["receivable", "payable"])
export type BillingSide = Schema.Schema.Type<typeof BillingSide>

export const sideOf = (kind: InvoiceKind): BillingSide =>
  kind === "customer_invoice" || kind === "customer_credit_note" ? "receivable" : "payable"
export const isCreditNote = (kind: InvoiceKind) =>
  kind === "customer_credit_note" || kind === "supplier_credit_note"

export const BillingDocumentLine = Schema.Struct({
  id: Uuid,
  productId: Schema.NullOr(Uuid),
  description: Schema.String,
  quantity: Quantity,
  unitPrice: FinancialMajorAmount,
  netAmount: FinancialMajorAmount,
  taxCodeId: Schema.NullOr(Uuid),
  taxAmount: FinancialMajorAmount,
  sourceLineId: Schema.NullOr(Uuid),
})

export const BillingDocument = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  legalEntityId: Uuid,
  kind: InvoiceKind,
  partyId: Uuid,
  number: Schema.String,
  invoiceDate: CalendarDate,
  subtotal: FinancialMajorAmount,
  taxTotal: FinancialMajorAmount,
  total: FinancialMajorAmount,
  openAmount: FinancialMajorAmount,
  sourceType: Schema.NullOr(SourceType),
  sourceId: Schema.NullOr(Uuid),
  creditedInvoiceId: Schema.NullOr(Uuid),
  supplierReference: Schema.NullOr(Schema.String),
  journalEntryId: Uuid,
  lines: Schema.Array(BillingDocumentLine),
})
export type BillingDocument = Schema.Schema.Type<typeof BillingDocument>

/** An open document; credit notes carry a negative open amount. */
export const OpenItem = Schema.Struct({
  invoiceId: Uuid,
  kind: InvoiceKind,
  number: Schema.String,
  partyId: Uuid,
  invoiceDate: CalendarDate,
  total: FinancialMajorAmount,
  openAmount: SignedAmount,
})
export type OpenItem = Schema.Schema.Type<typeof OpenItem>

export const InvoiceSalesOrderInput = Schema.Struct({
  ...ScopedInput,
  orderId: Uuid,
  invoiceDate: CalendarDate,
  /** Client-chosen id that makes a retried command return the posted invoice. */
  invoiceId: Schema.optionalKey(Uuid),
})
/** A supplier bill matched against a purchase order and its receipts (three-way match). */
export const BillPurchaseOrderInput = Schema.Struct({
  ...ScopedInput,
  /** Client-chosen id; an approved variance request is keyed by it. */
  billId: Schema.optionalKey(Uuid),
  purchaseOrderId: Uuid,
  billDate: CalendarDate,
  supplierReference: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  lines: Schema.Array(
    Schema.Struct({
      purchaseOrderLineId: Uuid,
      quantity: Quantity,
      unitPrice: FinancialMajorAmount,
    }),
  ).check(Schema.isMinLength(1)),
})

/** Approval subject for billing more than was received. */
export const BillVarianceSubject = "billing.supplier_bill_variance"

export const CreditInvoiceInput = Schema.Struct({
  ...ScopedInput,
  invoiceId: Uuid,
  creditNoteId: Schema.optionalKey(Uuid),
  creditDate: CalendarDate,
  lines: Schema.Array(Schema.Struct({ invoiceLineId: Uuid, quantity: Quantity })).check(
    Schema.isMinLength(1),
  ),
})
export const ApplySettlementInput = Schema.Struct({
  ...ScopedInput,
  invoiceId: Uuid,
  amount: FinancialMajorAmount,
  source: Schema.Struct({ type: SourceType, id: Uuid }),
})
export const GetBillingDocumentInput = Schema.Struct({ ...ScopedInput, invoiceId: Uuid })
export const ListOpenItemsInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Uuid,
  side: BillingSide,
  partyId: Schema.optionalKey(Uuid),
  asOf: CalendarDate,
})
export const ListBillingDocumentsInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Uuid,
  partyId: Schema.optionalKey(Uuid),
  side: Schema.optionalKey(BillingSide),
  to: Schema.optionalKey(CalendarDate),
})

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

export type InvoiceFailure =
  | BillingErrors.NothingToInvoice
  | SalesOrderNotFound
  | SalesOrderInvalidState
  | CustomerLegalEntityRequired
  | ProductNotFound
  | TaxCodeNotFound
  | PostEntryFailure
  | CommonFailure

/** Posted invoices, credit notes, and supplier bills with their open amounts (ADR-0102). */
export interface BillingService {
  /** Invoices the delivered, not yet invoiced quantities of a confirmed sales order. */
  readonly invoiceSalesOrder: (input: unknown) => Effect.Effect<BillingDocument, InvoiceFailure>
  /** Bills received purchase order quantities; the price difference posts as variance. */
  readonly billPurchaseOrder: (
    input: unknown,
  ) => Effect.Effect<
    BillingDocument,
    | BillingErrors.BillExceedsReceipt
    | BillingErrors.NothingToInvoice
    | PurchaseOrderNotFound
    | PurchaseOrderInvalidState
    | PartyRelationshipNotFound
    | ProductNotFound
    | TaxCodeNotFound
    | PostEntryFailure
    | CommonFailure
  >
  /** Credits invoice lines and applies the credit to the invoice's open amount. */
  readonly creditInvoice: (
    input: unknown,
  ) => Effect.Effect<
    BillingDocument,
    | BillingErrors.BillingDocumentNotFound
    | BillingErrors.CreditExceedsInvoice
    | TaxCodeNotFound
    | PostEntryFailure
    | CommonFailure
  >
  /** Reduces a document's open amount for a payment or other settlement source. */
  readonly applySettlement: (
    input: unknown,
  ) => Effect.Effect<
    BillingDocument,
    | BillingErrors.BillingDocumentNotFound
    | BillingErrors.SettlementExceedsOpenAmount
    | BillingErrors.SettlementConflict
    | CommonFailure
  >
  readonly getDocument: (
    input: unknown,
  ) => Effect.Effect<BillingDocument, BillingErrors.BillingDocumentNotFound | CommonFailure>
  readonly listDocuments: (
    input: unknown,
  ) => Effect.Effect<ReadonlyArray<BillingDocument>, CommonFailure>
  readonly listOpenItems: (input: unknown) => Effect.Effect<ReadonlyArray<OpenItem>, CommonFailure>
}

export const BillingService = Context.Service<BillingService>("RITSEI/BillingService")
