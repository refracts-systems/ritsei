import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { uuidv7 } from "../../../../framework/foundation/mod.ts"
import { runMigrations } from "../../../../framework/platform/mod.ts"
import { erpChainLayers } from "../../../../tests/support/erp-layers.ts"
import { seedErpFixture } from "../../../../tests/support/erp-fixture.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { AccountingCapabilities, GeneralLedgerService } from "../../accounting/mod.ts"
import { ProductCapabilities, ProductService } from "../../product/mod.ts"
import { InventoryCapabilities, InventoryService, StockKeepingService } from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const principal = { userAccountId: "transfer-trk-user", sessionId: "transfer-trk-session" }

// [INV-TRK-2] ADR-0137: a tracked line moves at confirm, by lot and serial, in one step.
it.effect.skipIf(databaseUrl === undefined)(
  "moves tracked lines between warehouses by lot and serial at confirm",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const { tenantId, legalEntityId } = yield* seedErpFixture(client)

        const warehouses = yield* Effect.promise(
          () => client<{ id: string }[]>`
            insert into inventory.warehouses (tenant_id, legal_entity_id, name)
            values (${tenantId}, ${legalEntityId}, 'A'), (${tenantId}, ${legalEntityId}, 'B')
            returning id
          `,
        )

        const [from, to] = [warehouses[0]!.id, warehouses[1]!.id]

        const grants = [
          ...Object.values(InventoryCapabilities),
          ...Object.values(ProductCapabilities),
          AccountingCapabilities.chartApply,
          AccountingCapabilities.postingRuleConfigure,
          AccountingCapabilities.documentJournalPost,
          AccountingCapabilities.ledgerRead,
        ].map((capability) => ({ userAccountId: principal.userAccountId, tenantId, capability }))

        yield* Effect.gen(function* () {
          const products = yield* ProductService
          const stock = yield* StockKeepingService
          const inventory = yield* InventoryService
          const ledger = yield* GeneralLedgerService
          const scope = { principal, tenantId }

          yield* ledger.applyChartTemplate({ ...scope, legalEntityId, template: "neutral_trading" })

          const item = (code: string, tracking: "none" | "lot" | "serial" = "none") =>
            Effect.gen(function* () {
              const product = yield* products.createProduct({
                ...scope,
                code,
                name: code,
                type: "stockable",
              })

              const registered = yield* stock.registerProductItem({
                ...scope,
                productId: product.id,
                tracking,
              })

              return registered.id
            })

          const milk = yield* item("MILK", "lot")
          const laptop = yield* item("LAPTOP", "serial")
          const plain = yield* item("PLAIN")

          const base = { reservedQuantity: "0", inTransitQuantity: "0" } as const

          yield* stock.loadOpeningStock({
            ...scope,
            warehouseId: from,
            openingId: uuidv7(),
            cutoffDate: "2026-12-31",
            lines: [
              {
                ...base,
                itemId: milk,
                quantity: "10",
                sourceValue: "100.00",
                tracking: "lot",
                identity: {
                  lots: [
                    { code: "L1", quantity: "6" },
                    { code: "L2", quantity: "4" },
                  ],
                },
              },
              {
                ...base,
                itemId: laptop,
                quantity: "2",
                sourceValue: "2000.00",
                tracking: "none",
                identity: { serials: ["SN-1", "SN-2"] },
              },
              { ...base, itemId: plain, quantity: "5", sourceValue: "50.00", tracking: "none" },
            ],
          })

          const transfer = (lines: Parameters<typeof inventory.createTransfer>[0]["lines"]) =>
            inventory.createTransfer({
              ...scope,
              sourceWarehouseId: from,
              destinationWarehouseId: to,
              lines,
            })

          // A tracked line without identity, or with the wrong shape, is refused when created.
          assert.strictEqual(
            (yield* Effect.flip(transfer([{ itemId: milk, quantity: "3" }])))._tag,
            "TrackedIdentityRequired",
          )

          assert.strictEqual(
            (yield* Effect.flip(
              transfer([
                {
                  itemId: milk,
                  quantity: "3",
                  identity: { lots: [{ code: "L1", quantity: "2" }] },
                },
              ]),
            ))._tag,
            "TrackedIdentityInvalid",
          )

          assert.strictEqual(
            (yield* Effect.flip(
              transfer([{ itemId: plain, quantity: "1", identity: { serials: ["X"] } }]),
            ))._tag,
            "TrackedIdentityInvalid",
          )

          // A lot short at the source is refused at confirm, with nothing moved.
          const short = yield* transfer([
            { itemId: milk, quantity: "5", identity: { lots: [{ code: "L2", quantity: "5" }] } },
          ])

          assert.strictEqual(
            (yield* Effect.flip(inventory.confirmTransfer({ ...scope, transferId: short.id })))
              ._tag,
            "TrackedIdentityUnavailable",
          )

          const created = yield* transfer([
            {
              itemId: milk,
              quantity: "5",
              identity: {
                lots: [
                  { code: "L1", quantity: "4" },
                  { code: "L2", quantity: "1" },
                ],
              },
            },
            { itemId: laptop, quantity: "1", identity: { serials: ["SN-2"] } },
            { itemId: plain, quantity: "2" },
          ])

          const confirmed = yield* inventory.confirmTransfer({ ...scope, transferId: created.id })
          assert.strictEqual(confirmed.status, "confirmed")

          const lotsAfterConfirm = yield* Effect.promise(
            () => client<{ w: string; code: string; on_hand: string }[]>`
              select b.warehouse_id as w, l.code, b.on_hand::text
              from inventory.lot_balances b join inventory.lots l on l.id = b.lot_id
              where b.tenant_id = ${tenantId} order by l.code, b.warehouse_id = ${from} desc
            `,
          )

          assert.deepStrictEqual(
            lotsAfterConfirm.map(
              (row) => `${row.code}:${row.w === from ? "A" : "B"}:${row.on_hand}`,
            ),
            ["L1:A:2", "L1:B:4", "L2:A:3", "L2:B:1"],
          )

          // The balance of each warehouse equals the sum of its lots; an untracked line waits.
          const balances = yield* Effect.promise(
            () => client<{ item: string; w: string; on_hand: string }[]>`
              select item_id as item, warehouse_id as w, on_hand::text from inventory.stock_balances
              where tenant_id = ${tenantId}
            `,
          )

          const onHand = (item: string, warehouse: string) =>
            balances.find((row) => row.item === item && row.w === warehouse)?.on_hand

          assert.strictEqual(onHand(milk, from), "5")
          assert.strictEqual(onHand(milk, to), "5")
          assert.strictEqual(onHand(plain, to), undefined)

          const completed = yield* inventory.completeTransfer({ ...scope, transferId: created.id })
          assert.strictEqual(completed.status, "completed")

          const final = yield* Effect.promise(
            () => client<{ item: string; w: string; on_hand: string }[]>`
              select item_id as item, warehouse_id as w, on_hand::text from inventory.stock_balances
              where tenant_id = ${tenantId} and item_id = ${plain}
            `,
          )

          assert.deepStrictEqual(
            final.map((row) => `${row.w === from ? "A" : "B"}:${row.on_hand}`).toSorted(),
            ["A:3", "B:2"],
          )

          const serials = yield* Effect.promise(
            () => client<{ serial: string; status: string; w: string }[]>`
              select serial, status, warehouse_id as w from inventory.serial_units
              where tenant_id = ${tenantId} order by serial
            `,
          )

          assert.deepStrictEqual(
            serials.map((row) => `${row.serial}:${row.status}:${row.w === from ? "A" : "B"}`),
            ["SN-1:in_stock:A", "SN-2:in_stock:B"],
          )

          // A serial no longer in the source cannot move again from there.
          const again = yield* transfer([
            { itemId: laptop, quantity: "1", identity: { serials: ["SN-2"] } },
          ])

          assert.strictEqual(
            (yield* Effect.flip(inventory.confirmTransfer({ ...scope, transferId: again.id })))
              ._tag,
            "TrackedIdentityUnavailable",
          )
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
)
