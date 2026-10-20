import type { CapabilityType } from "../../../../framework/modules/authorization/mod.ts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  addDays,
  formatSignedMinor,
  requireExactMajorToMinor,
  typedEntries,
} from "../../../../framework/foundation/mod.ts"
import type { Principal } from "../../../../framework/modules/auth/mod.ts"
import {
  AuthorizationService,
  scopedCommand,
} from "../../../../framework/modules/authorization/mod.ts"
import { AccountingCapabilities } from "./capabilities.ts"
import { chartTemplates } from "./chart-templates.ts"
import {
  ApplyChartTemplateInput,
  ConfigurePostingRuleInput,
  CreateLedgerAccountInput,
  GeneralLedgerInput,
  type GeneralLedgerService,
  type LedgerLineInput,
  ListChartInput,
  ListPostingRulesInput,
  PostDocumentEntryInput,
  PostManualEntryInput,
  RoleBalanceInput,
  TrialBalanceInput,
} from "./general-ledger-contract.ts"
import type { GeneralLedgerStore, PostEntryCommand } from "./general-ledger-store.ts"
import {
  AccountingLegalEntityNotFound,
  AccountingPeriodNotOpen,
  AccountNotFound,
  FinancialEngineActivated,
  InvalidJournalLine,
  JournalIdempotencyConflict,
  PostingRuleNotFound,
  UnbalancedJournal,
} from "./errors.ts"

const minor = (value: string) => requireExactMajorToMinor(value, 2)
const signed = (value: bigint) => formatSignedMinor(value, 2)

/** Every line carries exactly one positive side, and debits equal credits. */
const validateLines = (lines: ReadonlyArray<LedgerLineInput>) => {
  let debit = 0n
  let credit = 0n
  for (const [index, line] of lines.entries()) {
    const lineDebit = minor(line.debit)
    const lineCredit = minor(line.credit)
    if (lineDebit > 0n === lineCredit > 0n) return new InvalidJournalLine({ index })
    debit += lineDebit
    credit += lineCredit
  }
  return debit === credit
    ? undefined
    : new UnbalancedJournal({ debit: signed(debit), credit: signed(credit) })
}

export const makeGeneralLedgerServiceFromStore = <R>(
  storeEffect: Effect.Effect<GeneralLedgerStore, never, R>,
) =>
  Effect.gen(function* () {
    const store = yield* storeEffect
    const authorization = yield* AuthorizationService
    const authorized = scopedCommand(authorization)
    const authorize = (
      input: { principal: Schema.Schema.Type<typeof Principal>; tenantId: string },
      capability: CapabilityType,
    ) =>
      authorization.authorize({ principal: input.principal, tenantId: input.tenantId, capability })

    const post = Effect.fn("GeneralLedgerService.post")(function* (command: PostEntryCommand) {
      const invalid = validateLines(command.lines)
      if (invalid !== undefined) return yield* Effect.fail(invalid)
      const outcome = yield* store.postEntry(command)
      const scope = { tenantId: command.tenantId, legalEntityId: command.legalEntityId }
      switch (outcome._tag) {
        case "posted":
          return outcome.entry
        case "not-configured":
          return yield* Effect.fail(new AccountingLegalEntityNotFound(scope))
        case "engine-activated":
          return yield* Effect.fail(new FinancialEngineActivated(scope))
        case "period-not-open":
          return yield* Effect.fail(new AccountingPeriodNotOpen(scope))
        case "rule-missing":
          return yield* Effect.fail(new PostingRuleNotFound({ ...scope, role: outcome.role }))
        case "account-missing":
          return yield* Effect.fail(new AccountNotFound({ tenantId: command.tenantId }))
        case "idempotency-conflict":
          return yield* Effect.fail(
            new JournalIdempotencyConflict({
              tenantId: command.tenantId,
              reference: command.reference,
            }),
          )
      }
    })

    const createAccount = Effect.fn("GeneralLedgerService.createAccount")(function* (
      input: Schema.Codec.Encoded<typeof CreateLedgerAccountInput>,
    ) {
      const decoded = yield* authorized(
        CreateLedgerAccountInput,
        AccountingCapabilities.accountCreate,
      )(input)
      return yield* store.createAccount({
        tenantId: decoded.tenantId,
        code: decoded.code.toUpperCase(),
        name: decoded.name,
        type: decoded.type,
        parentAccountId: decoded.parentAccountId ?? null,
      })
    })

    const listChart = Effect.fn("GeneralLedgerService.listChart")(function* (
      input: Schema.Codec.Encoded<typeof ListChartInput>,
    ) {
      const decoded = yield* authorized(ListChartInput, AccountingCapabilities.accountRead)(input)
      return yield* store.listChart(decoded.tenantId)
    })

    const applyChartTemplate = Effect.fn("GeneralLedgerService.applyChartTemplate")(function* (
      input: Schema.Codec.Encoded<typeof ApplyChartTemplateInput>,
    ) {
      const decoded = yield* authorized(
        ApplyChartTemplateInput,
        AccountingCapabilities.chartApply,
      )(input)
      const template = chartTemplates[decoded.template]
      const created = yield* store.ensureTemplateAccounts(decoded.tenantId, template.accounts)
      if (decoded.legalEntityId !== undefined) {
        yield* authorize(decoded, AccountingCapabilities.postingRuleConfigure)
        const byCode = new Map(created.map((account) => [account.code, account.id]))
        for (const [role, code] of typedEntries(template.postingRules)) {
          // Existing rules win: applying a template never remaps a configured role.
          yield* store
            .setPostingRule(
              {
                tenantId: decoded.tenantId,
                legalEntityId: decoded.legalEntityId,
                role,
                accountId: byCode.get(code)!,
              },
              { replace: false },
            )
            .pipe(
              Effect.catchTag("AccountNotFound", () =>
                Effect.die(new Error(`template account ${code} was not created`)),
              ),
            )
        }
      }
      return created
    })

    const configurePostingRule = Effect.fn("GeneralLedgerService.configurePostingRule")(function* (
      input: Schema.Codec.Encoded<typeof ConfigurePostingRuleInput>,
    ) {
      const decoded = yield* authorized(
        ConfigurePostingRuleInput,
        AccountingCapabilities.postingRuleConfigure,
      )(input)
      return yield* store.setPostingRule(
        {
          tenantId: decoded.tenantId,
          legalEntityId: decoded.legalEntityId,
          role: decoded.role,
          accountId: decoded.accountId,
        },
        { replace: true },
      )
    })

    const listPostingRules = Effect.fn("GeneralLedgerService.listPostingRules")(function* (
      input: Schema.Codec.Encoded<typeof ListPostingRulesInput>,
    ) {
      const decoded = yield* authorized(
        ListPostingRulesInput,
        AccountingCapabilities.postingRuleRead,
      )(input)
      return yield* store.listPostingRules(decoded.tenantId, decoded.legalEntityId)
    })

    const postManualEntry = Effect.fn("GeneralLedgerService.postManualEntry")(function* (
      input: Schema.Codec.Encoded<typeof PostManualEntryInput>,
    ) {
      const decoded = yield* authorized(
        PostManualEntryInput,
        AccountingCapabilities.journalPost,
      )(input)
      return yield* post({
        tenantId: decoded.tenantId,
        legalEntityId: decoded.legalEntityId,
        postingDate: decoded.postingDate,
        reference: decoded.reference,
        description: decoded.description ?? null,
        source: null,
        lines: decoded.lines,
      })
    })

    const postDocumentEntry = Effect.fn("GeneralLedgerService.postDocumentEntry")(function* (
      input: Schema.Codec.Encoded<typeof PostDocumentEntryInput>,
    ) {
      const decoded = yield* authorized(
        PostDocumentEntryInput,
        AccountingCapabilities.documentJournalPost,
      )(input)
      return yield* post({
        tenantId: decoded.tenantId,
        legalEntityId: decoded.legalEntityId,
        postingDate: decoded.postingDate,
        reference: decoded.reference,
        description: decoded.description ?? null,
        source: decoded.source,
        lines: decoded.lines,
      })
    })

    const trialBalance = Effect.fn("GeneralLedgerService.trialBalance")(function* (
      input: Schema.Codec.Encoded<typeof TrialBalanceInput>,
    ) {
      const decoded = yield* authorized(TrialBalanceInput, AccountingCapabilities.ledgerRead)(input)
      const activity = yield* store.accountActivity({
        tenantId: decoded.tenantId,
        legalEntityId: decoded.legalEntityId,
        from: decoded.from ?? null,
        to: decoded.to,
      })
      const chart = new Map(
        (yield* store.listChart(decoded.tenantId)).map((account) => [account.id, account]),
      )
      let totalDebit = 0n
      let totalCredit = 0n
      const rows = activity
        .map((row) => {
          const account = chart.get(row.accountId)!
          totalDebit += minor(row.debit)
          totalCredit += minor(row.credit)
          return {
            accountId: account.id,
            code: account.code,
            name: account.name,
            type: account.type,
            parentAccountId: account.parentAccountId,
            debit: row.debit,
            credit: row.credit,
            balance: signed(minor(row.debit) - minor(row.credit)),
          }
        })
        .toSorted((left, right) => left.code.localeCompare(right.code))
      return {
        legalEntityId: decoded.legalEntityId,
        from: decoded.from ?? null,
        to: decoded.to,
        rows,
        totalDebit: signed(totalDebit),
        totalCredit: signed(totalCredit),
      }
    })

    const generalLedger = Effect.fn("GeneralLedgerService.generalLedger")(function* (
      input: Schema.Codec.Encoded<typeof GeneralLedgerInput>,
    ) {
      const decoded = yield* authorized(
        GeneralLedgerInput,
        AccountingCapabilities.ledgerRead,
      )(input)
      const account = (yield* store.listChart(decoded.tenantId)).find(
        (candidate) => candidate.id === decoded.accountId,
      )
      if (account === undefined) {
        return yield* Effect.fail(new AccountNotFound({ tenantId: decoded.tenantId }))
      }
      const scope = {
        tenantId: decoded.tenantId,
        legalEntityId: decoded.legalEntityId,
        accountId: decoded.accountId,
      }
      const opening = yield* store.accountActivity({
        ...scope,
        from: null,
        to: addDays(decoded.from, -1),
      })
      let balance = opening.reduce((sum, row) => sum + minor(row.debit) - minor(row.credit), 0n)
      const openingBalance = signed(balance)
      const lines = (yield* store.ledgerLines({
        ...scope,
        from: decoded.from,
        to: decoded.to,
      })).map((line) => {
        balance += minor(line.debit) - minor(line.credit)
        return { ...line, balance: signed(balance) }
      })
      return {
        legalEntityId: decoded.legalEntityId,
        account,
        from: decoded.from,
        to: decoded.to,
        openingBalance,
        lines,
        closingBalance: signed(balance),
      }
    })

    const roleBalance = Effect.fn("GeneralLedgerService.roleBalance")(function* (
      input: Schema.Codec.Encoded<typeof RoleBalanceInput>,
    ) {
      const decoded = yield* authorized(RoleBalanceInput, AccountingCapabilities.ledgerRead)(input)
      const rule = (yield* store.listPostingRules(decoded.tenantId, decoded.legalEntityId)).find(
        (candidate) => candidate.role === decoded.role,
      )
      if (rule === undefined) {
        return yield* Effect.fail(
          new PostingRuleNotFound({
            tenantId: decoded.tenantId,
            legalEntityId: decoded.legalEntityId,
            role: decoded.role,
          }),
        )
      }
      const activity = yield* store.accountActivity({
        tenantId: decoded.tenantId,
        legalEntityId: decoded.legalEntityId,
        accountId: rule.accountId,
        from: null,
        to: decoded.asOf,
      })
      const balance = activity.reduce((sum, row) => sum + minor(row.debit) - minor(row.credit), 0n)
      return {
        legalEntityId: decoded.legalEntityId,
        role: decoded.role,
        accountId: rule.accountId,
        asOf: decoded.asOf,
        balance: signed(balance),
      }
    })

    return {
      createAccount,
      listChart,
      applyChartTemplate,
      configurePostingRule,
      listPostingRules,
      postManualEntry,
      postDocumentEntry,
      trialBalance,
      generalLedger,
      roleBalance,
    } satisfies GeneralLedgerService
  })
