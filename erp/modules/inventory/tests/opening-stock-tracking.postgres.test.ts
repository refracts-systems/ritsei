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
  OpeningStockConflict,
  OpeningStockLotTrackingUnsupported,
  StockKeepingService,
  TrackedIdentityInvalid,
  TrackedIdentityRequired,
} from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const principal = { userAccountId: "opening-trk-user", sessionId: "opening-trk-session" }

// [INV-OPEN-2] [INV-TRK-1] ADR-0131 decision 6: tracked stock opens by lot or serial.
it.effect.skipIf(databaseUrl === undefined)(
  "loads tracked opening stock by lot and serial, and refuses it without identity",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const { tenantId, legalEntityId } = yield* seedErpFixture(client)

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
          const products = yield* ProductService
          const stock = yield* StockKeepingService
          const ledger = yield* GeneralLedgerService
          const scope = { principal, tenantId }

          yield* ledger.applyChartTemplate({ ...scope, legalEntityId, template: "neutral_trading" })

          const item = (code: string, tracking: "lot" | "serial") =>
            Effect.gen(function* () {
              const product = yield* products.createProduct({
                ...scope,
                code,
                name: code,
                type: "stockable",
              })

              return (yield* stock.registerProductItem({
                ...scope,
                productId: product.id,
                tracking,
              })).id
            })

          const milk = yield* item("MILK", "lot")
          const laptop = yield* item("LAPTOP", "serial")

          const base = { reservedQuantity: "0", inTransitQuantity: "0" } as const

          const opening = {
            ...scope,
            warehouseId: warehouse!.id,
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
                    { code: "L1", quantity: "6", expiry: "2027-06-30" },
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
            ],
          } as const

          const bare = { ...base, itemId: milk, quantity: "10", sourceValue: "100.00" } as const

          // A tracked line without identity is refused, whatever the source declares.
          const declared = yield* Effect.flip(
            stock.loadOpeningStock({
              ...opening,
              lines: [{ ...bare, tracking: "lot" }, opening.lines[1]],
            }),
          )

          assert.instanceOf(declared, OpeningStockLotTrackingUnsupported)

          const undeclared = yield* Effect.flip(
            stock.loadOpeningStock({
              ...opening,
              lines: [{ ...bare, tracking: "none" }],
            }),
          )

          assert.instanceOf(undeclared, TrackedIdentityRequired)

          // Lots that do not add up to the quantity are refused before anything is written.
          const short = yield* Effect.flip(
            stock.loadOpeningStock({
              ...opening,
              lines: [{ ...opening.lines[0], identity: { lots: [{ code: "L1", quantity: "5" }] } }],
            }),
          )

          assert.instanceOf(short, TrackedIdentityInvalid)

          const loaded = yield* stock.loadOpeningStock(opening)
          assert.strictEqual(loaded.valueToClear, "2100.00")

          // A retry of the same document returns the recorded load; other lots are a conflict.
          assert.deepStrictEqual(yield* stock.loadOpeningStock(opening), loaded)

          const swapped = yield* Effect.flip(
            stock.loadOpeningStock({
              ...opening,
              lines: [
                opening.lines[0],
                { ...opening.lines[1], identity: { serials: ["SN-1", "SN-9"] } },
              ],
            }),
          )

          assert.instanceOf(swapped, OpeningStockConflict)
        }).pipe(Effect.provide(erpChainLayers(client, grants)))

        const lotRows = yield* Effect.promise(
          () => client<{ code: string; on_hand: string; expiry: string | null }[]>`
            select l.code, b.on_hand::text, l.expiry_date::text as expiry
            from inventory.lot_balances b join inventory.lots l on l.id = b.lot_id
            where b.tenant_id = ${tenantId} order by l.code
          `,
        )

        assert.deepStrictEqual(lotRows, [
          { code: "L1", on_hand: "6", expiry: "2027-06-30" },
          { code: "L2", on_hand: "4", expiry: null },
        ])

        const serials = yield* Effect.promise(
          () => client<{ serial: string; status: string; received_source_type: string }[]>`
            select serial, status, received_source_type from inventory.serial_units
            where tenant_id = ${tenantId} order by serial
          `,
        )

        assert.deepStrictEqual(serials, [
          {
            serial: "SN-1",
            status: "in_stock",
            received_source_type: "inventory.opening_stock_load",
          },
          {
            serial: "SN-2",
            status: "in_stock",
            received_source_type: "inventory.opening_stock_load",
          },
        ])
      }),
    ),
)
