import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"

import { uuidv7 } from "../../framework/foundation/mod.ts"
import { AuthorizationDenied } from "../../framework/modules/authorization/mod.ts"
import { runMigrations } from "../../framework/platform/mod.ts"
import {
  AccountingCapabilities,
  ExchangeRateService,
  GeneralLedgerService,
} from "../../erp/modules/accounting/mod.ts"
import { BillingCapabilities } from "../../erp/modules/billing/mod.ts"
import { InsightsService } from "../../erp/modules/insights/mod.ts"
import { InventoryCapabilities } from "../../erp/modules/inventory/mod.ts"
import { OrgUnitService, PartyCapabilities } from "../../erp/modules/party/mod.ts"
import { SalesCapabilities } from "../../erp/modules/sales/mod.ts"
import { SettlementCapabilities } from "../../erp/modules/settlement/mod.ts"
import { seedErpFixture, seedLegalEntity } from "../support/erp-fixture.ts"
import { erpChainLayers } from "../support/erp-layers.ts"
import { postgresConstraint } from "../support/postgres-error.ts"
import { withTemporaryDatabase } from "../support/postgres-database.ts"

const databaseUrl = process.env["DATABASE_URL"]
const admin = { userAccountId: "grp-admin", sessionId: "grp-admin-session" }
const stranger = { userAccountId: "grp-stranger", sessionId: "grp-stranger-session" }

// ADR-0130: organization units select legal entities; consolidation translates and totals them.
it.effect.skipIf(databaseUrl === undefined)(
  "selects legal entities by unit and consolidates them in the group currency",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const { tenantId, legalEntityId: idrEntity } = yield* seedErpFixture(client)
        const second = yield* Effect.promise(() => seedLegalEntity(client, tenantId, "Subsidiary"))
        const usdEntity = second.legalEntityId

        // The second entity keeps its books in dollars, in an open period.
        yield* Effect.promise(async () => {
          await client`
            update accounting.legal_entity_accounting_configurations
            set base_currency = 'USD' where tenant_id = ${tenantId} and legal_entity_id = ${usdEntity}
          `

          await client`
            insert into accounting.accounting_periods (tenant_id, legal_entity_id, starts_on, ends_on)
            values (${tenantId}, ${usdEntity}, '2026-01-01', '2026-12-31')
          `
        })

        const grants = [
          ...Object.values(AccountingCapabilities),
          ...Object.values(BillingCapabilities),
          ...Object.values(InventoryCapabilities),
          ...Object.values(PartyCapabilities),
          ...Object.values(SalesCapabilities),
          ...Object.values(SettlementCapabilities),
        ].map((capability) => ({ userAccountId: admin.userAccountId, tenantId, capability }))

        yield* Effect.gen(function* () {
          const units = yield* OrgUnitService
          const rates = yield* ExchangeRateService
          const ledger = yield* GeneralLedgerService
          const insights = yield* InsightsService
          const scope = { principal: admin, tenantId }

          yield* TestClock.setTime(Date.parse("2026-10-20T03:00:00.000Z"))

          // ---- The tree: a root group carries the currency, nothing else does.
          const root = yield* units.create({
            ...scope,
            kind: "group",
            name: "Grup",
            currency: "IDR",
          })

          assert.strictEqual(root.currency, "IDR")

          const unit = yield* units.create({
            ...scope,
            kind: "business_unit",
            name: "Unit Asia",
            parentId: root.id,
          })

          assert.strictEqual(unit.currency, "IDR")

          for (const refused of [
            { kind: "business_unit", name: "No parent" },
            { kind: "group", name: "No currency" },
            {
              kind: "business_unit",
              name: "Child with currency",
              parentId: root.id,
              currency: "USD",
            },
          ] as const) {
            assert.strictEqual(
              (yield* Effect.flip(units.create({ ...scope, ...refused })))._tag,
              "OrgUnitInvalid",
            )
          }

          assert.strictEqual(
            (yield* Effect.flip(
              units.create({
                ...scope,
                kind: "business_unit",
                name: "x",
                parentId: uuidv7(),
              }),
            ))._tag,
            "OrgUnitNotFound",
          )

          // ---- Membership: one unit per entity; a unit selects everything under it.
          yield* units.assignLegalEntity({ ...scope, legalEntityId: idrEntity, unitId: root.id })
          yield* units.assignLegalEntity({ ...scope, legalEntityId: usdEntity, unitId: unit.id })

          const ids = (resolved: { legalEntityIds: ReadonlyArray<string> }) =>
            resolved.legalEntityIds.toSorted()

          assert.deepStrictEqual(
            ids(yield* units.resolve({ ...scope, unitId: root.id })),
            [idrEntity, usdEntity].toSorted(),
          )

          assert.deepStrictEqual(ids(yield* units.resolve({ ...scope, unitId: unit.id })), [
            usdEntity,
          ])

          // Putting an entity in another unit takes it out of the first.
          yield* units.assignLegalEntity({ ...scope, legalEntityId: usdEntity, unitId: root.id })
          assert.deepStrictEqual(ids(yield* units.resolve({ ...scope, unitId: unit.id })), [])
          yield* units.assignLegalEntity({ ...scope, legalEntityId: usdEntity, unitId: unit.id })

          assert.strictEqual(
            (yield* Effect.flip(
              units.assignLegalEntity({
                ...scope,
                legalEntityId: uuidv7(),
                unitId: root.id,
              }),
            ))._tag,
            "OrgUnitInvalid",
          )

          // ---- Moving: the subtree follows, a cycle is refused, a root does not move.
          const inner = yield* units.create({
            ...scope,
            kind: "business_unit",
            name: "Inner",
            parentId: unit.id,
          })

          yield* units.assignLegalEntity({ ...scope, legalEntityId: idrEntity, unitId: inner.id })

          const sibling = yield* units.create({
            ...scope,
            kind: "business_unit",
            name: "Sibling",
            parentId: root.id,
          })

          yield* units.move({ ...scope, unitId: unit.id, parentId: sibling.id })
          assert.deepStrictEqual(
            ids(yield* units.resolve({ ...scope, unitId: sibling.id })),
            [idrEntity, usdEntity].toSorted(),
          )

          assert.strictEqual(
            (yield* Effect.flip(units.move({ ...scope, unitId: sibling.id, parentId: inner.id })))
              ._tag,
            "OrgUnitInvalid",
          )

          assert.strictEqual(
            (yield* Effect.flip(units.move({ ...scope, unitId: root.id, parentId: sibling.id })))
              ._tag,
            "OrgUnitInvalid",
          )

          yield* units.move({ ...scope, unitId: unit.id, parentId: root.id })
          assert.deepStrictEqual(ids(yield* units.resolve({ ...scope, unitId: sibling.id })), [])

          // ---- Rates: the latest on or before the day, never between two currencies that are one.
          yield* rates.set({
            ...scope,
            fromCurrency: "USD",
            toCurrency: "IDR",
            rateDate: "2026-09-30",
            rate: "15000",
          })
          yield* rates.set({
            ...scope,
            fromCurrency: "USD",
            toCurrency: "IDR",
            rateDate: "2026-10-31",
            rate: "16000.5",
          })

          const found = (asOf: string) =>
            rates.find({ ...scope, fromCurrency: "USD", toCurrency: "IDR", asOf })

          assert.strictEqual((yield* found("2026-10-15"))?.rate, "15000")
          assert.strictEqual((yield* found("2026-10-31"))?.rate, "16000.5")
          assert.isNull(yield* found("2026-08-31"))

          assert.strictEqual(
            (yield* Effect.flip(
              rates.set({
                ...scope,
                fromCurrency: "IDR",
                toCurrency: "IDR",
                rateDate: "2026-10-31",
                rate: "1",
              }),
            ))._tag,
            "ExchangeRateInvalid",
          )

          // ---- Books: 1000.00 of revenue in rupiah and 200.00 in dollars, taken in cash.
          for (const entity of [idrEntity, usdEntity]) {
            yield* ledger.applyChartTemplate({
              ...scope,
              legalEntityId: entity,
              template: "neutral_trading",
            })
          }

          const chart = yield* ledger.listChart(scope)
          const account = (code: string) => chart.find((row) => row.code === code)!.id

          for (const [entity, amount] of [
            [idrEntity, "1000.00"],
            [usdEntity, "200.00"],
          ] as const) {
            yield* ledger.postManualEntry({
              ...scope,
              legalEntityId: entity,
              postingDate: "2026-10-15",
              reference: `sale/${entity}`,
              lines: [
                { accountId: account("1100"), debit: amount, credit: "0" },
                { accountId: account("4100"), debit: "0", credit: amount },
              ],
            })
          }

          // ---- Statements in the group currency: 200.00 at 16000.5 is 3200100.00.
          const statements = yield* insights.groupStatements({
            ...scope,
            unitId: root.id,
            from: "2026-10-01",
            to: "2026-10-31",
          })

          assert.strictEqual(statements.groupCurrency, "IDR")
          assert.isFalse(statements.intercompanyEliminated)
          assert.deepStrictEqual(
            statements.entities.map((entity) => entity.status),
            ["ok", "ok"],
          )
          assert.strictEqual(statements.totals["revenue"], "3201100.00")
          assert.isTrue(statements.complete["revenue"])

          const dollars = statements.entities.find((entity) => entity.legalEntityId === usdEntity)!
          assert.strictEqual(dollars.currency, "USD")
          assert.strictEqual(dollars.rate, "16000.5")
          assert.strictEqual(dollars.figures["revenue"], "200.00")
          assert.strictEqual(dollars.translated["revenue"], "3200100.00")

          // Before any rate was entered the dollar entity cannot be translated: marked, not zero.
          const early = yield* insights.groupStatements({
            ...scope,
            unitId: root.id,
            from: "2026-08-01",
            to: "2026-08-31",
          })

          const unconverted = early.entities.find((entity) => entity.legalEntityId === usdEntity)!
          assert.strictEqual(unconverted.status, "unavailable")
          assert.isNull(unconverted.translated["revenue"])
          assert.isFalse(early.complete["revenue"])

          // ---- KPIs: cash in the group currency, with the previous month beside it.
          const kpis = yield* insights.groupKpis({ ...scope, unitId: root.id, period: "2026-10" })
          assert.strictEqual(kpis.totals["cash"], "3201100.00")
          assert.strictEqual(kpis.totals["cashPrevious"], "0.00")
          assert.isTrue(kpis.complete["cash"])
          assert.strictEqual(
            kpis.entities.find((entity) => entity.legalEntityId === usdEntity)!.previousRate,
            "15000",
          )

          // ---- A caller who may not read gets nothing about the group.
          assert.instanceOf(
            yield* Effect.flip(units.resolve({ principal: stranger, tenantId, unitId: root.id })),
            AuthorizationDenied,
          )

          // ---- The tree is strict in the database too: a second root without currency, a self parent.
          const selfParent = yield* Effect.tryPromise({
            try: () => client`update party.org_units set parent_id = id where id = ${unit.id}`,
            catch: (cause) => cause,
          }).pipe(Effect.flip)

          assert.strictEqual(postgresConstraint(selfParent), "org_units_acyclic")
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 300_000 },
)
