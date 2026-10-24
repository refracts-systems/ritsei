import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
  decodeInput,
  decodeResponse,
  querySuffix,
  requestJson,
  routeWithId,
} from "../../shared/api.ts"
import {
  AccountingConfiguration,
  accountingRoutes,
} from "../../shared/contracts/generated/accounting.ts"
import { PartyDirectoryEntry, partyRoutes } from "../../shared/contracts/generated/party.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const CalendarDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))
const Amount = Schema.String.check(Schema.isPattern(/^-?\d+(\.\d+)?$/))

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
const PartyDirectory = Schema.Array(PartyDirectoryEntry).check(Schema.isMaxLength(200))

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

/** Party names, so documents show who they are for and legal entities show their organization. */
export const listPartyDirectory = Effect.fn("Frontend.Billing.listPartyDirectory")(function* () {
  const body = yield* requestJson(`${partyRoutes.list}${querySuffix({ limit: 200 })}`)

  return yield* decodeResponse(PartyDirectory, body)
})
