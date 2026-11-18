import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { uuidv7 } from "../../../../framework/foundation/mod.ts"
import { runMigrations } from "../../../../framework/platform/mod.ts"
import { erpChainLayers } from "../../../../tests/support/erp-layers.ts"
import { seedErpFixture } from "../../../../tests/support/erp-fixture.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
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
  "loads the opening position once, revalues it with approval, and posts no journal",
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
        ].map((capability) => ({ userAccountId: principal.userAccountId, tenantId, capability }))

        const loaded = yield* Effect.gen(function* () {
          const products = yield* ProductService
          const stock = yield* StockKeepingService
          const scope = { principal, tenantId }

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

          // A retry of the same document returns the recorded load.
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

          return { widget, gadget }
        }).pipe(Effect.provide(erpChainLayers(client, grants)))

        const positions = yield* Effect.promise(
          () => client<{ item_id: string; adjustment: string; approved_by: string | null }[]>`
            select item_id, adjustment::text, approved_by from inventory.opening_stock_positions
            where tenant_id = ${tenantId} order by adjustment
          `,
        )

        assert.deepStrictEqual(
          positions.map((row) => [row.item_id, row.adjustment, row.approved_by]),
          [
            [loaded.widget.id, "-10.00", "finance-owner"],
            [loaded.gadget.id, "0.00", null],
          ],
        )

        const [entries] = yield* Effect.promise(
          () => client<{ journals: string }[]>`
            select count(journal_entry_id)::text as journals from inventory.valuation_entries
            where tenant_id = ${tenantId}
          `,
        )

        assert.strictEqual(entries!.journals, "0")

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
