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
import type {
  AccountingLegalEntityNotFound,
  AccountNotFound,
  PostEntryFailure,
} from "../../accounting/mod.ts"
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

const PositiveAmount = FinancialMajorAmount.check(
  Schema.makeFilter((value) => /[1-9]/.test(value), { expected: "a positive amount" }),
)

/**
 * Tax the payer withheld from a receipt, kept as a claim on `accountId`. It settles receivables
 * together with the cash but is not cash received; settlement computes no tax (ADR-0116).
 */
export const Withholding = Schema.Struct({
  amount: PositiveAmount,
  /** The payer's withholding certificate number. */
  certificateReference: Text,
  accountId: Uuid,
})

export const Payment = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  legalEntityId: Uuid,
  direction: PaymentDirection,
  partyId: Uuid,
  number: Schema.String,
  paymentDate: CalendarDate,
  /** What the payment settles: the cash received plus any withholding. */
  amount: FinancialMajorAmount,
  unallocatedAmount: FinancialMajorAmount,
  cashAccountId: Schema.NullOr(Uuid),
  journalEntryId: Uuid,
  allocations: Schema.Array(Allocation),
  /** Present only when the payer withheld tax from this receipt. */
  withholding: Schema.optionalKey(Withholding),
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
  amount: PositiveAmount,
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

export const ReceivePaymentInput = Schema.Struct({
  ...PaymentFields,
  /** Tax the payer withheld: part of `amount`, so the cash received is `amount` less this. */
  withholding: Schema.optionalKey(Withholding),
})

export const MakePaymentInput = Schema.Struct(PaymentFields)

export const AllocatePaymentInput = Schema.Struct({
  ...ScopedInput,
  paymentId: Uuid,
  /** The business date of the allocation, never before the payment date. */
  allocatedOn: CalendarDate,
  allocations: Schema.Array(Allocation).check(Schema.isMinLength(1)),
})

export const ListPaymentsInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Uuid,
  direction: Schema.optionalKey(PaymentDirection),
  partyId: Schema.optionalKey(Uuid),
  /** Only payments that settle this document. */
  invoiceId: Schema.optionalKey(Uuid),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
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

export const BankStatement = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  legalEntityId: Uuid,
  /** The ledger account of the bank the statement belongs to. */
  bankAccountId: Uuid,
  sourceName: Schema.String,
  /** SHA-256 of the imported file content; the same content is never imported twice. */
  checksum: Schema.String,
  lineCount: Schema.Int,
})

export type BankStatement = Schema.Schema.Type<typeof BankStatement>

export const BankLineMatch = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  lineId: Uuid,
  paymentId: Uuid,
  amount: FinancialMajorAmount,
  reversed: Schema.Boolean,
})

export type BankLineMatch = Schema.Schema.Type<typeof BankLineMatch>

export const BankReconciliation = Schema.Struct({
  legalEntityId: Uuid,
  bankAccountId: Uuid,
  /** Statement lines with an amount still unmatched, oldest first. */
  lines: Schema.Array(
    Schema.Struct({
      id: Uuid,
      statementId: Uuid,
      sourceName: Schema.String,
      lineNumber: Schema.Int,
      bookingDate: CalendarDate,
      description: Schema.String,
      reference: Schema.NullOr(Schema.String),
      /** Positive is money in. */
      amount: SignedAmount,
      unmatchedAmount: FinancialMajorAmount,
    }),
  ),
  /** Payments on the bank account with cash still unmatched, oldest first. */
  payments: Schema.Array(
    Schema.Struct({
      id: Uuid,
      number: Schema.String,
      direction: PaymentDirection,
      partyId: Uuid,
      paymentDate: CalendarDate,
      unmatchedCash: FinancialMajorAmount,
      /** Cash on account: the part of the payment not allocated to documents. */
      unallocatedAmount: FinancialMajorAmount,
    }),
  ),
  /** Active matches ordered by id; use the last id to retrieve the next page. */
  matches: Schema.Array(
    Schema.Struct({
      id: Uuid,
      lineId: Uuid,
      statementId: Uuid,
      paymentId: Uuid,
      paymentNumber: Schema.String,
      bookingDate: CalendarDate,
      description: Schema.String,
      sourceName: Schema.String,
      lineNumber: Schema.Int,
      reference: Schema.NullOr(Schema.String),
      amount: FinancialMajorAmount,
    }),
  ),
})

export type BankReconciliation = Schema.Schema.Type<typeof BankReconciliation>

export const ImportBankStatementInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Uuid,
  bankAccountId: Uuid,
  sourceName: TrimmedText(256),
  /** The statement file as CSV text in the profile ADR-0116 documents. */
  content: Schema.String.check(Schema.isMaxLength(2_000_000)),
})

export const MatchBankLineInput = Schema.Struct({
  ...ScopedInput,
  /** Client-chosen id that makes a retried command return the recorded match. */
  matchId: Schema.optionalKey(Uuid),
  lineId: Uuid,
  paymentId: Uuid,
  /** The cash matched, at most what is unmatched on both the line and the payment. */
  amount: PositiveAmount,
})

export const ReverseBankMatchInput = Schema.Struct({ ...ScopedInput, matchId: Uuid })

export const BankReconciliationInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Uuid,
  bankAccountId: Uuid,
  afterMatchId: Schema.optionalKey(Uuid),
  lineOffset: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  ),
  paymentOffset: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  ),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
})

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

export type BankMatchFailure =
  | SettlementErrors.BankLineNotFound
  | SettlementErrors.BankMatchExceedsAvailable
  | SettlementErrors.BankMatchMismatch
  | SettlementErrors.PaymentNotFound
  | CommonFailure

export type PaymentFailure =
  | SettlementErrors.InvalidWithholding
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
  /** The payment register, newest first; authorized like the reports because it reads money. */
  readonly listPayments: (
    input: Schema.Codec.Encoded<typeof ListPaymentsInput>,
  ) => Effect.Effect<ReadonlyArray<Payment>, CommonFailure>
  readonly aging: (
    input: Schema.Codec.Encoded<typeof AgingInput>,
  ) => Effect.Effect<AgingReport, CommonFailure>
  readonly customerStatement: (
    input: Schema.Codec.Encoded<typeof StatementInput>,
  ) => Effect.Effect<CustomerStatement, CommonFailure>
  /**
   * Imports a bank statement file as immutable lines (ADR-0116). A repeat of the same content for
   * the same bank account returns the statement already imported.
   */
  readonly importBankStatement: (
    input: Schema.Codec.Encoded<typeof ImportBankStatementInput>,
  ) => Effect.Effect<
    BankStatement,
    | SettlementErrors.InvalidBankStatement
    | AccountNotFound
    | AccountingLegalEntityNotFound
    | CommonFailure
  >
  /** Manually matches statement line cash to payment cash; a retried `matchId` returns the match. */
  readonly matchBankLine: (
    input: Schema.Codec.Encoded<typeof MatchBankLineInput>,
  ) => Effect.Effect<BankLineMatch, BankMatchFailure>
  /** Reverses a match so the line and the payment cash are unmatched again; repeatable. */
  readonly reverseBankMatch: (
    input: Schema.Codec.Encoded<typeof ReverseBankMatchInput>,
  ) => Effect.Effect<BankLineMatch, SettlementErrors.BankMatchNotFound | CommonFailure>
  /** Unmatched statement lines and unmatched payment cash of one bank account. */
  readonly bankReconciliation: (
    input: Schema.Codec.Encoded<typeof BankReconciliationInput>,
  ) => Effect.Effect<BankReconciliation, CommonFailure>
}

export const SettlementService = Context.Service<SettlementService>("RITSEI/SettlementService")
