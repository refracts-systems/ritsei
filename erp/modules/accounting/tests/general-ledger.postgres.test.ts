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
import {
  AccountingCapabilities,
  AccountingPeriodNotOpen,
  GeneralLedgerLive,
  GeneralLedgerService,
  InvalidJournalLine,
  InvalidParentAccount,
  JournalIdempotencyConflict,
  PostingRuleNotFound,
  UnbalancedJournal,
} from "../mod.ts"
import { postgresConstraint } from "../../../../tests/support/postgres-error.ts"

const databaseUrl = process.env["DATABASE_URL"]
const principal = { userAccountId: "ledger-user", sessionId: "ledger-session" }
const source = { type: "billing.customer_invoice", id: "018f2000-0000-7000-8000-00000000c001" }

it.effect.skipIf(databaseUrl === undefined)(
  "posts numbered, balanced legal-entity journals through posting rules and reports them",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const fixture = yield* seedErpFixture(client)
        const { tenantId, legalEntityId } = fixture
        const database = Layer.succeed(Database, makePostgresDatabase(client))

        const grants = grantsFor(principal.userAccountId, tenantId, [
          AccountingCapabilities.accountCreate,
          AccountingCapabilities.accountRead,
          AccountingCapabilities.chartApply,
          AccountingCapabilities.postingRuleConfigure,
          AccountingCapabilities.postingRuleRead,
          AccountingCapabilities.documentJournalPost,
          AccountingCapabilities.journalPost,
          AccountingCapabilities.ledgerRead,
        ])

        const ledgerLayer = (granted: typeof grants | []) =>
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
          const again = yield* ledger.applyChartTemplate({ ...scope, template: "neutral_trading" })
          assert.strictEqual(chart.length, 18)
          assert.deepStrictEqual(again, chart)
          const byCode = new Map(chart.map((account) => [account.code, account]))
          assert.strictEqual(byCode.get("1200")!.parentAccountId, byCode.get("1000")!.id)
          const rules = yield* ledger.listPostingRules(scope)
          assert.strictEqual(rules.length, 11)

          const mismatchedParent = yield* Effect.flip(
            ledger.createAccount({
              principal,
              tenantId,
              code: "1210",
              name: "Notes receivable",
              type: "asset",
              parentAccountId: byCode.get("2000")!.id,
            }),
          )

          assert.instanceOf(mismatchedParent, InvalidParentAccount)

          const child = yield* ledger.createAccount({
            principal,
            tenantId,
            code: "1210",
            name: "Notes receivable",
            type: "asset",
            parentAccountId: byCode.get("1000")!.id,
          })

          assert.strictEqual(child.parentAccountId, byCode.get("1000")!.id)

          const invoice = {
            ...scope,
            postingDate: "2026-10-20",
            reference: "billing.customer_invoice/1",
            description: "Invoice INV/2026/00001",
            source,
            lines: [
              { role: "receivable", debit: "111.00", credit: "0" },
              { role: "revenue", debit: "0", credit: "100.00" },
              { role: "output_tax", debit: "0", credit: "11.00" },
            ] as const,
          }

          const posted = yield* ledger.postDocumentEntry(invoice)
          assert.strictEqual(posted.number, "JE/2026/00001")
          assert.deepStrictEqual(
            posted.lines.map((line) => line.accountId),
            [byCode.get("1200")!.id, byCode.get("4100")!.id, byCode.get("2200")!.id],
          )
          const retried = yield* ledger.postDocumentEntry(invoice)
          assert.strictEqual(retried.id, posted.id)
          assert.strictEqual(retried.number, posted.number)

          const conflicting = yield* Effect.flip(
            ledger.postDocumentEntry({
              ...invoice,
              lines: [
                { role: "receivable", debit: "50.00", credit: "0" },
                { role: "revenue", debit: "0", credit: "50.00" },
              ],
            }),
          )

          assert.instanceOf(conflicting, JournalIdempotencyConflict)

          const unbalanced = yield* Effect.flip(
            ledger.postManualEntry({
              ...scope,
              postingDate: "2026-10-21",
              reference: "manual/unbalanced",
              lines: [
                { accountId: byCode.get("1100")!.id, debit: "10.00", credit: "0" },
                { accountId: byCode.get("3100")!.id, debit: "0", credit: "9.00" },
              ],
            }),
          )

          assert.instanceOf(unbalanced, UnbalancedJournal)

          const twoSided = yield* Effect.flip(
            ledger.postManualEntry({
              ...scope,
              postingDate: "2026-10-21",
              reference: "manual/two-sided",
              lines: [
                { accountId: byCode.get("1100")!.id, debit: "10.00", credit: "10.00" },
                { accountId: byCode.get("3100")!.id, debit: "0", credit: "0" },
              ],
            }),
          )

          assert.instanceOf(twoSided, InvalidJournalLine)

          const closedDate = yield* Effect.flip(
            ledger.postManualEntry({
              ...scope,
              postingDate: "2027-01-02",
              reference: "manual/next-year",
              lines: [
                { accountId: byCode.get("1100")!.id, debit: "10.00", credit: "0" },
                { accountId: byCode.get("3100")!.id, debit: "0", credit: "10.00" },
              ],
            }),
          )

          assert.instanceOf(closedDate, AccountingPeriodNotOpen)

          const capital = yield* ledger.postManualEntry({
            ...scope,
            postingDate: "2026-10-01",
            reference: "manual/capital",
            lines: [
              { accountId: byCode.get("1100")!.id, debit: "1000.00", credit: "0" },
              { accountId: byCode.get("3100")!.id, debit: "0", credit: "1000.00" },
            ],
          })

          assert.strictEqual(capital.number, "JE/2026/00002")

          const otherEntity = yield* Effect.promise(() =>
            seedLegalEntity(client, tenantId, "Second Company"),
          )

          yield* Effect.promise(
            () => client`
              insert into accounting.accounting_periods (tenant_id, legal_entity_id, starts_on, ends_on)
              values (${tenantId}, ${otherEntity.legalEntityId}, '2026-01-01', '2026-12-31')
            `,
          )

          const missingRule = yield* Effect.flip(
            ledger.postDocumentEntry({
              ...invoice,
              legalEntityId: otherEntity.legalEntityId,
              reference: "other/1",
            }),
          )

          assert.instanceOf(missingRule, PostingRuleNotFound)

          const trialBalance = yield* ledger.trialBalance({ ...scope, to: "2026-12-31" })
          assert.strictEqual(trialBalance.totalDebit, "1111.00")
          assert.strictEqual(trialBalance.totalCredit, "1111.00")

          const [raw] = yield* Effect.promise(
            () => client<{ debit: string; credit: string }[]>`
              select sum(l.debit)::text as debit, sum(l.credit)::text as credit
              from accounting.journal_lines l
              join accounting.journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
              where e.tenant_id = ${tenantId} and e.legal_entity_id = ${legalEntityId}
                and e.status in ('posted', 'reversed')
            `,
          )

          assert.strictEqual(trialBalance.totalDebit, raw!.debit)
          assert.strictEqual(trialBalance.totalCredit, raw!.credit)
          assert.deepStrictEqual(
            trialBalance.rows.map((row) => [row.code, row.balance]),
            [
              ["1100", "1000.00"],
              ["1200", "111.00"],
              ["2200", "-11.00"],
              ["3100", "-1000.00"],
              ["4100", "-100.00"],
            ],
          )

          const cashLedger = yield* ledger.generalLedger({
            ...scope,
            accountId: byCode.get("1100")!.id,
            from: "2026-10-02",
            to: "2026-12-31",
          })

          assert.strictEqual(cashLedger.openingBalance, "1000.00")
          assert.deepStrictEqual(cashLedger.lines, [])
          assert.strictEqual(cashLedger.closingBalance, "1000.00")

          const receivable = yield* ledger.roleBalance({
            ...scope,
            role: "receivable",
            asOf: "2026-12-31",
          })

          assert.strictEqual(receivable.balance, "111.00")
        }).pipe(Effect.provide(ledgerLayer(grants)))

        // The database rejects an unbalanced posting even when application validation is bypassed.
        const unbalancedInsert = yield* Effect.tryPromise({
          try: () =>
            client.begin(async (sql) => {
              const [entry] = await sql<{ id: string }[]>`
              insert into accounting.journal_entries (tenant_id, reference)
              values (${tenantId}, 'raw/unbalanced') returning id
            `

              const [account] = await sql<{ id: string }[]>`
              select id from accounting.accounts where tenant_id = ${tenantId} limit 1
            `

              await sql`
              insert into accounting.journal_lines (tenant_id, entry_id, account_id, debit, credit)
              values (${tenantId}, ${entry!.id}, ${account!.id}, 5, 0),
                     (${tenantId}, ${entry!.id}, ${account!.id}, 0, 4)
            `
              await sql`
              update accounting.journal_entries set status = 'posted', posted_at = now()
              where id = ${entry!.id}
            `
            }),
          catch: (cause) => cause,
        }).pipe(Effect.flip)

        assert.include(
          String(postgresConstraint(unbalancedInsert)),
          "journal_entries_balanced_check",
        )

        const denied = yield* Effect.gen(function* () {
          const ledger = yield* GeneralLedgerService

          return yield* Effect.flip(
            ledger.trialBalance({ principal, tenantId, legalEntityId, to: "2026-12-31" }),
          )
        }).pipe(Effect.provide(ledgerLayer([])))

        assert.instanceOf(denied, AuthorizationDenied)
      }),
    ),
  { timeout: 120_000 },
)
