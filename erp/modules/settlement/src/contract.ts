import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  CalendarDate,
  type DatabaseFailure,
  FinancialMajorAmount,
  Uuid,
  TrimmedText,
  SignedAmount,
} from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import type { PostEntryFailure } from "../../accounting/mod.ts"
import type {
  BillingDocumentNotFound,
  SettlementConflict,
  SettlementExceedsOpenAmount,
} from "../../billing/mod.ts"
import type * as SettlementErrors from "./errors.ts"

const Text = TrimmedText(128)
const ScopedInput = { principal: Principal, tenantId: Uuid }

export const SettlementSide = Schema.Literals(["receivable", "payable"])

export type SettlementSide = Schema.Schema.Type<typeof SettlementSide>

export const PaymentDirection = Schema.Literals(["incoming", "outgoing"])

export type PaymentDirection = Schema.Schema.Type<typeof PaymentDirection>

export const PaymentTerm = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  code: Schema.String,
  name: Text,
  netDays: Schema.Int,
})

export type PaymentTerm = Schema.Schema.Type<typeof PaymentTerm>

export const Allocation = Schema.Struct({ invoiceId: Uuid, amount: FinancialMajorAmount })

export const Payment = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  legalEntityId: Uuid,
  direction: PaymentDirection,
  partyId: Uuid,
  number: Schema.String,
  paymentDate: CalendarDate,
  amount: FinancialMajorAmount,
  unallocatedAmount: FinancialMajorAmount,
  cashAccountId: Schema.NullOr(Uuid),
  journalEntryId: Uuid,
  allocations: Schema.Array(Allocation),
})

export type Payment = Schema.Schema.Type<typeof Payment>

const Buckets = {
  current: SignedAmount,
  days1To30: SignedAmount,
  days31To60: SignedAmount,
  days61To90: SignedAmount,
  over90: SignedAmount,
  /** Credit notes and payments not yet applied to a document (negative). */
  unapplied: SignedAmount,
  total: SignedAmount,
}

export const AgingReport = Schema.Struct({
  legalEntityId: Uuid,
  side: SettlementSide,
  asOf: CalendarDate,
  rows: Schema.Array(Schema.Struct({ partyId: Uuid, ...Buckets })),
  totals: Schema.Struct(Buckets),
})

export type AgingReport = Schema.Schema.Type<typeof AgingReport>

export const StatementEntry = Schema.Struct({
  date: CalendarDate,
  kind: Schema.Literals(["invoice", "credit_note", "payment"]),
  documentId: Uuid,
  number: Schema.String,
  /** Increases what the customer owes when positive. */
  amount: SignedAmount,
  balance: SignedAmount,
})

export const CustomerStatement = Schema.Struct({
  legalEntityId: Uuid,
  partyId: Uuid,
  from: CalendarDate,
  to: CalendarDate,
  openingBalance: SignedAmount,
  entries: Schema.Array(StatementEntry),
  closingBalance: SignedAmount,
})

export type CustomerStatement = Schema.Schema.Type<typeof CustomerStatement>

export const CreatePaymentTermInput = Schema.Struct({
  ...ScopedInput,
  code: Text,
  name: Text,
  netDays: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3650 })),
})

export const AssignPartyTermInput = Schema.Struct({
  ...ScopedInput,
  partyId: Uuid,
  side: SettlementSide,
  paymentTermId: Uuid,
})

const PaymentFields = {
  ...ScopedInput,
  /** Client-chosen id that makes a retried command return the recorded payment. */
  paymentId: Schema.optionalKey(Uuid),
  legalEntityId: Uuid,
  partyId: Uuid,
  paymentDate: CalendarDate,
  amount: FinancialMajorAmount.check(
    Schema.makeFilter((value) => /[1-9]/.test(value), { expected: "a positive amount" }),
  ),
  /** The bank or cash account; the `cash` posting role when omitted. */
  cashAccountId: Schema.optionalKey(Uuid),
  allocations: Schema.Array(Allocation).check(
    Schema.makeFilter(
      (allocations) =>
        new Set(allocations.map((allocation) => allocation.invoiceId)).size === allocations.length,
      { expected: "each document is allocated once per payment" },
    ),
  ),
}

export const ReceivePaymentInput = Schema.Struct(PaymentFields)
export const MakePaymentInput = Schema.Struct(PaymentFields)

export const AllocatePaymentInput = Schema.Struct({
  ...ScopedInput,
  paymentId: Uuid,
  /** The business date of the allocation, never before the payment date. */
  allocatedOn: CalendarDate,
  allocations: Schema.Array(Allocation).check(Schema.isMinLength(1)),
})

export const AgingInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Uuid,
  side: SettlementSide,
  asOf: CalendarDate,
})

export const StatementInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Uuid,
  partyId: Uuid,
  from: CalendarDate,
  to: CalendarDate,
})

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

export type PaymentFailure =
  | SettlementErrors.AllocationBeforePayment
  | SettlementErrors.AllocationExceedsPayment
  | SettlementErrors.AllocationMismatch
  | SettlementErrors.PaymentNotFound
  | BillingDocumentNotFound
  | SettlementConflict
  | SettlementExceedsOpenAmount
  | PostEntryFailure
  | CommonFailure

/** Payments, allocations to billing documents, payment terms, aging, and statements (ADR-0102). */
export interface SettlementService {
  readonly createPaymentTerm: (
    input: Schema.Codec.Encoded<typeof CreatePaymentTermInput>,
  ) => Effect.Effect<PaymentTerm, SettlementErrors.PaymentTermAlreadyExists | CommonFailure>
  readonly assignPartyTerm: (
    input: Schema.Codec.Encoded<typeof AssignPartyTermInput>,
  ) => Effect.Effect<void, SettlementErrors.PaymentTermNotFound | CommonFailure>
  /** Records a customer receipt: cash against receivables, allocated to customer documents. */
  readonly receivePayment: (
    input: Schema.Codec.Encoded<typeof ReceivePaymentInput>,
  ) => Effect.Effect<Payment, PaymentFailure>
  /** Records a supplier payment: payables against cash, allocated to supplier documents. */
  readonly makePayment: (
    input: Schema.Codec.Encoded<typeof MakePaymentInput>,
  ) => Effect.Effect<Payment, PaymentFailure>
  /** Allocates the unallocated part of a recorded payment. */
  readonly allocatePayment: (
    input: Schema.Codec.Encoded<typeof AllocatePaymentInput>,
  ) => Effect.Effect<Payment, PaymentFailure>
  readonly aging: (
    input: Schema.Codec.Encoded<typeof AgingInput>,
  ) => Effect.Effect<AgingReport, CommonFailure>
  readonly customerStatement: (
    input: Schema.Codec.Encoded<typeof StatementInput>,
  ) => Effect.Effect<CustomerStatement, CommonFailure>
}

export const SettlementService = Context.Service<SettlementService>("RITSEI/SettlementService")
