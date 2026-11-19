import {
  formatSignedMinor,
  requireExactMajorToMinor,
} from "../../../../framework/foundation/mod.ts"
import type {
  AccountType,
  BalanceSheet,
  LedgerAccount,
  ProfitAndLoss,
} from "./general-ledger-contract.ts"
import type { AccountActivity } from "./general-ledger-store.ts"

const minor = (value: string) => requireExactMajorToMinor(value, 2)
const signed = (value: bigint) => formatSignedMinor(value, 2)

/** Assets and expenses grow with debits; liabilities, equity, and revenue grow with credits. */
const isDebitNature = (type: AccountType) => type === "asset" || type === "expense"

/** One section: the accounts of `type` that have activity, each in its natural sign. */
const section = (
  type: AccountType,
  activity: ReadonlyArray<AccountActivity>,
  chart: ReadonlyMap<string, LedgerAccount>,
) => {
  let total = 0n

  const rows = activity
    .flatMap((row) => {
      const account = chart.get(row.accountId)!

      if (account.type !== type) return []
      const net = minor(row.debit) - minor(row.credit)
      const amount = isDebitNature(type) ? net : -net
      total += amount

      return [
        {
          accountId: account.id,
          code: account.code,
          name: account.name,
          parentAccountId: account.parentAccountId,
          amount: signed(amount),
        },
      ]
    })
    .toSorted((left, right) => left.code.localeCompare(right.code))

  return { section: { rows, total: signed(total) }, total }
}

/** Revenue less expenses over posted lines dated within the period. */
export const buildProfitAndLoss = (
  scope: { readonly legalEntityId: string; readonly from: string; readonly to: string },
  activity: ReadonlyArray<AccountActivity>,
  chart: ReadonlyMap<string, LedgerAccount>,
): ProfitAndLoss => {
  const revenue = section("revenue", activity, chart)
  const expenses = section("expense", activity, chart)

  return {
    ...scope,
    revenue: revenue.section,
    expenses: expenses.section,
    netIncome: signed(revenue.total - expenses.total),
  }
}

/** Cumulative balances to `asOf`; `activity` must run from the start of the ledger. */
export const buildBalanceSheet = (
  scope: { readonly legalEntityId: string; readonly asOf: string },
  activity: ReadonlyArray<AccountActivity>,
  chart: ReadonlyMap<string, LedgerAccount>,
): BalanceSheet => {
  const assets = section("asset", activity, chart)
  const liabilities = section("liability", activity, chart)
  const equity = section("equity", activity, chart)

  const earnings =
    section("revenue", activity, chart).total - section("expense", activity, chart).total

  return {
    ...scope,
    assets: assets.section,
    liabilities: liabilities.section,
    equity: equity.section,
    unclosedEarnings: signed(earnings),
    totalLiabilitiesAndEquity: signed(liabilities.total + equity.total + earnings),
  }
}
