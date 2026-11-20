import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"

import { uuidv7 } from "../../framework/foundation/mod.ts"
import { AuthorizationDenied } from "../../framework/modules/authorization/mod.ts"
import { runMigrations } from "../../framework/platform/mod.ts"
import {
  AccountingCapabilities,
  AccountingLegalEntityNotFound,
  AccountNotFound,
  GeneralLedgerService,
} from "../../erp/modules/accounting/mod.ts"
import { BillingCapabilities, BillingService } from "../../erp/modules/billing/mod.ts"
import { InventoryCapabilities, StockKeepingService } from "../../erp/modules/inventory/mod.ts"
import { PartyCapabilities, PartyService } from "../../erp/modules/party/mod.ts"
import { OrderToCashService } from "../../erp/modules/process/mod.ts"
import { ProductCapabilities, ProductService } from "../../erp/modules/product/mod.ts"
import {
  SalesCapabilities,
  SalesDocumentService,
  SalesService,
} from "../../erp/modules/sales/mod.ts"
import {
  BankMatchExceedsAvailable,
  BankMatchMismatch,
  BankMatchNotFound,
  InvalidBankStatement,
  InvalidWithholding,
  SettlementCapabilities,
  SettlementService,
} from "../../erp/modules/settlement/mod.ts"
import { TaxCapabilities } from "../../erp/modules/tax/mod.ts"
import { seedErpFixture } from "../support/erp-fixture.ts"
import { erpChainLayers } from "../support/erp-layers.ts"
import { postgresConstraint } from "../support/postgres-error.ts"
import { withTemporaryDatabase } from "../support/postgres-database.ts"

const databaseUrl = process.env["DATABASE_URL"]
const principal = { userAccountId: "bank-user", sessionId: "bank-session" }
const importer = { userAccountId: "bank-importer", sessionId: "importer-session" }
const stranger = { userAccountId: "bank-stranger", sessionId: "stranger-session" }

const postgresFailure = <A>(effect: () => Promise<A>) =>
  Effect.tryPromise({ try: effect, catch: (cause) => cause }).pipe(Effect.flip)

// [SET-BANK-2] [SET-BANK-3] [SET-WHT-1]
it.effect.skipIf(databaseUrl === undefined)(
  "imports a bank statement once, matches lines to payment cash, and clears a receivable net of withholding",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const fixture = yield* seedErpFixture(client)
        const { tenantId, legalEntityId } = fixture

        const [warehouse] = yield* Effect.promise(
          () => client<{ id: string }[]>`
            insert into inventory.warehouses (tenant_id, legal_entity_id, name)
            values (${tenantId}, ${legalEntityId}, 'Main') returning id
          `,
        )

        const grants = [
          ...[
            ...Object.values(AccountingCapabilities),
            ...Object.values(BillingCapabilities),
            ...Object.values(InventoryCapabilities),
            ...Object.values(PartyCapabilities),
            ...Object.values(ProductCapabilities),
            ...Object.values(SalesCapabilities),
            ...Object.values(SettlementCapabilities),
            ...Object.values(TaxCapabilities),
          ].map((capability) => ({ userAccountId: principal.userAccountId, tenantId, capability })),
          {
            userAccountId: importer.userAccountId,
            tenantId,
            capability: SettlementCapabilities.bankStatementImport,
          },
        ]

        yield* Effect.gen(function* () {
          const ledger = yield* GeneralLedgerService
          const party = yield* PartyService
          const products = yield* ProductService
          const stock = yield* StockKeepingService
          const salesDocuments = yield* SalesDocumentService
          const sales = yield* SalesService
          const orderToCash = yield* OrderToCashService
          const billing = yield* BillingService
          const settlement = yield* SettlementService
          const scope = { principal, tenantId }

          // One invoice of 100.00 for a delivered order, and the accounts the cash moves through.
          yield* ledger.applyChartTemplate({ ...scope, legalEntityId, template: "neutral_trading" })

          const bank = yield* ledger.createAccount({
            ...scope,
            code: "BANK-MAIN",
            name: "Bank main",
            type: "asset",
          })

          const otherBank = yield* ledger.createAccount({
            ...scope,
            code: "BANK-OTHER",
            name: "Bank other",
            type: "asset",
          })

          const withheldTax = yield* ledger.createAccount({
            ...scope,
            code: "TAX-WITHHELD",
            name: "Tax withheld by customers",
            type: "asset",
          })

          const buyer = yield* party.create({ ...scope, kind: "organization", name: "PT Pembeli" })
          yield* party.assignRole({ ...scope, partyId: buyer.id, role: "customer" })

          const relationship = yield* party.createRelationship({
            ...scope,
            partyId: buyer.id,
            legalEntityId,
            kind: "customer",
          })

          const customer = yield* salesDocuments.createPartyCustomer({
            ...scope,
            partyRelationshipId: relationship.id,
            email: "finance@pembeli.test",
          })

          const widget = yield* products.createProduct({
            ...scope,
            code: "WIDGET",
            name: "Widget",
            type: "stockable",
          })

          yield* stock.registerProductItem({ ...scope, productId: widget.id })
          yield* stock.receiveValued({
            ...scope,
            warehouseId: warehouse!.id,
            postingDate: "2026-10-01",
            source: { type: "inventory.opening_stock", id: uuidv7() },
            counterRole: "inventory_adjustment",
            lines: [{ itemId: widget.id, quantity: "100", unitCost: "6.00" }],
          })

          const priceList = yield* salesDocuments.createPriceList({
            ...scope,
            name: "Retail IDR",
            currency: "IDR",
          })

          yield* salesDocuments.setPrice({
            ...scope,
            priceListId: priceList.id,
            productId: widget.id,
            unitPrice: "10.00",
          })
          yield* salesDocuments.assignCustomerPriceList({
            ...scope,
            customerId: customer.id,
            priceListId: priceList.id,
          })

          const quotation = yield* salesDocuments.draftQuotation({
            ...scope,
            customerId: customer.id,
            validUntil: "2026-10-31",
            lines: [{ productId: widget.id, quantity: "10" }],
          })

          yield* salesDocuments.sendQuotation({ ...scope, quotationId: quotation.id })
          yield* salesDocuments.acceptQuotation({ ...scope, quotationId: quotation.id })

          const { orderId } = yield* salesDocuments.convertQuotation({
            ...scope,
            quotationId: quotation.id,
          })

          yield* sales.confirmOrder({
            ...scope,
            orderId,
            commandId: uuidv7(),
            correlationId: uuidv7(),
            idempotencyKey: `confirm-${orderId}`,
          })

          const order = yield* salesDocuments.getFulfillment({ ...scope, orderId })

          yield* orderToCash.deliverOrder({
            ...scope,
            orderId,
            warehouseId: warehouse!.id,
            deliveryDate: "2026-10-05",
            lines: [{ orderLineId: order.lines[0]!.orderLineId, quantity: "10" }],
          })

          const invoice = yield* billing.invoiceSalesOrder({
            ...scope,
            orderId,
            invoiceDate: "2026-10-06",
          })

          assert.strictEqual(invoice.total, "100.00")

          // Importing a statement stores its lines once; the same content returns the same statement.
          const file = [
            "date,description,reference,amount",
            "2026-10-10,Transfer PT Pembeli 1,,39.20",
            "2026-10-20,Transfer PT Pembeli 2,,58.80",
            "2026-10-21,Biaya admin,,-6.50",
          ].join("\n")

          const importFile = (content: string, bankAccountId = bank.id) =>
            settlement.importBankStatement({
              ...scope,
              legalEntityId,
              bankAccountId,
              sourceName: "oct.csv",
              content,
            })

          const statement = yield* importFile(file)
          const repeated = yield* importFile(file)

          assert.strictEqual(statement.lineCount, 3)
          assert.deepStrictEqual(repeated, statement)

          const rejected = yield* Effect.flip(importFile(`${file}\n2026-10-22,Rusak,,1.234`))

          assert.instanceOf(rejected, InvalidBankStatement)
          assert.strictEqual(rejected.row, 5)

          // An unknown bank account or legal entity is a business failure, not a database one.
          const unknownAccount = yield* Effect.flip(importFile(file, uuidv7()))

          assert.instanceOf(unknownAccount, AccountNotFound)

          const unknownEntity = yield* Effect.flip(
            settlement.importBankStatement({
              ...scope,
              legalEntityId: uuidv7(),
              bankAccountId: bank.id,
              sourceName: "oct.csv",
              content: file,
            }),
          )

          assert.instanceOf(unknownEntity, AccountingLegalEntityNotFound)

          const counts = yield* Effect.promise(
            () => client<{ statements: number; lines: number }[]>`
              select
                (select count(*)::int from settlement.bank_statements) as statements,
                (select count(*)::int from settlement.bank_statement_lines) as lines
            `,
          )

          assert.deepStrictEqual(counts[0], { statements: 1, lines: 3 })

          const otherStatement = yield* importFile(
            "date,description,reference,amount\n2026-10-11,Other bank,,1.00",
            otherBank.id,
          )

          // Withheld tax must leave cash in the payment and be allocated to documents.
          const receipt = (input: {
            readonly paymentDate: string
            readonly amount: string
            readonly withheld: string
            readonly reference: string
            readonly allocated: string
          }) =>
            settlement.receivePayment({
              ...scope,
              legalEntityId,
              partyId: buyer.id,
              paymentDate: input.paymentDate,
              amount: input.amount,
              cashAccountId: bank.id,
              withholding: {
                amount: input.withheld,
                certificateReference: input.reference,
                accountId: withheldTax.id,
              },
              allocations: [{ invoiceId: invoice.id, amount: input.allocated }],
            })

          const noCash = yield* Effect.flip(
            receipt({
              paymentDate: "2026-10-10",
              amount: "40.00",
              withheld: "40.00",
              reference: "BP-0",
              allocated: "40.00",
            }),
          )

          assert.instanceOf(noCash, InvalidWithholding)
          assert.strictEqual(noCash.reason, "not_below_payment")

          const unallocated = yield* Effect.flip(
            receipt({
              paymentDate: "2026-10-10",
              amount: "40.00",
              withheld: "5.00",
              reference: "BP-0",
              allocated: "4.00",
            }),
          )

          assert.instanceOf(unallocated, InvalidWithholding)
          assert.strictEqual(unallocated.reason, "not_allocated")

          // A partial payment of 40.00 of which 0.80 was withheld: 39.20 arrives as cash.
          const first = yield* receipt({
            paymentDate: "2026-10-10",
            amount: "40.00",
            withheld: "0.80",
            reference: "BP-0001",
            allocated: "40.00",
          })

          assert.deepStrictEqual(first.withholding, {
            amount: "0.80",
            certificateReference: "BP-0001",
            accountId: withheldTax.id,
          })
          assert.strictEqual(first.unallocatedAmount, "0.00")

          const balances = (asOf: string) =>
            Effect.gen(function* () {
              const closing = (accountId: string) =>
                ledger
                  .generalLedger({
                    ...scope,
                    legalEntityId,
                    accountId,
                    from: "2026-10-01",
                    to: asOf,
                  })
                  .pipe(Effect.map((report) => report.closingBalance))

              const aging = yield* settlement.aging({
                ...scope,
                legalEntityId,
                side: "receivable",
                asOf,
              })

              const receivable = yield* ledger.roleBalance({
                ...scope,
                legalEntityId,
                role: "receivable",
                asOf,
              })

              return {
                open: (yield* billing.getDocument({ ...scope, invoiceId: invoice.id })).openAmount,
                receivable: receivable.balance,
                aging: aging.totals.total,
                cash: yield* closing(bank.id),
                withheld: yield* closing(withheldTax.id),
              }
            })

          // The residual receivable is 60.00 in the document, the ledger, and the aging report.
          assert.deepStrictEqual(yield* balances("2026-12-31"), {
            open: "60.00",
            receivable: "60.00",
            aging: "60.00",
            cash: "39.20",
            withheld: "0.80",
          })

          const view = () =>
            settlement.bankReconciliation({ ...scope, legalEntityId, bankAccountId: bank.id })

          const before = yield* view()

          assert.deepStrictEqual(
            before.lines.map((line) => [line.amount, line.unmatchedAmount]),
            [
              ["39.20", "39.20"],
              ["58.80", "58.80"],
              ["-6.50", "6.50"],
            ],
          )
          assert.deepStrictEqual(
            before.payments.map((payment) => [payment.number, payment.unmatchedCash]),
            [[first.number, "39.20"]],
          )

          const nextLines = yield* settlement.bankReconciliation({
            ...scope,
            legalEntityId,
            bankAccountId: bank.id,
            lineOffset: 1,
            paymentOffset: 1,
            limit: 1,
          })

          assert.strictEqual(nextLines.lines[0]?.id, before.lines[1]?.id)
          assert.deepStrictEqual(nextLines.payments, [])

          const [line1, line2, line3] = before.lines

          const match = (lineId: string, paymentId: string, amount: string) =>
            settlement.matchBankLine({ ...scope, lineId, paymentId, amount })

          // Only the cash is matched, never the withheld part, and only within the line.
          const tooMuch = yield* Effect.flip(match(line1!.id, first.id, "40.00"))

          assert.instanceOf(tooMuch, BankMatchExceedsAvailable)
          assert.strictEqual(tooMuch.available, "39.20")

          const wrongDirection = yield* Effect.flip(match(line3!.id, first.id, "1.00"))

          assert.instanceOf(wrongDirection, BankMatchMismatch)
          assert.strictEqual(wrongDirection.reason, "direction")

          const otherLine = (yield* settlement.bankReconciliation({
            ...scope,
            legalEntityId,
            bankAccountId: otherBank.id,
          })).lines[0]!

          assert.strictEqual(otherLine.statementId, otherStatement.id)

          const wrongAccount = yield* Effect.flip(match(otherLine.id, first.id, "1.00"))

          assert.instanceOf(wrongAccount, BankMatchMismatch)
          assert.strictEqual(wrongAccount.reason, "bank_account")

          // Importing and reconciling are separate capabilities, and neither is open to strangers.
          const noImport = yield* Effect.flip(
            settlement.importBankStatement({
              principal: stranger,
              tenantId,
              legalEntityId,
              bankAccountId: bank.id,
              sourceName: "x.csv",
              content: file,
            }),
          )

          assert.instanceOf(noImport, AuthorizationDenied)

          const noReport = yield* Effect.flip(
            settlement.bankReconciliation({
              principal: stranger,
              tenantId,
              legalEntityId,
              bankAccountId: bank.id,
            }),
          )

          assert.instanceOf(noReport, AuthorizationDenied)

          const noMatch = yield* Effect.flip(
            settlement.matchBankLine({
              principal: importer,
              tenantId,
              lineId: line1!.id,
              paymentId: first.id,
              amount: "1.00",
            }),
          )

          assert.instanceOf(noMatch, AuthorizationDenied)

          // A retried match id returns the recorded match; matching again beyond the line is refused.
          const matchId = uuidv7()

          const matchWithId = settlement.matchBankLine({
            ...scope,
            matchId,
            lineId: line1!.id,
            paymentId: first.id,
            amount: "39.20",
          })

          const matched = yield* matchWithId
          const replayed = yield* matchWithId

          assert.deepStrictEqual(replayed, matched)
          assert.deepStrictEqual(matched, {
            id: matchId,
            tenantId,
            lineId: line1!.id,
            paymentId: first.id,
            amount: "39.20",
            reversed: false,
          })

          const nothingLeft = yield* Effect.flip(match(line1!.id, first.id, "0.01"))

          assert.instanceOf(nothingLeft, BankMatchExceedsAvailable)
          assert.strictEqual(nothingLeft.available, "0.00")
          assert.deepStrictEqual((yield* view()).payments, [])
          const activeMatches = (yield* view()).matches
          assert.strictEqual(activeMatches[0]?.id, matchId)
          assert.strictEqual(activeMatches[0]?.paymentNumber, first.number)
          assert.deepStrictEqual(
            (yield* settlement.bankReconciliation({
              ...scope,
              legalEntityId,
              bankAccountId: bank.id,
              afterMatchId: matchId,
            })).matches,
            [],
          )
          assert.deepStrictEqual(
            (yield* settlement.bankReconciliation({
              ...scope,
              legalEntityId,
              bankAccountId: otherBank.id,
            })).matches,
            [],
          )

          // A reversed match leaves the line and the cash unmatched again; reversing twice is safe.
          const reversed = yield* settlement.reverseBankMatch({ ...scope, matchId })
          const reversedAgain = yield* settlement.reverseBankMatch({ ...scope, matchId })

          assert.strictEqual(reversed.reversed, true)
          assert.deepStrictEqual(reversedAgain, reversed)
          assert.strictEqual((yield* view()).lines.length, 3)
          assert.deepStrictEqual((yield* view()).matches, [])

          const unknown = yield* Effect.flip(
            settlement.reverseBankMatch({ ...scope, matchId: uuidv7() }),
          )

          assert.instanceOf(unknown, BankMatchNotFound)

          // Two simultaneous matches of the whole line: only one fits.
          const race = yield* Effect.all(
            [match(line1!.id, first.id, "39.20"), match(line1!.id, first.id, "39.20")].map(
              (attempt) => Effect.result(attempt),
            ),
            { concurrency: 2 },
          )

          assert.strictEqual(race.filter(Result.isSuccess).length, 1)
          assert.instanceOf(race.find(Result.isFailure)?.failure, BankMatchExceedsAvailable)

          // The second partial payment clears the receivable: 60.00 settled, 58.80 of it cash.
          const second = yield* receipt({
            paymentDate: "2026-10-20",
            amount: "60.00",
            withheld: "1.20",
            reference: "BP-0002",
            allocated: "60.00",
          })

          yield* match(line2!.id, second.id, "58.80")

          assert.deepStrictEqual(yield* balances("2026-12-31"), {
            open: "0.00",
            receivable: "0.00",
            aging: "0.00",
            cash: "98.00",
            withheld: "2.00",
          })

          // What is left unmatched stays visible: the bank fee has no payment behind it.
          const after = yield* view()

          assert.deepStrictEqual(
            after.lines.map((line) => [line.lineNumber, line.unmatchedAmount]),
            [[3, "6.50"]],
          )
          assert.deepStrictEqual(after.payments, [])

          // The database refuses what the service would: edits to imported evidence, matches
          // beyond a line, and withheld tax left unallocated.
          const edit = yield* postgresFailure(
            () => client`
              update settlement.bank_statement_lines set amount = 1.00 where id = ${line1!.id}
            `,
          )

          assert.strictEqual(postgresConstraint(edit), "settlement_bank_evidence_immutable")

          // These checks are deferred to commit, so each runs in an explicit transaction.
          const overMatch = yield* postgresFailure(() =>
            client.begin(
              (transaction) => transaction`
                insert into settlement.bank_line_matches
                  (tenant_id, line_id, payment_id, amount, matched_by)
                values (${tenantId}, ${line2!.id}, ${first.id}, 1.00, 'sql')
              `,
            ),
          )

          assert.strictEqual(postgresConstraint(overMatch), "bank_line_matches_line_total_check")

          const unallocatedWithholding = yield* postgresFailure(() =>
            client.begin(
              (transaction) => transaction`
                insert into settlement.payments
                  (tenant_id, legal_entity_id, direction, party_id, number, payment_date, amount,
                   unallocated_amount, journal_entry_id, withheld_amount, withholding_reference,
                   withholding_account_id)
                values (${tenantId}, ${legalEntityId}, 'incoming', ${buyer.id}, 'RCV/SQL/1',
                  '2026-10-25', 10.00, 10.00, ${uuidv7()}, 1.00, 'BP-SQL', ${withheldTax.id})
              `,
            ),
          )

          assert.strictEqual(
            postgresConstraint(unallocatedWithholding),
            "settlement_withholding_allocated_check",
          )
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 180_000 },
)
