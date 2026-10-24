import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { uuidv7 } from "../../framework/foundation/mod.ts"
import { NumberingService } from "../../framework/modules/numbering/mod.ts"
import { runMigrations } from "../../framework/platform/mod.ts"
import { AccountingCapabilities, GeneralLedgerService } from "../../erp/modules/accounting/mod.ts"
import { PartyCapabilities, PartyService } from "../../erp/modules/party/mod.ts"
import { SettlementCapabilities, SettlementService } from "../../erp/modules/settlement/mod.ts"
import { seedErpFixture } from "../support/erp-fixture.ts"
import { erpChainLayers } from "../support/erp-layers.ts"
import { withTemporaryDatabase } from "../support/postgres-database.ts"

const databaseUrl = process.env["DATABASE_URL"]
const principal = { userAccountId: "fiscal-user", sessionId: "fiscal-session" }

it.effect.skipIf(databaseUrl === undefined)(
  "numbers every document by the legal entity's fiscal year",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const fixture = yield* seedErpFixture(client)
        const { tenantId, legalEntityId } = fixture
        // A fiscal year that starts in April.
        yield* Effect.promise(
          () => client`
            update accounting.legal_entity_accounting_configurations
            set fiscal_year_start_month = 4
            where tenant_id = ${tenantId} and legal_entity_id = ${legalEntityId}
          `,
        )

        const grants = [
          ...Object.values(AccountingCapabilities),
          ...Object.values(PartyCapabilities),
          ...Object.values(SettlementCapabilities),
        ].map((capability) => ({ userAccountId: principal.userAccountId, tenantId, capability }))

        yield* Effect.gen(function* () {
          const ledger = yield* GeneralLedgerService
          const party = yield* PartyService
          const settlement = yield* SettlementService
          const numbering = yield* NumberingService
          const scope = { principal, tenantId }

          // Documents owned by modules that never pass a fiscal-year month.
          const delivery = (documentDate: string) =>
            numbering.allocate({
              tenantId,
              scopeId: legalEntityId,
              documentType: "sales.delivery",
              documentId: uuidv7(),
              documentDate,
              prefix: "DO/",
            })

          assert.strictEqual((yield* delivery("2026-03-31")).number, "DO/2025/00001")
          assert.strictEqual((yield* delivery("2026-04-01")).number, "DO/2026/00001")
          assert.strictEqual((yield* delivery("2026-04-02")).number, "DO/2026/00002")

          // The same calendar reaches real documents, here receipts through Settlement.
          yield* ledger.applyChartTemplate({ ...scope, legalEntityId, template: "neutral_trading" })

          const customer = yield* party.create({
            ...scope,
            kind: "organization",
            name: "PT Pembeli",
          })

          const receipt = (paymentDate: string) =>
            settlement.receivePayment({
              ...scope,
              legalEntityId,
              partyId: customer.id,
              paymentDate,
              amount: "10.00",
              allocations: [],
            })

          assert.strictEqual((yield* receipt("2026-03-31")).number, "RCV/2025/00001")
          assert.strictEqual((yield* receipt("2026-04-01")).number, "RCV/2026/00001")

          // The ledger agrees: journals use the same fiscal years.
          const journals = yield* Effect.promise(
            () => client<{ number: string }[]>`
              select number from accounting.journal_entries
              where tenant_id = ${tenantId} order by posting_date, number
            `,
          )

          assert.deepStrictEqual(
            journals.map((journal) => journal.number),
            ["JE/2025/00001", "JE/2026/00001"],
          )
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 120_000 },
)
