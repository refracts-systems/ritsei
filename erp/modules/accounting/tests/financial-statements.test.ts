import { assert, describe, it } from "@effect/vitest"

import { buildBalanceSheet, buildProfitAndLoss } from "../src/financial-statements.ts"
import type { AccountType, LedgerAccount } from "../src/general-ledger-contract.ts"

const tenantId = "018f2000-0000-7000-8000-000000000001"
const legalEntityId = "018f2000-0000-7000-8000-000000000002"

const account = (n: number, code: string, type: AccountType): LedgerAccount => ({
  id: `018f2000-0000-7000-8000-0000000001${String(n).padStart(2, "0")}`,
  tenantId,
  code,
  name: `Account ${code}`,
  type,
  parentAccountId: null,
})

const cash = account(1, "1100", "asset")
const payable = account(2, "2100", "liability")
const equity = account(3, "3100", "equity")
const revenue = account(4, "4100", "revenue")
const expense = account(5, "5100", "expense")
const chart = new Map([cash, payable, equity, revenue, expense].map((entry) => [entry.id, entry]))

const activity = (entry: LedgerAccount, debit: string, credit: string) => ({
  accountId: entry.id,
  debit,
  credit,
})

describe("financial statements", () => {
  it("reports revenue and expense in their natural sign and nets them to income", () => {
    const report = buildProfitAndLoss(
      { legalEntityId, from: "2026-01-01", to: "2026-12-31" },
      [
        activity(expense, "40.00", "5.00"),
        activity(revenue, "0.00", "100.50"),
        activity(cash, "999.00", "0.00"),
      ],
      chart,
    )

    assert.deepStrictEqual(
      report.revenue.rows.map((row) => [row.code, row.amount]),
      [["4100", "100.50"]],
    )

    assert.deepStrictEqual(
      report.expenses.rows.map((row) => [row.code, row.amount]),
      [["5100", "35.00"]],
    )
    assert.strictEqual(report.netIncome, "65.50")
  })

  it("shows a loss as a negative net income", () => {
    const report = buildProfitAndLoss(
      { legalEntityId, from: "2026-01-01", to: "2026-12-31" },
      [activity(expense, "10.00", "0.00")],
      chart,
    )

    assert.strictEqual(report.revenue.total, "0.00")
    assert.strictEqual(report.netIncome, "-10.00")
  })

  it("balances the sheet by carrying unclosed earnings", () => {
    const sheet = buildBalanceSheet(
      { legalEntityId, asOf: "2026-12-31" },
      [
        activity(cash, "1100.00", "0.00"),
        activity(payable, "0.00", "200.00"),
        activity(equity, "0.00", "1000.00"),
        activity(revenue, "0.00", "100.00"),
        activity(expense, "200.00", "0.00"),
      ],
      chart,
    )

    assert.strictEqual(sheet.assets.total, "1100.00")
    assert.strictEqual(sheet.liabilities.total, "200.00")
    assert.strictEqual(sheet.equity.total, "1000.00")
    assert.strictEqual(sheet.unclosedEarnings, "-100.00")
    assert.strictEqual(sheet.totalLiabilitiesAndEquity, sheet.assets.total)
  })
})
