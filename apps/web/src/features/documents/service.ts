import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { decodeInput, decodeResponse, querySuffix, requestJson } from "../../shared/api.ts"
import { Uuid } from "../../shared/schemas.ts"

/** Browser view of the Documents transport contract served by the runtime API. */
export const FlowEntryType = Schema.Literals([
  "sales.quotation",
  "sales.order",
  "billing.document",
  "procurement.purchase_order",
])

export type FlowEntryType = Schema.Schema.Type<typeof FlowEntryType>

const DocumentNodeType = Schema.Literals([
  "sales.quotation",
  "sales.order",
  "sales.delivery",
  "billing.customer_invoice",
  "billing.customer_credit_note",
  "settlement.payment",
  "procurement.purchase_order",
  "procurement.receipt",
  "billing.supplier_bill",
  "billing.supplier_credit_note",
])

export type DocumentNodeType = Schema.Schema.Type<typeof DocumentNodeType>

export const DocumentNode = Schema.Struct({
  type: DocumentNodeType,
  id: Uuid,
  number: Schema.NullOr(Schema.String),
  state: Schema.String,
  amount: Schema.NullOr(Schema.String),
  date: Schema.NullOr(Schema.String),
  current: Schema.Boolean,
})

export type DocumentNode = Schema.Schema.Type<typeof DocumentNode>

export const DocumentChain = Schema.Struct({
  legalEntityId: Schema.NullOr(Uuid),
  nodes: Schema.Array(DocumentNode).check(Schema.isMaxLength(200)),
})

export type DocumentChain = Schema.Schema.Type<typeof DocumentChain>

const ChainInput = Schema.Struct({
  documentType: FlowEntryType,
  documentId: Uuid,
})

export const loadDocumentChain = Effect.fn("Frontend.Documents.loadDocumentChain")(function* (
  input: Schema.Codec.Encoded<typeof ChainInput>,
) {
  const decoded = yield* decodeInput(ChainInput, input)
  const body = yield* requestJson(`/documents/chain${querySuffix(decoded)}`)

  return yield* decodeResponse(DocumentChain, body)
})

export const nodeKinds: Readonly<Record<DocumentNodeType, string>> = {
  "sales.quotation": "Quotation",
  "sales.order": "Sales order",
  "sales.delivery": "Delivery",
  "billing.customer_invoice": "Invoice",
  "billing.customer_credit_note": "Credit note",
  "settlement.payment": "Payment",
  "procurement.purchase_order": "Purchase order",
  "procurement.receipt": "Goods receipt",
  "billing.supplier_bill": "Supplier bill",
  "billing.supplier_credit_note": "Supplier credit note",
}

type HrefBuilder = (id: string, legalEntityId: string | null) => string | undefined

const billingHref =
  (side: "receivable" | "payable"): HrefBuilder =>
  (id, legalEntityId) =>
    legalEntityId === null
      ? undefined
      : `/billing/${id}?${new URLSearchParams({ legalEntityId, side })}`

const hrefBuilders: Readonly<Partial<Record<DocumentNodeType, HrefBuilder>>> = {
  "sales.quotation": (id) => `/sales/quotations/${id}`,
  "sales.order": (id) => `/sales/orders/${id}`,
  "procurement.purchase_order": (id) => `/procurement/${id}`,
  "billing.customer_invoice": billingHref("receivable"),
  "billing.customer_credit_note": billingHref("receivable"),
  "billing.supplier_bill": billingHref("payable"),
  "billing.supplier_credit_note": billingHref("payable"),
}

/** The workspace page of a document, for the kinds that have one. */
export const nodeHref = (node: DocumentNode, legalEntityId: string | null): string | undefined =>
  hrefBuilders[node.type]?.(encodeURIComponent(node.id), legalEntityId)
