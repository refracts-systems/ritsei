import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { decodeInput, decodeResponse, querySuffix, requestJson } from "../../shared/api.ts"
import {
  AccountingConfiguration,
  accountingRoutes,
} from "../../shared/contracts/generated/accounting.ts"
import { PartyDirectoryEntry, partyRoutes } from "../../shared/contracts/generated/party.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const CalendarDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))
const Amount = Schema.String.check(Schema.isPattern(/^-?\d+(\.\d+)?$/))

/** Browser view of the Settlement transport contract served by the settlement module. */
export const PaymentDirection = Schema.Literals(["incoming", "outgoing"])

export type PaymentDirection = Schema.Schema.Type<typeof PaymentDirection>

export const SettlementSide = Schema.Literals(["receivable", "payable"])

export type SettlementSide = Schema.Schema.Type<typeof SettlementSide>

const Payment = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  legalEntityId: Uuid,
  direction: PaymentDirection,
  partyId: Uuid,
  number: Schema.String,
  paymentDate: CalendarDate,
  amount: Amount,
  unallocatedAmount: Amount,
  allocations: Schema.Array(Schema.Struct({ invoiceId: Uuid, amount: Amount })).check(
    Schema.isMaxLength(1000),
  ),
})

export type Payment = Schema.Schema.Type<typeof Payment>

const BucketFields = {
  current: Amount,
  days1To30: Amount,
  days31To60: Amount,
  days61To90: Amount,
  over90: Amount,
  unapplied: Amount,
  total: Amount,
}

export const AgingReport = Schema.Struct({
  legalEntityId: Uuid,
  side: SettlementSide,
  asOf: CalendarDate,
  rows: Schema.Array(Schema.Struct({ partyId: Uuid, ...BucketFields })).check(
    Schema.isMaxLength(1000),
  ),
  totals: Schema.Struct(BucketFields),
})

export type AgingReport = Schema.Schema.Type<typeof AgingReport>

export const CustomerStatement = Schema.Struct({
  legalEntityId: Uuid,
  partyId: Uuid,
  from: CalendarDate,
  to: CalendarDate,
  openingBalance: Amount,
  entries: Schema.Array(
    Schema.Struct({
      date: CalendarDate,
      kind: Schema.Literals(["invoice", "credit_note", "payment"]),
      documentId: Uuid,
      number: Schema.String,
      amount: Amount,
      balance: Amount,
    }),
  ).check(Schema.isMaxLength(2000)),
  closingBalance: Amount,
})

export type CustomerStatement = Schema.Schema.Type<typeof CustomerStatement>

const PaymentList = Schema.Array(Payment).check(Schema.isMaxLength(200))
const ConfigurationList = Schema.Array(AccountingConfiguration).check(Schema.isMaxLength(200))
const PartyDirectory = Schema.Array(PartyDirectoryEntry).check(Schema.isMaxLength(200))

const DocumentNumbers = Schema.Array(
  Schema.Struct({ id: Uuid, number: Schema.String, partyId: Uuid }),
).check(Schema.isMaxLength(1000))

const ListPaymentsInput = Schema.Struct({ legalEntityId: Uuid, direction: PaymentDirection })

const AgingInput = Schema.Struct({
  legalEntityId: Uuid,
  side: SettlementSide,
  asOf: CalendarDate,
})

const StatementInput = Schema.Struct({
  legalEntityId: Uuid,
  partyId: Uuid,
  from: CalendarDate,
  to: CalendarDate,
})

const DocumentNumbersInput = Schema.Struct({ legalEntityId: Uuid, side: SettlementSide })

export const listPayments = Effect.fn("Frontend.Settlement.listPayments")(function* (
  input: Schema.Codec.Encoded<typeof ListPaymentsInput>,
) {
  const decoded = yield* decodeInput(ListPaymentsInput, input)
  const body = yield* requestJson(`/settlement/payments${querySuffix({ ...decoded, limit: 100 })}`)

  return yield* decodeResponse(PaymentList, body)
})

export const getAging = Effect.fn("Frontend.Settlement.getAging")(function* (
  input: Schema.Codec.Encoded<typeof AgingInput>,
) {
  const decoded = yield* decodeInput(AgingInput, input)
  const body = yield* requestJson(`/settlement/aging${querySuffix(decoded)}`)

  return yield* decodeResponse(AgingReport, body)
})

export const getStatement = Effect.fn("Frontend.Settlement.getStatement")(function* (
  input: Schema.Codec.Encoded<typeof StatementInput>,
) {
  const decoded = yield* decodeInput(StatementInput, input)
  const body = yield* requestJson(`/settlement/statements${querySuffix(decoded)}`)

  return yield* decodeResponse(CustomerStatement, body)
})

/** Legal entities that accounting is configured for; payments belong to one of them. */
export const listLegalEntities = Effect.fn("Frontend.Settlement.listLegalEntities")(function* () {
  const body = yield* requestJson(accountingRoutes.listConfigurations)

  return yield* decodeResponse(ConfigurationList, body)
})

export const listPartyDirectory = Effect.fn("Frontend.Settlement.listPartyDirectory")(function* () {
  const body = yield* requestJson(`${partyRoutes.list}${querySuffix({ limit: 200 })}`)

  return yield* decodeResponse(PartyDirectory, body)
})

/** Document numbers by id, so allocations show which document they settled. */
export const listDocumentNumbers = Effect.fn("Frontend.Settlement.listDocumentNumbers")(function* (
  input: Schema.Codec.Encoded<typeof DocumentNumbersInput>,
) {
  const decoded = yield* decodeInput(DocumentNumbersInput, input)
  const body = yield* requestJson(`/billing/documents${querySuffix(decoded)}`)

  return yield* decodeResponse(DocumentNumbers, body)
})
