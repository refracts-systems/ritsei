import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { uuidv7 } from "../../../../framework/foundation/mod.ts"
import { runMigrations } from "../../../../framework/platform/mod.ts"
import { erpChainLayers } from "../../../../tests/support/erp-layers.ts"
import { seedErpFixture } from "../../../../tests/support/erp-fixture.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { AccountingCapabilities, GeneralLedgerService } from "../../accounting/mod.ts"
import { ProductCapabilities, ProductService } from "../../product/mod.ts"
import {
  InventoryCapabilities,
  OpeningStockAlreadyLoaded,
  OpeningStockConflict,
  StockKeepingService,
} from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const principal = { userAccountId: "opening-user", sessionId: "opening-session" }

it.effect.skipIf(databaseUrl === undefined)(
  "loads the opening position once, revalues it with approval, and posts it against clearing",
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
          ...Object.values(InventoryCapabilities),
          ...Object.values(ProductCapabilities),
          AccountingCapabilities.chartApply,
          AccountingCapabilities.postingRuleConfigure,
          AccountingCapabilities.documentJournalPost,
          AccountingCapabilities.ledgerRead,
        ].map((capability) => ({ userAccountId: principal.userAccountId, tenantId, capability }))

        const loaded = yield* Effect.gen(function* () {
          const products = yield* ProductService
          const stock = yield* StockKeepingService
          const ledger = yield* GeneralLedgerService
          const scope = { principal, tenantId }

          yield* ledger.applyChartTemplate({ ...scope, legalEntityId, template: "neutral_trading" })

          const widget = yield* products.createProduct({
            ...scope,
            code: "WIDGET",
            name: "Widget",
            type: "stockable",
          })

          const gadget = yield* products.createProduct({
            ...scope,
            code: "GADGET",
            name: "Gadget",
            type: "stockable",
          })

          yield* stock.registerProductItem({ ...scope, productId: widget.id })
          yield* stock.registerProductItem({ ...scope, productId: gadget.id })

          const untouched = {
            tracking: "none",
            reservedQuantity: "0",
            inTransitQuantity: "0",
          } as const

          const opening = {
            ...scope,
            warehouseId: warehouse!.id,
            openingId: uuidv7(),
            cutoffDate: "2026-12-31",
            revaluation: {
              name: "FIFO to moving average at cutoff",
              approvedBy: "finance-owner",
              approvedAt: "2026-12-31T23:59:00Z",
              reference: "CUTOVER-2026-12-31",
            },
            lines: [
              {
                ...untouched,
                itemId: widget.id,
                quantity: "10",
                sourceValue: "100.00",
                movingAverageValue: "90.00",
              },
              { ...untouched, itemId: gadget.id, quantity: "5", sourceValue: "50.00" },
            ],
          } as const

          const result = yield* stock.loadOpeningStock(opening)
          assert.strictEqual(result.cutoffDate, "2026-12-31")
          assert.strictEqual(result.valueToClear, "150.00")
          assert.strictEqual(result.adjustment, "-10.00")
          assert.strictEqual(result.value, "140.00")
          assert.notStrictEqual(result.journalEntryId, null)

          // A retry of the same document returns the recorded load and posts nothing new.
          assert.deepStrictEqual(yield* stock.loadOpeningStock(opening), result)

          const changed = yield* Effect.flip(
            stock.loadOpeningStock({
              ...opening,
              lines: [{ ...opening.lines[0], quantity: "11" }, opening.lines[1]],
            }),
          )

          assert.instanceOf(changed, OpeningStockConflict)

          // A second document cannot open the same warehouse and item again.
          const again = yield* Effect.flip(
            stock.loadOpeningStock({ ...opening, openingId: uuidv7() }),
          )

          assert.instanceOf(again, OpeningStockAlreadyLoaded)

          const valuation = yield* stock.valuation({ ...scope, legalEntityId })
          assert.strictEqual(valuation.totalValue, "140.00")

          const balance = (role: "inventory" | "migration_clearing" | "inventory_adjustment") =>
            ledger
              .roleBalance({ ...scope, legalEntityId, role, asOf: "2026-12-31" })
              .pipe(Effect.map((row) => row.balance))

          // The inventory account equals the valuation report; clearing holds the source total.
          assert.strictEqual(yield* balance("inventory"), valuation.totalValue)
          assert.strictEqual(yield* balance("migration_clearing"), "-150.00")
          assert.strictEqual(yield* balance("inventory_adjustment"), "10.00")

          return { widget, gadget }
        }).pipe(Effect.provide(erpChainLayers(client, grants)))

        const positions = yield* Effect.promise(
          () => client<{ item_id: string; adjustment: string; approved_by: string | null }[]>`
            select item_id, adjustment::text, approved_by from inventory.opening_stock_positions
            where tenant_id = ${tenantId} order by adjustment::numeric
          `,
        )

        assert.deepStrictEqual(
          positions.map((row) => [row.item_id, row.adjustment, row.approved_by]),
          [
            [loaded.widget.id, "-10.00", "finance-owner"],
            [loaded.gadget.id, "0.00", null],
          ],
        )

        // One balanced journal at the cutoff carries every valuation entry; the retries added none.
        const entries = yield* Effect.promise(
          () => client<{ journal_entry_id: string | null }[]>`
            select journal_entry_id from inventory.valuation_entries where tenant_id = ${tenantId}
          `,
        )

        assert.strictEqual(entries.length, 2)
        assert.strictEqual(new Set(entries.map((row) => row.journal_entry_id)).size, 1)
        assert.notStrictEqual(entries[0]!.journal_entry_id, null)

        const journals = yield* Effect.promise(
          () => client<{ posting_date: string; debit: string; credit: string }[]>`
            select e.posting_date::text, sum(l.debit)::text as debit, sum(l.credit)::text as credit
            from accounting.journal_entries e
            join accounting.journal_lines l on l.tenant_id = e.tenant_id and l.entry_id = e.id
            where e.tenant_id = ${tenantId} and e.source_type = 'inventory.opening_stock_load'
            group by e.id, e.posting_date
          `,
        )

        assert.deepStrictEqual(journals, [
          { posting_date: "2026-12-31", debit: "150.00", credit: "150.00" },
        ])

        // A revalued position without its approval metadata is rejected by the database.
        const unapproved = yield* Effect.tryPromise({
          try: () =>
            client.begin(async (sql) => {
              const [other] = await sql<{ id: string }[]>`
                insert into inventory.warehouses (tenant_id, legal_entity_id, name)
                values (${tenantId}, ${legalEntityId}, 'Other') returning id
              `

              await sql`
                insert into inventory.stock_balances (tenant_id, warehouse_id, item_id, on_hand)
                values (${tenantId}, ${other!.id}, ${loaded.widget.id}, 1)
              `

              const [movement] = await sql<{ id: string }[]>`
                insert into inventory.movements (tenant_id, warehouse_id, item_id, quantity, kind)
                values (${tenantId}, ${other!.id}, ${loaded.widget.id}, 1, 'receipt')
                returning id
              `

              await sql`
                insert into inventory.opening_stock_positions
                  (tenant_id, warehouse_id, item_id, movement_id, cutoff_date, quantity,
                   source_value, adjustment)
                values (${tenantId}, ${other!.id}, ${loaded.widget.id}, ${movement!.id},
                  '2026-12-31', 1, 10, 5)
              `
            }),
          // SAFETY: driver errors carry the violated constraint name.
          catch: (cause) => cause as { constraint_name?: string },
        }).pipe(Effect.flip)

        assert.strictEqual(unapproved.constraint_name, "opening_stock_positions_approval_check")
      }),
    ),
  { timeout: 120_000 },
)

it.effect.skipIf(databaseUrl === undefined)(
  "rolls the opening journal back with the load when a later write fails, then posts once",
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
          ...Object.values(InventoryCapabilities),
          ...Object.values(ProductCapabilities),
          AccountingCapabilities.chartApply,
          AccountingCapabilities.postingRuleConfigure,
          AccountingCapabilities.documentJournalPost,
          AccountingCapabilities.ledgerRead,
        ].map((capability) => ({ userAccountId: principal.userAccountId, tenantId, capability }))

        const counts = () =>
          Effect.promise(
            () => client<{ journals: string; entries: string; movements: string }[]>`
              select
                (select count(*) from accounting.journal_entries
                  where tenant_id = ${tenantId}
                    and source_type = 'inventory.opening_stock_load')::text as journals,
                (select count(*) from inventory.valuation_entries
                  where tenant_id = ${tenantId})::text as entries,
                (select count(*) from inventory.movements
                  where tenant_id = ${tenantId})::text as movements
            `,
          ).pipe(Effect.map((rows) => rows[0]!))

        yield* Effect.gen(function* () {
          const products = yield* ProductService
          const stock = yield* StockKeepingService
          const ledger = yield* GeneralLedgerService
          const scope = { principal, tenantId }

          yield* ledger.applyChartTemplate({ ...scope, legalEntityId, template: "neutral_trading" })

          const widget = yield* products.createProduct({
            ...scope,
            code: "WIDGET",
            name: "Widget",
            type: "stockable",
          })

          yield* stock.registerProductItem({ ...scope, productId: widget.id })

          const opening = {
            ...scope,
            warehouseId: warehouse!.id,
            openingId: uuidv7(),
            cutoffDate: "2026-12-31",
            lines: [
              {
                tracking: "none",
                reservedQuantity: "0",
                inTransitQuantity: "0",
                itemId: widget.id,
                quantity: "10",
                sourceValue: "100.00",
              },
            ],
          } as const

          // The journal is posted before the position is written; the failing insert comes after.
          yield* Effect.promise(
            () => client`
              create function inventory.fail_opening_position() returns trigger
              language plpgsql as $$ begin raise exception 'opening position refused'; end $$
            `,
          )

          yield* Effect.promise(
            () => client`
              create trigger fail_opening_position before insert on inventory.opening_stock_positions
              for each row execute function inventory.fail_opening_position()
            `,
          )

          const failed = yield* Effect.flip(stock.loadOpeningStock(opening))
          assert.strictEqual(failed._tag, "DatabaseFailure")

          assert.deepStrictEqual(yield* counts(), { journals: "0", entries: "0", movements: "0" })

          const rolledBack = yield* ledger.roleBalance({
            ...scope,
            legalEntityId,
            role: "inventory",
            asOf: "2026-12-31",
          })

          assert.strictEqual(rolledBack.balance, "0.00")

          yield* Effect.promise(
            () => client`drop trigger fail_opening_position on inventory.opening_stock_positions`,
          )

          // Once the fault clears, the same document loads and posts exactly one journal.
          const loaded = yield* stock.loadOpeningStock(opening)
          assert.notStrictEqual(loaded.journalEntryId, null)
          assert.deepStrictEqual(yield* stock.loadOpeningStock(opening), loaded)
          assert.deepStrictEqual(yield* counts(), { journals: "1", entries: "1", movements: "1" })

          const valuation = yield* stock.valuation({ ...scope, legalEntityId })

          const inventory = yield* ledger.roleBalance({
            ...scope,
            legalEntityId,
            role: "inventory",
            asOf: "2026-12-31",
          })

          assert.strictEqual(inventory.balance, valuation.totalValue)
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 120_000 },
)
