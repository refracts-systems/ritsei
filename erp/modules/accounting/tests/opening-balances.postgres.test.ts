import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { Database } from "../../../../framework/foundation/mod.ts"
import {
  AuthorizationDenied,
  makeAuthorizationTestLayer,
} from "../../../../framework/modules/authorization/mod.ts"
import { NumberingLive } from "../../../../framework/modules/numbering/mod.ts"
import { makePostgresDatabase, runMigrations } from "../../../../framework/platform/mod.ts"
import {
  grantsFor,
  seedErpFixture,
  seedLegalEntity,
} from "../../../../tests/support/erp-fixture.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { postgresConstraint } from "../../../../tests/support/postgres-error.ts"
import {
  AccountingCapabilities,
  GeneralLedgerLive,
  GeneralLedgerService,
  JournalIdempotencyConflict,
  MigrationClearingNotZero,
  OpeningJournalControlAccount,
  OpeningJournalNotPosted,
  PostingRuleNotFound,
} from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const principal = { userAccountId: "opening-user", sessionId: "opening-session" }

const invoiceSource = {
  type: "billing.opening_invoice",
  id: "018f2000-0000-7000-8000-00000000d001",
}

const billSource = { type: "settlement.opening_bill", id: "018f2000-0000-7000-8000-00000000d002" }
const stockSource = { type: "inventory.opening_stock", id: "018f2000-0000-7000-8000-00000000d003" }

// Source trial balance: cash 500, receivable 300, inventory 400 (debit); payable 200, equity 1000
// (credit). The opening journal carries cash and equity, and plugs migration clearing with the net
// of the three control accounts (+500); the owners' loads then bring clearing back to zero.
it.effect.skipIf(databaseUrl === undefined)(
  "loads opening positions against migration clearing and reports them",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const { tenantId, legalEntityId } = yield* seedErpFixture(client)
        const database = Layer.succeed(Database, makePostgresDatabase(client))

        const grants = grantsFor(principal.userAccountId, tenantId, [
          AccountingCapabilities.chartApply,
          AccountingCapabilities.postingRuleConfigure,
          AccountingCapabilities.documentJournalPost,
          AccountingCapabilities.journalPost,
          AccountingCapabilities.openingBalancePost,
          AccountingCapabilities.ledgerRead,
        ])

        const ledgerLayer = (granted: typeof grants) =>
          GeneralLedgerLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                makeAuthorizationTestLayer(granted),
                NumberingLive.pipe(Layer.provide(database)),
                database,
              ),
            ),
          )

        yield* Effect.gen(function* () {
          const ledger = yield* GeneralLedgerService
          const scope = { principal, tenantId, legalEntityId }
          const chart = yield* ledger.applyChartTemplate({ ...scope, template: "neutral_trading" })
          const id = new Map(chart.map((account) => [account.code, account.id]))
          const opening = { ...scope, postingDate: "2026-01-01" }

          // Nothing is loaded yet, so a zero clearing balance proves nothing.
          assert.instanceOf(
            yield* Effect.flip(ledger.verifyMigrationClearing({ ...scope, asOf: "2026-01-01" })),
            OpeningJournalNotPosted,
          )

          // AR, AP, and stock control accounts are never loaded by the opening journal.
          const cashLine = (debit: string) => ({ role: "cash", debit, credit: "0" }) as const

          const equityLine = (credit: string) => ({
            accountId: id.get("3100")!,
            debit: "0",
            credit,
          })

          for (const lines of [
            [{ role: "receivable", debit: "300.00", credit: "0" }, equityLine("300.00")],
            [{ accountId: id.get("2100")!, debit: "0", credit: "200.00" }, cashLine("200.00")],
            [{ role: "inventory", debit: "400.00", credit: "0" }, equityLine("400.00")],
          ] as const) {
            const refused = yield* Effect.flip(ledger.postOpeningJournal({ ...opening, lines }))

            assert.instanceOf(refused, OpeningJournalControlAccount)
          }

          const journal = {
            ...opening,
            description: "Opening balances",
            lines: [
              { role: "cash", debit: "500.00", credit: "0" },
              { role: "migration_clearing", debit: "500.00", credit: "0" },
              { accountId: id.get("3100")!, debit: "0", credit: "1000.00" },
            ],
          } as const

          const posted = yield* ledger.postOpeningJournal(journal)
          assert.strictEqual(posted.number, "JE/2026/00001")
          assert.strictEqual(posted.sourceType, "accounting.opening_balance")
          assert.strictEqual(posted.sourceId, legalEntityId)

          // Repeating the command returns the same entry; a different journal conflicts.
          const retried = yield* ledger.postOpeningJournal(journal)
          assert.strictEqual(retried.id, posted.id)

          assert.instanceOf(
            yield* Effect.flip(
              ledger.postOpeningJournal({
                ...journal,
                lines: [
                  { role: "cash", debit: "600.00", credit: "0" },
                  { accountId: id.get("3100")!, debit: "0", credit: "600.00" },
                ],
              }),
            ),
            JournalIdempotencyConflict,
          )

          // The owners have not loaded their open items, so clearing still holds the plug.
          const blocked = yield* Effect.flip(
            ledger.verifyMigrationClearing({ ...scope, asOf: "2026-01-01" }),
          )

          assert.instanceOf(blocked, MigrationClearingNotZero)
          assert.strictEqual(blocked.balance, "500.00")

          const load = (
            source: { type: string; id: string },
            reference: string,
            lines: ReadonlyArray<{
              role: "receivable" | "payable" | "inventory" | "migration_clearing"
              debit: string
              credit: string
            }>,
          ) => ledger.postDocumentEntry({ ...opening, reference, source, lines })

          yield* load(invoiceSource, "billing.opening_invoice/1", [
            { role: "receivable", debit: "300.00", credit: "0" },
            { role: "migration_clearing", debit: "0", credit: "300.00" },
          ])

          yield* load(billSource, "settlement.opening_bill/1", [
            { role: "migration_clearing", debit: "200.00", credit: "0" },
            { role: "payable", debit: "0", credit: "200.00" },
          ])

          // Still short by the stock value, which the next load clears.
          const stillBlocked = yield* Effect.flip(
            ledger.verifyMigrationClearing({ ...scope, asOf: "2026-01-01" }),
          )

          assert.instanceOf(stillBlocked, MigrationClearingNotZero)
          assert.strictEqual(stillBlocked.balance, "400.00")

          yield* load(stockSource, "inventory.opening_stock/1", [
            { role: "inventory", debit: "400.00", credit: "0" },
            { role: "migration_clearing", debit: "0", credit: "400.00" },
          ])

          const verified = yield* ledger.verifyMigrationClearing({ ...scope, asOf: "2026-01-01" })
          assert.strictEqual(verified.openingEntryId, posted.id)
          assert.strictEqual(verified.accountId, id.get("1900"))

          // First operating month: a sale of 100 plus 11 tax, and 40 of cost of goods sold.
          yield* ledger.postManualEntry({
            ...scope,
            postingDate: "2026-02-10",
            reference: "manual/sale",
            lines: [
              { role: "receivable", debit: "111.00", credit: "0" },
              { role: "revenue", debit: "0", credit: "100.00" },
              { role: "output_tax", debit: "0", credit: "11.00" },
            ],
          })

          yield* ledger.postManualEntry({
            ...scope,
            postingDate: "2026-02-10",
            reference: "manual/cogs",
            lines: [
              { role: "cost_of_goods_sold", debit: "40.00", credit: "0" },
              { role: "inventory", debit: "0", credit: "40.00" },
            ],
          })

          const profit = yield* ledger.profitAndLoss({
            ...scope,
            from: "2026-02-01",
            to: "2026-02-28",
          })

          assert.deepStrictEqual(
            profit.revenue.rows.map((row) => [row.code, row.amount]),
            [["4100", "100.00"]],
          )

          assert.deepStrictEqual(
            profit.expenses.rows.map((row) => [row.code, row.amount]),
            [["5100", "40.00"]],
          )
          assert.strictEqual(profit.netIncome, "60.00")

          const january = yield* ledger.profitAndLoss({
            ...scope,
            from: "2026-01-01",
            to: "2026-01-31",
          })

          assert.strictEqual(january.netIncome, "0.00")

          const sheet = yield* ledger.balanceSheet({ ...scope, asOf: "2026-02-28" })

          assert.deepStrictEqual(
            sheet.assets.rows.map((row) => [row.code, row.amount]),
            [
              ["1100", "500.00"],
              ["1200", "411.00"],
              ["1300", "360.00"],
              ["1900", "0.00"],
            ],
          )

          assert.deepStrictEqual(
            sheet.liabilities.rows.map((row) => [row.code, row.amount]),
            [
              ["2100", "200.00"],
              ["2200", "11.00"],
            ],
          )
          assert.strictEqual(sheet.equity.total, "1000.00")
          assert.strictEqual(sheet.unclosedEarnings, "60.00")
          assert.strictEqual(sheet.assets.total, "1271.00")
          assert.strictEqual(sheet.totalLiabilitiesAndEquity, "1271.00")

          // A legal entity without a clearing rule cannot be signed off.
          const other = yield* Effect.promise(() => seedLegalEntity(client, tenantId, "Second Co"))

          assert.instanceOf(
            yield* Effect.flip(
              ledger.verifyMigrationClearing({
                ...scope,
                legalEntityId: other.legalEntityId,
                asOf: "2026-01-01",
              }),
            ),
            PostingRuleNotFound,
          )
        }).pipe(Effect.provide(ledgerLayer(grants)))

        // The database allows one opening journal per legal entity, whatever its reference.
        const second = yield* Effect.tryPromise({
          try: () => client`
            insert into accounting.journal_entries
              (tenant_id, reference, legal_entity_id, posting_date, number, source_type, source_id)
            values (${tenantId}, 'raw/second-opening', ${legalEntityId}, '2026-01-01', 'JE/RAW/1',
              'accounting.opening_balance', ${invoiceSource.id})
          `,
          catch: (cause) => cause,
        }).pipe(Effect.flip)

        assert.include(String(postgresConstraint(second)), "journal_entries_opening_balance_key")

        // Posting an opening journal is its own capability, apart from manual journals.
        const denied = yield* Effect.gen(function* () {
          const ledger = yield* GeneralLedgerService

          return yield* Effect.flip(
            ledger.postOpeningJournal({
              principal,
              tenantId,
              legalEntityId,
              postingDate: "2026-01-01",
              lines: [
                { role: "cash", debit: "1.00", credit: "0" },
                { role: "revenue", debit: "0", credit: "1.00" },
              ],
            }),
          )
        }).pipe(
          Effect.provide(
            ledgerLayer(
              grantsFor(principal.userAccountId, tenantId, [
                AccountingCapabilities.journalPost,
                AccountingCapabilities.ledgerRead,
              ]),
            ),
          ),
        )

        assert.instanceOf(denied, AuthorizationDenied)
      }),
    ),
  { timeout: 120_000 },
)
