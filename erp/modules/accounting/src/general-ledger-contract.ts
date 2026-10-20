import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  CalendarDate,
  type DatabaseFailure,
  FinancialMajorAmount,
  InstantString,
  Uuid,
  TrimmedText,
  UpperCode,
  SignedAmount,
  DottedName,
} from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import type * as AccountingErrors from "./errors.ts"

const TrimmedNonEmptyString = TrimmedText(256)
const AccountCode = UpperCode(64)
/** Signed exact amount: positive is a debit balance, negative a credit balance. */
const SourceType = DottedName

export const AccountType = Schema.Literals(["asset", "liability", "equity", "revenue", "expense"])
export type AccountType = Schema.Schema.Type<typeof AccountType>

/** Roles a document owner posts to; posting rules resolve each to an account per legal entity. */
export const PostingRole = Schema.Literals([
  "receivable",
  "revenue",
  "output_tax",
  "input_tax",
  "payable",
  "inventory",
  "cost_of_goods_sold",
  "goods_received_not_invoiced",
  "purchase_price_variance",
  "inventory_adjustment",
  "cash",
])
export type PostingRole = Schema.Schema.Type<typeof PostingRole>

export const ChartTemplateId = Schema.Literal("neutral_trading")

export const LedgerAccount = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  code: AccountCode,
  name: TrimmedNonEmptyString,
  type: AccountType,
  parentAccountId: Schema.NullOr(Uuid),
})
export type LedgerAccount = Schema.Schema.Type<typeof LedgerAccount>

export const PostingRule = Schema.Struct({
  tenantId: Uuid,
  legalEntityId: Uuid,
  role: PostingRole,
  accountId: Uuid,
})
export type PostingRule = Schema.Schema.Type<typeof PostingRule>

const LineAmounts = { debit: FinancialMajorAmount, credit: FinancialMajorAmount }

/** A line names its account directly or through a posting role. */
export const LedgerLineInput = Schema.Union([
  Schema.Struct({ role: PostingRole, ...LineAmounts }),
  Schema.Struct({ accountId: Uuid, ...LineAmounts }),
])
export type LedgerLineInput = Schema.Schema.Type<typeof LedgerLineInput>

export const LedgerEntryLine = Schema.Struct({ accountId: Uuid, ...LineAmounts })
export type LedgerEntryLine = Schema.Schema.Type<typeof LedgerEntryLine>

export const LedgerEntry = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  legalEntityId: Uuid,
  number: TrimmedNonEmptyString,
  reference: TrimmedNonEmptyString,
  postingDate: CalendarDate,
  description: Schema.NullOr(Schema.String),
  sourceType: Schema.NullOr(SourceType),
  sourceId: Schema.NullOr(Uuid),
  postedAt: InstantString,
  lines: Schema.Array(LedgerEntryLine),
})
export type LedgerEntry = Schema.Schema.Type<typeof LedgerEntry>

export const TrialBalanceRow = Schema.Struct({
  accountId: Uuid,
  code: AccountCode,
  name: TrimmedNonEmptyString,
  type: AccountType,
  parentAccountId: Schema.NullOr(Uuid),
  debit: FinancialMajorAmount,
  credit: FinancialMajorAmount,
  balance: SignedAmount,
})
export const TrialBalance = Schema.Struct({
  legalEntityId: Uuid,
  from: Schema.NullOr(CalendarDate),
  to: CalendarDate,
  rows: Schema.Array(TrialBalanceRow),
  totalDebit: FinancialMajorAmount,
  totalCredit: FinancialMajorAmount,
})
export type TrialBalance = Schema.Schema.Type<typeof TrialBalance>

export const GeneralLedgerLine = Schema.Struct({
  entryId: Uuid,
  number: TrimmedNonEmptyString,
  postingDate: CalendarDate,
  reference: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  debit: FinancialMajorAmount,
  credit: FinancialMajorAmount,
  balance: SignedAmount,
})
export const GeneralLedger = Schema.Struct({
  legalEntityId: Uuid,
  account: LedgerAccount,
  from: CalendarDate,
  to: CalendarDate,
  openingBalance: SignedAmount,
  lines: Schema.Array(GeneralLedgerLine),
  closingBalance: SignedAmount,
})
export type GeneralLedger = Schema.Schema.Type<typeof GeneralLedger>

export const RoleBalance = Schema.Struct({
  legalEntityId: Uuid,
  role: PostingRole,
  accountId: Uuid,
  asOf: CalendarDate,
  balance: SignedAmount,
})
export type RoleBalance = Schema.Schema.Type<typeof RoleBalance>

const ScopedInput = { principal: Principal, tenantId: Uuid }

export const CreateLedgerAccountInput = Schema.Struct({
  ...ScopedInput,
  code: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  type: AccountType,
  parentAccountId: Schema.optionalKey(Uuid),
})
export const ListChartInput = Schema.Struct({ ...ScopedInput })
export const ApplyChartTemplateInput = Schema.Struct({
  ...ScopedInput,
  template: ChartTemplateId,
  /** When given, also configures the template's posting rules for this legal entity. */
  legalEntityId: Schema.optionalKey(Uuid),
})
export const ConfigurePostingRuleInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Uuid,
  role: PostingRole,
  accountId: Uuid,
})
export const ListPostingRulesInput = Schema.Struct({ ...ScopedInput, legalEntityId: Uuid })

const EntryFields = {
  ...ScopedInput,
  legalEntityId: Uuid,
  postingDate: CalendarDate,
  /** Idempotency key: posting the same reference again returns the posted entry. */
  reference: TrimmedNonEmptyString,
  description: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
  lines: Schema.Array(LedgerLineInput).check(Schema.isMinLength(2)),
}
export const PostManualEntryInput = Schema.Struct(EntryFields)
export const PostDocumentEntryInput = Schema.Struct({
  ...EntryFields,
  source: Schema.Struct({ type: SourceType, id: Uuid }),
})
export type PostDocumentEntryCommand = Schema.Schema.Type<typeof PostDocumentEntryInput>

export const TrialBalanceInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Uuid,
  from: Schema.optionalKey(CalendarDate),
  to: CalendarDate,
})
export const GeneralLedgerInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Uuid,
  accountId: Uuid,
  from: CalendarDate,
  to: CalendarDate,
})
export const RoleBalanceInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Uuid,
  role: PostingRole,
  asOf: CalendarDate,
})

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

export type PostEntryFailure =
  | AccountingErrors.AccountingLegalEntityNotFound
  | AccountingErrors.AccountingPeriodNotOpen
  | AccountingErrors.AccountNotFound
  | AccountingErrors.FinancialEngineActivated
  | AccountingErrors.InvalidJournalLine
  | AccountingErrors.JournalIdempotencyConflict
  | AccountingErrors.PostingRuleNotFound
  | AccountingErrors.UnbalancedJournal
  | CommonFailure

/**
 * The general ledger: chart of accounts, posting rules, numbered legal-entity journals, and the
 * trial balance and general-ledger reports (ADR-0096). Document owners post through
 * `postDocumentEntry` inside their own transaction.
 */
export interface GeneralLedgerService {
  readonly createAccount: (
    input: Schema.Codec.Encoded<typeof CreateLedgerAccountInput>,
  ) => Effect.Effect<
    LedgerAccount,
    AccountingErrors.AccountAlreadyExists | AccountingErrors.InvalidParentAccount | CommonFailure
  >
  readonly listChart: (
    input: Schema.Codec.Encoded<typeof ListChartInput>,
  ) => Effect.Effect<ReadonlyArray<LedgerAccount>, CommonFailure>
  readonly applyChartTemplate: (
    input: Schema.Codec.Encoded<typeof ApplyChartTemplateInput>,
  ) => Effect.Effect<
    ReadonlyArray<LedgerAccount>,
    AccountingErrors.AccountingLegalEntityNotFound | CommonFailure
  >
  readonly configurePostingRule: (
    input: Schema.Codec.Encoded<typeof ConfigurePostingRuleInput>,
  ) => Effect.Effect<
    PostingRule,
    | AccountingErrors.AccountNotFound
    | AccountingErrors.AccountingLegalEntityNotFound
    | CommonFailure
  >
  readonly listPostingRules: (
    input: Schema.Codec.Encoded<typeof ListPostingRulesInput>,
  ) => Effect.Effect<ReadonlyArray<PostingRule>, CommonFailure>
  readonly postManualEntry: (
    input: Schema.Codec.Encoded<typeof PostManualEntryInput>,
  ) => Effect.Effect<LedgerEntry, PostEntryFailure>
  readonly postDocumentEntry: (
    input: Schema.Codec.Encoded<typeof PostDocumentEntryInput>,
  ) => Effect.Effect<LedgerEntry, PostEntryFailure>
  readonly trialBalance: (
    input: Schema.Codec.Encoded<typeof TrialBalanceInput>,
  ) => Effect.Effect<TrialBalance, CommonFailure>
  readonly generalLedger: (
    input: Schema.Codec.Encoded<typeof GeneralLedgerInput>,
  ) => Effect.Effect<GeneralLedger, AccountingErrors.AccountNotFound | CommonFailure>
  readonly roleBalance: (
    input: Schema.Codec.Encoded<typeof RoleBalanceInput>,
  ) => Effect.Effect<RoleBalance, AccountingErrors.PostingRuleNotFound | CommonFailure>
}

export const GeneralLedgerService = Context.Service<GeneralLedgerService>(
  "RITSEI/GeneralLedgerService",
)
