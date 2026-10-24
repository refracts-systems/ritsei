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
  StockKeepingService,
  StockNotStockable,
  StockUnavailable,
  StockValuationUnavailable,
} from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const principal = { userAccountId: "stock-user", sessionId: "stock-session" }

it.effect.skipIf(databaseUrl === undefined)(
  "values receipts, issues, and counts at moving average and keeps the inventory account equal",
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

        yield* Effect.gen(function* () {
          const ledger = yield* GeneralLedgerService
          const products = yield* ProductService
          const stock = yield* StockKeepingService
          const scope = { principal, tenantId }
          yield* ledger.applyChartTemplate({ ...scope, legalEntityId, template: "neutral_trading" })

          const widget = yield* products.createProduct({
            ...scope,
            code: "WIDGET",
            name: "Widget",
            type: "stockable",
          })

          const service = yield* products.createProduct({
            ...scope,
            code: "SETUP",
            name: "Setup service",
            type: "service",
          })

          const item = yield* stock.registerProductItem({ ...scope, productId: widget.id })
          assert.strictEqual(item.id, widget.id)
          assert.strictEqual(item.sku, "WIDGET")
          const again = yield* stock.registerProductItem({ ...scope, productId: widget.id })
          assert.deepStrictEqual(again, item)

          const notStockable = yield* Effect.flip(
            stock.registerProductItem({ ...scope, productId: service.id }),
          )

          assert.instanceOf(notStockable, StockNotStockable)

          const movement = {
            ...scope,
            warehouseId: warehouse!.id,
            postingDate: "2026-10-20",
          }

          const opening = {
            ...movement,
            source: { type: "inventory.opening_stock", id: uuidv7() },
            counterRole: "inventory_adjustment",
            lines: [{ itemId: widget.id, quantity: "10", unitCost: "10.00" }],
          } as const

          const received = yield* stock.receiveValued(opening)
          assert.strictEqual(received.lines[0]!.value, "100.00")
          const replayed = yield* stock.receiveValued(opening)
          assert.deepStrictEqual(replayed, received)
          yield* stock.receiveValued({
            ...movement,
            source: { type: "inventory.opening_stock", id: uuidv7() },
            counterRole: "inventory_adjustment",
            lines: [{ itemId: widget.id, quantity: "5", unitCost: "13.00" }],
          })

          // Average cost is 165.00 / 15 = 11.00; three units cost 33.00.
          const issued = yield* stock.issueValued({
            ...movement,
            source: { type: "sales.delivery", id: uuidv7() },
            counterRole: "cost_of_goods_sold",
            lines: [{ itemId: widget.id, quantity: "3" }],
          })

          assert.deepStrictEqual(
            issued.lines.map((line) => [line.quantity, line.value]),
            [["-3", "-33.00"]],
          )

          const tooMany = yield* Effect.flip(
            stock.issueValued({
              ...movement,
              source: { type: "sales.delivery", id: uuidv7() },
              counterRole: "cost_of_goods_sold",
              lines: [{ itemId: widget.id, quantity: "13" }],
            }),
          )

          assert.instanceOf(tooMany, StockUnavailable)

          // Counting 11 against 12 on hand loses one unit at the average cost of 11.00.
          const counted = yield* stock.countStock({
            ...movement,
            countId: uuidv7(),
            lines: [{ itemId: widget.id, countedQuantity: "11" }],
          })

          assert.deepStrictEqual(
            counted.lines.map((line) => [line.quantity, line.value]),
            [["-1", "-11.00"]],
          )

          const valuation = yield* stock.valuation({ ...scope, legalEntityId })
          assert.deepStrictEqual(valuation.rows, [
            { itemId: widget.id, quantity: "11", value: "121.00" },
          ])

          const inventoryAccount = yield* ledger.roleBalance({
            ...scope,
            legalEntityId,
            role: "inventory",
            asOf: "2026-12-31",
          })

          assert.strictEqual(inventoryAccount.balance, valuation.totalValue)

          const cogs = yield* ledger.roleBalance({
            ...scope,
            legalEntityId,
            role: "cost_of_goods_sold",
            asOf: "2026-12-31",
          })

          assert.strictEqual(cogs.balance, "33.00")

          // Stock received without a value (the legacy receive path) cannot be issued at cost.
          const legacy = yield* products.createProduct({
            ...scope,
            code: "LEGACY",
            name: "Legacy item",
            type: "stockable",
          })

          yield* stock.registerProductItem({ ...scope, productId: legacy.id })
          yield* Effect.promise(() =>
            client.begin(async (sql) => {
              await sql`
                insert into inventory.stock_balances (tenant_id, warehouse_id, item_id, on_hand)
                values (${tenantId}, ${warehouse!.id}, ${legacy.id}, 4)
              `
              await sql`
                insert into inventory.movements (tenant_id, warehouse_id, item_id, quantity, kind)
                values (${tenantId}, ${warehouse!.id}, ${legacy.id}, 4, 'receipt')
              `
            }),
          )

          const unvalued = yield* Effect.flip(
            stock.issueValued({
              ...movement,
              source: { type: "sales.delivery", id: uuidv7() },
              counterRole: "cost_of_goods_sold",
              lines: [{ itemId: legacy.id, quantity: "1" }],
            }),
          )

          assert.instanceOf(unvalued, StockValuationUnavailable)
        }).pipe(Effect.provide(erpChainLayers(client, grants)))

        const tampered = yield* Effect.tryPromise({
          // An explicit transaction surfaces the deferred check at COMMIT.
          try: () =>
            client.begin(
              (sql) => sql`
                update inventory.item_valuations set value = value + 1
                where tenant_id = ${tenantId}
              `,
            ),
          // SAFETY: driver errors carry the violated constraint name.
          catch: (cause) => cause as { constraint_name?: string },
        }).pipe(Effect.flip)

        assert.strictEqual(tampered.constraint_name, "inventory_valuation_entry_consistency_check")
      }),
    ),
  { timeout: 120_000 },
)
