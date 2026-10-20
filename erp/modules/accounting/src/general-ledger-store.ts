import type * as Effect from "effect/Effect"

import type { DatabaseFailure } from "../../../../framework/foundation/mod.ts"
import type { TemplateAccount } from "./chart-templates.ts"
import type {
  AccountType,
  LedgerAccount,
  LedgerEntry,
  PostingRole,
  PostingRule,
} from "./general-ledger-contract.ts"
import type {
  AccountAlreadyExists,
  AccountingLegalEntityNotFound,
  AccountNotFound,
  InvalidParentAccount,
} from "./errors.ts"

export type ResolvedLine =
  | { readonly role: PostingRole; readonly debit: string; readonly credit: string }
  | { readonly accountId: string; readonly debit: string; readonly credit: string }

export type PostEntryCommand = {
  readonly tenantId: string
  readonly legalEntityId: string
  readonly postingDate: string
  readonly reference: string
  readonly description: string | null
  readonly source: { readonly type: string; readonly id: string } | null
  readonly lines: ReadonlyArray<ResolvedLine>
}

export type PostEntryOutcome =
  | { readonly _tag: "posted"; readonly entry: LedgerEntry }
  | { readonly _tag: "not-configured" }
  | { readonly _tag: "engine-activated" }
  | { readonly _tag: "period-not-open" }
  | { readonly _tag: "rule-missing"; readonly role: PostingRole }
  | { readonly _tag: "account-missing" }
  | { readonly _tag: "idempotency-conflict" }

export type AccountActivity = {
  readonly accountId: string
  readonly debit: string
  readonly credit: string
}

export type LedgerLineRow = {
  readonly entryId: string
  readonly number: string
  readonly postingDate: string
  readonly reference: string
  readonly description: string | null
  readonly debit: string
  readonly credit: string
}

export interface GeneralLedgerStore {
  readonly createAccount: (command: {
    readonly tenantId: string
    readonly code: string
    readonly name: string
    readonly type: AccountType
    readonly parentAccountId: string | null
  }) => Effect.Effect<LedgerAccount, AccountAlreadyExists | InvalidParentAccount | DatabaseFailure>
  readonly listChart: (
    tenantId: string,
  ) => Effect.Effect<ReadonlyArray<LedgerAccount>, DatabaseFailure>
  /** Creates missing template accounts by code and returns every template account. */
  readonly ensureTemplateAccounts: (
    tenantId: string,
    accounts: ReadonlyArray<TemplateAccount>,
  ) => Effect.Effect<ReadonlyArray<LedgerAccount>, DatabaseFailure>
  readonly setPostingRule: (
    rule: PostingRule,
    options: { readonly replace: boolean },
  ) => Effect.Effect<PostingRule, AccountNotFound | AccountingLegalEntityNotFound | DatabaseFailure>
  readonly listPostingRules: (
    tenantId: string,
    legalEntityId: string,
  ) => Effect.Effect<ReadonlyArray<PostingRule>, DatabaseFailure>
  readonly postEntry: (
    command: PostEntryCommand,
  ) => Effect.Effect<PostEntryOutcome, DatabaseFailure>
  readonly accountActivity: (query: {
    readonly tenantId: string
    readonly legalEntityId: string
    readonly from: string | null
    readonly to: string
    readonly accountId?: string
  }) => Effect.Effect<ReadonlyArray<AccountActivity>, DatabaseFailure>
  readonly ledgerLines: (query: {
    readonly tenantId: string
    readonly legalEntityId: string
    readonly accountId: string
    readonly from: string
    readonly to: string
  }) => Effect.Effect<ReadonlyArray<LedgerLineRow>, DatabaseFailure>
}
