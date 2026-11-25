import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  CalendarDate,
  type DatabaseFailure,
  FinancialMajorAmount,
  Uuid,
  PositiveQuantity,
  SignedAmount,
  DottedName,
  TrimmedText,
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

const Quantity = PositiveQuantity
const SourceType = DottedName
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
  /** Value cleared from goods received not invoiced; zero outside supplier documents. */
  matchedValue: FinancialMajorAmount,
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
  /** The business date the amount is applied, which open items as of a date respect. */
  settledOn: CalendarDate,
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
  /** Only documents raised from this source document, or crediting this invoice. */
  sourceId: Schema.optionalKey(Uuid),
  creditedInvoiceId: Schema.optionalKey(Uuid),
})

export const NumberLookupInput = Schema.Struct({ ...ScopedInput, number: TrimmedText(64) })

/** A document found by its number: where to open it, not proof that the caller may. */
export const NumberCandidate = Schema.Struct({
  type: Schema.Literals([
    "billing.customer_invoice",
    "billing.customer_credit_note",
    "billing.supplier_bill",
    "billing.supplier_credit_note",
  ]),
  id: Uuid,
  number: Schema.String,
  legalEntityId: Uuid,
})

export type NumberCandidate = Schema.Schema.Type<typeof NumberCandidate>

export const PipelineFactsInput = Schema.Struct({ ...ScopedInput, legalEntityId: Uuid })

export const BillMismatchInput = Schema.Struct({ ...ScopedInput, legalEntityId: Uuid })

/** An open supplier bill whose billed value differs from the value cleared against receipts. */
export const BillMismatch = Schema.Struct({
  invoiceId: Uuid,
  number: Schema.String,
  partyId: Uuid,
  invoiceDate: CalendarDate,
  billed: FinancialMajorAmount,
  matched: FinancialMajorAmount,
  difference: SignedAmount,
})

export type BillMismatch = Schema.Schema.Type<typeof BillMismatch>

export const NetSalesInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Uuid,
  from: CalendarDate,
  to: CalendarDate,
})

/** Customer invoices less customer credit notes dated in a period, before tax. */
export const NetSales = Schema.Struct({
  legalEntityId: Uuid,
  from: CalendarDate,
  to: CalendarDate,
  netSales: SignedAmount,
})

export type NetSales = Schema.Schema.Type<typeof NetSales>

/** How many documents are at a stage, and the invoice date of the oldest. */
export const StageFacts = Schema.Struct({
  count: Schema.Int,
  oldestDate: Schema.NullOr(CalendarDate),
})

/** Invoices and bills of one legal entity by whether anything is still open (Yard, E3). */
export const BillingPipelineFacts = Schema.Struct({
  customerInvoiced: StageFacts,
  customerPaid: StageFacts,
  supplierBilled: StageFacts,
  supplierPaid: StageFacts,
})

export type BillingPipelineFacts = Schema.Schema.Type<typeof BillingPipelineFacts>

export const BilledQuantitiesInput = Schema.Struct({
  ...ScopedInput,
  side: BillingSide,
  sourceLineIds: Schema.Array(Uuid).check(Schema.isMaxLength(5000)),
})

/** The quantity billed per order line (receivable) or purchase order line (payable, net of credits). */
export const BilledQuantity = Schema.Struct({ sourceLineId: Uuid, quantity: Schema.String })

export type BilledQuantity = Schema.Schema.Type<typeof BilledQuantity>

/** The most bytes of one retained source document; the database enforces the same limit. */
export const MaxImportedArtifactBytes = 10_485_760

// The base64 text of the largest document, so an oversized payload is refused before it is decoded.
const MaxImportedArtifactBase64 = Math.ceil(MaxImportedArtifactBytes / 3) * 4

const ImportedArtifactContent = Schema.String.check(
  Schema.isMaxLength(MaxImportedArtifactBase64),
).pipe(
  Schema.decodeTo(
    Schema.Uint8ArrayFromBase64.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(MaxImportedArtifactBytes),
    ),
  ),
)

/** A lowercase slug naming the system that issued the document, such as `legacy_erp`. */
const SourceSystem = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9._-]*$/),
  Schema.isMaxLength(64),
)

const Filename = TrimmedText(255).check(Schema.isPattern(/^[^/\\\p{Cc}]+$/u))

const MediaType = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/),
  Schema.isMaxLength(127),
)

/** What is known about retained bytes; the bytes themselves leave only through a read. */
export const ImportedArtifact = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  invoiceId: Schema.NullOr(Uuid),
  sourceSystem: SourceSystem,
  sourceReference: TrimmedText(256),
  filename: Filename,
  mediaType: MediaType,
  /** SHA-256 of the bytes as lowercase hex, computed by the server. */
  contentHash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  byteSize: Schema.Int,
  importedBy: Schema.String,
})

export type ImportedArtifact = Schema.Schema.Type<typeof ImportedArtifact>

export const ImportArtifactResult = Schema.Struct({
  /** True when the same source document was retained before and its record is returned. */
  duplicate: Schema.Boolean,
  artifact: ImportedArtifact,
})

export type ImportArtifactResult = Schema.Schema.Type<typeof ImportArtifactResult>

/** A retained document with its bytes, for download. */
export const ImportedArtifactDownload = Schema.Struct({
  ...ImportedArtifact.fields,
  content: Schema.Uint8ArrayFromBase64,
})

export type ImportedArtifactDownload = Schema.Schema.Type<typeof ImportedArtifactDownload>

/**
 * Retains the bytes of a document the incumbent system issued (ADR-0120). The hash is computed
 * from the bytes, never taken from the caller.
 */
export const ImportArtifactInput = Schema.Struct({
  ...ScopedInput,
  sourceSystem: SourceSystem,
  sourceReference: TrimmedText(256),
  /** The posted invoice the bytes evidence, when RITSEI holds one. */
  invoiceId: Schema.optionalKey(Uuid),
  filename: Filename,
  mediaType: MediaType,
  /** The document bytes as base64 text. */
  content: ImportedArtifactContent,
})

export const GetImportedArtifactInput = Schema.Struct({ ...ScopedInput, artifactId: Uuid })

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

/**
 * Posted invoices, credit notes, and supplier bills with their open amounts (ADR-0102), and the
 * retained bytes of documents an incumbent system issued (ADR-0120).
 */
export interface BillingService {
  /** Invoices the delivered, not yet invoiced quantities of a confirmed sales order. */
  readonly invoiceSalesOrder: (
    input: Schema.Codec.Encoded<typeof InvoiceSalesOrderInput>,
  ) => Effect.Effect<BillingDocument, InvoiceFailure>
  /** Bills received purchase order quantities; the price difference posts as variance. */
  readonly billPurchaseOrder: (
    input: Schema.Codec.Encoded<typeof BillPurchaseOrderInput>,
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
    input: Schema.Codec.Encoded<typeof CreditInvoiceInput>,
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
    input: Schema.Codec.Encoded<typeof ApplySettlementInput>,
  ) => Effect.Effect<
    BillingDocument,
    | BillingErrors.BillingDocumentNotFound
    | BillingErrors.SettlementExceedsOpenAmount
    | BillingErrors.SettlementConflict
    | CommonFailure
  >
  readonly getDocument: (
    input: Schema.Codec.Encoded<typeof GetBillingDocumentInput>,
  ) => Effect.Effect<BillingDocument, BillingErrors.BillingDocumentNotFound | CommonFailure>
  readonly listDocuments: (
    input: Schema.Codec.Encoded<typeof ListBillingDocumentsInput>,
  ) => Effect.Effect<ReadonlyArray<BillingDocument>, CommonFailure>
  readonly listOpenItems: (
    input: Schema.Codec.Encoded<typeof ListOpenItemsInput>,
  ) => Effect.Effect<ReadonlyArray<OpenItem>, CommonFailure>
  /** The invoices, credit notes, and bills with exactly this number, in any legal entity. */
  readonly findByNumber: (
    input: Schema.Codec.Encoded<typeof NumberLookupInput>,
  ) => Effect.Effect<ReadonlyArray<NumberCandidate>, CommonFailure>
  /** Counts of customer invoices and supplier bills that are open or settled, with the oldest date. */
  readonly getPipelineFacts: (
    input: Schema.Codec.Encoded<typeof PipelineFactsInput>,
  ) => Effect.Effect<BillingPipelineFacts, CommonFailure>
  /** Open supplier bills that differ from what was received, largest difference first. */
  readonly listBillMismatches: (
    input: Schema.Codec.Encoded<typeof BillMismatchInput>,
  ) => Effect.Effect<ReadonlyArray<BillMismatch>, CommonFailure>
  /** What was sold in a period: invoice subtotals less credit note subtotals, by document date. */
  readonly netSales: (
    input: Schema.Codec.Encoded<typeof NetSalesInput>,
  ) => Effect.Effect<NetSales, CommonFailure>
  /** What the given order or purchase order lines have been billed so far. */
  readonly billedQuantities: (
    input: Schema.Codec.Encoded<typeof BilledQuantitiesInput>,
  ) => Effect.Effect<ReadonlyArray<BilledQuantity>, CommonFailure>
  /**
   * Retains the bytes of a document the source system issued. One record per tenant, source system,
   * and source reference: a replay with the same evidence returns the record, different evidence
   * fails. It never renders and never touches rendered invoice artifacts.
   */
  readonly importArtifact: (
    input: Schema.Codec.Encoded<typeof ImportArtifactInput>,
  ) => Effect.Effect<
    ImportArtifactResult,
    BillingErrors.BillingDocumentNotFound | BillingErrors.ImportedArtifactConflict | CommonFailure
  >
  /** Returns a retained document with its bytes, under the document read capability. */
  readonly getImportedArtifact: (
    input: Schema.Codec.Encoded<typeof GetImportedArtifactInput>,
  ) => Effect.Effect<
    ImportedArtifactDownload,
    BillingErrors.ImportedArtifactNotFound | CommonFailure
  >
}

export const BillingService = Context.Service<BillingService>("RITSEI/BillingService")
