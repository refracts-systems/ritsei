import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"

import { uuidv7 } from "../../framework/foundation/mod.ts"
import { runMigrations } from "../../framework/platform/mod.ts"
import { AccountingCapabilities, GeneralLedgerService } from "../../erp/modules/accounting/mod.ts"
import { DocumentsService } from "../../erp/modules/documents/mod.ts"
import { InventoryCapabilities, StockKeepingService } from "../../erp/modules/inventory/mod.ts"
import { PartyCapabilities, PartyService } from "../../erp/modules/party/mod.ts"
import { OrderToCashService } from "../../erp/modules/process/mod.ts"
import { ProductCapabilities, ProductService } from "../../erp/modules/product/mod.ts"
import {
  ProcurementCapabilities,
  ProcurementService,
  PurchaseDocumentService,
} from "../../erp/modules/procurement/mod.ts"
import {
  SalesCapabilities,
  SalesDocumentService,
  SalesService,
} from "../../erp/modules/sales/mod.ts"
import { TaxCapabilities } from "../../erp/modules/tax/mod.ts"
import { seedErpFixture } from "../support/erp-fixture.ts"
import { erpChainLayers } from "../support/erp-layers.ts"
import { postgresConstraint } from "../support/postgres-error.ts"
import { withTemporaryDatabase } from "../support/postgres-database.ts"

const databaseUrl = process.env["DATABASE_URL"]
const admin = { userAccountId: "trk-admin", sessionId: "trk-admin-session" }
const stockOnly = { userAccountId: "trk-stock", sessionId: "trk-stock-session" }

// [INV-TRK-1] ADR-0131: tracked items move only with their lot or serial.
it.effect.skipIf(databaseUrl === undefined)(
  "receives and delivers tracked items by lot and serial and traces a serial to its customer",
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
          ...[
            ...Object.values(AccountingCapabilities),
            ...Object.values(InventoryCapabilities),
            ...Object.values(PartyCapabilities),
            ...Object.values(ProcurementCapabilities),
            ...Object.values(ProductCapabilities),
            ...Object.values(SalesCapabilities),
            ...Object.values(TaxCapabilities),
          ].map((capability) => ({ userAccountId: admin.userAccountId, tenantId, capability })),
          // May read serials but not sales documents.
          {
            userAccountId: stockOnly.userAccountId,
            tenantId,
            capability: InventoryCapabilities.stockRead,
          },
        ]

        yield* Effect.gen(function* () {
          const ledger = yield* GeneralLedgerService
          const party = yield* PartyService
          const products = yield* ProductService
          const stock = yield* StockKeepingService
          const procurement = yield* ProcurementService
          const purchasing = yield* PurchaseDocumentService
          const salesDocuments = yield* SalesDocumentService
          const sales = yield* SalesService
          const orderToCash = yield* OrderToCashService
          const documents = yield* DocumentsService
          const scope = { principal: admin, tenantId }

          yield* TestClock.setTime(Date.parse("2026-10-01T03:00:00.000Z"))
          yield* ledger.applyChartTemplate({ ...scope, legalEntityId, template: "neutral_trading" })

          const product = (code: string) =>
            products.createProduct({ ...scope, code, name: code, type: "stockable" })

          const laptop = yield* product("LAPTOP")
          const milk = yield* product("MILK")
          const plain = yield* product("PLAIN")

          yield* stock.registerProductItem({ ...scope, productId: laptop.id, tracking: "serial" })
          yield* stock.registerProductItem({ ...scope, productId: milk.id, tracking: "lot" })
          yield* stock.registerProductItem({ ...scope, productId: plain.id })

          // ---- A supplier and one order per item.
          const vendor = yield* party.create({ ...scope, kind: "organization", name: "PT Pemasok" })
          yield* party.assignRole({ ...scope, partyId: vendor.id, role: "supplier" })

          const supplierRelationship = yield* party.createRelationship({
            ...scope,
            partyId: vendor.id,
            legalEntityId,
            kind: "supplier",
          })

          const supplier = yield* procurement.createSupplierAccount({
            ...scope,
            supplierRelationshipId: supplierRelationship.id,
          })

          const order = (productId: string, quantity: string) =>
            Effect.gen(function* () {
              yield* purchasing.setSupplierPrice({
                ...scope,
                supplierAccountId: supplier.id,
                productId,
                unitPrice: "10.00",
              })

              const drafted = yield* purchasing.draftPurchaseOrder({
                ...scope,
                supplierAccountId: supplier.id,
                lines: [{ productId, quantity }],
              })

              const released = yield* purchasing.releasePurchaseOrder({
                ...scope,
                purchaseOrderId: drafted.purchaseOrderId,
                idempotencyKey: `release-${drafted.purchaseOrderId}`,
              })

              return {
                purchaseOrderId: drafted.purchaseOrderId,
                lineId: released.lines[0]!.purchaseOrderLineId,
              }
            })

          const receive = (
            purchase: { purchaseOrderId: string; lineId: string },
            quantity: string,
            identity?: Parameters<typeof purchasing.receiveValued>[0]["lines"][number]["identity"],
          ) =>
            purchasing.receiveValued({
              ...scope,
              purchaseOrderId: purchase.purchaseOrderId,
              warehouseId: warehouse!.id,
              receiptDate: "2026-10-02",
              lines: [
                identity === undefined
                  ? { purchaseOrderLineId: purchase.lineId, quantity }
                  : { purchaseOrderLineId: purchase.lineId, quantity, identity },
              ],
            })

          const tagOf = <A, E>(effect: Effect.Effect<A, E>) =>
            // SAFETY: every failure here is a tagged error, and only its tag is read.
            Effect.flip(effect).pipe(Effect.map((error) => (error as { _tag: string })._tag))

          // ---- Lots: an item that is tracked by lot needs them, adding up to the quantity.
          const milkOrder = yield* order(milk.id, "10")
          assert.strictEqual(yield* tagOf(receive(milkOrder, "5")), "TrackedIdentityRequired")

          assert.strictEqual(
            yield* tagOf(receive(milkOrder, "5", { lots: [{ code: "L1", quantity: "4" }] })),
            "TrackedIdentityInvalid",
          )

          assert.strictEqual(
            yield* tagOf(receive(milkOrder, "1", { serials: ["S1"] })),
            "TrackedIdentityInvalid",
          )

          yield* receive(milkOrder, "5", {
            lots: [
              { code: "L1", quantity: "3", expiry: "2027-01-31" },
              { code: "L2", quantity: "2" },
            ],
          })

          const lotRows = () =>
            Effect.promise(
              () => client<{ code: string; on_hand: string; expiry: string | null }[]>`
                select l.code, b.on_hand::text, l.expiry_date::text as expiry
                from inventory.lot_balances b join inventory.lots l on l.id = b.lot_id
                where b.tenant_id = ${tenantId} order by l.code
              `,
            )

          assert.deepStrictEqual(await_(yield* lotRows()), [
            ["L1", "3", "2027-01-31"],
            ["L2", "2", null],
          ])

          // ---- Serials: exactly as many distinct serials as units, none already in stock.
          const laptopOrder = yield* order(laptop.id, "4")
          assert.strictEqual(yield* tagOf(receive(laptopOrder, "2")), "TrackedIdentityRequired")

          assert.strictEqual(
            yield* tagOf(receive(laptopOrder, "2", { serials: ["SN-1"] })),
            "TrackedIdentityInvalid",
          )

          assert.strictEqual(
            yield* tagOf(receive(laptopOrder, "2", { serials: ["SN-1", "SN-1"] })),
            "TrackedIdentityInvalid",
          )

          yield* receive(laptopOrder, "3", { serials: ["SN-1", "SN-2", "SN-3"] })

          // The same unit cannot be received again while it is in stock.
          assert.strictEqual(
            yield* tagOf(receive(laptopOrder, "1", { serials: ["SN-2"] })),
            "TrackedIdentityUnavailable",
          )

          // An untracked item takes no identity.
          const plainOrder = yield* order(plain.id, "3")
          assert.strictEqual(
            yield* tagOf(receive(plainOrder, "1", { serials: ["X"] })),
            "TrackedIdentityInvalid",
          )

          yield* receive(plainOrder, "3")

          // ---- A return names what goes back; a serial that left cannot go back twice.
          const sendBack = (serials: ReadonlyArray<string>) =>
            purchasing.returnToSupplier({
              ...scope,
              purchaseOrderId: laptopOrder.purchaseOrderId,
              warehouseId: warehouse!.id,
              returnDate: "2026-10-03",
              lines: [
                {
                  purchaseOrderLineId: laptopOrder.lineId,
                  quantity: String(serials.length),
                  identity: { serials: [...serials] },
                },
              ],
            })

          yield* sendBack(["SN-3"])
          assert.strictEqual(yield* tagOf(sendBack(["SN-3"])), "TrackedIdentityUnavailable")

          const returned = yield* stock.lookupSerial({ ...scope, serial: "SN-3" })
          assert.strictEqual(returned[0]!.status, "returned_to_supplier")
          assert.strictEqual(returned[0]!.issuedBy?.type, "procurement.return")

          // ---- A delivery names the serials and lots it ships; nothing ships twice.
          const buyer = yield* party.create({ ...scope, kind: "organization", name: "PT Pembeli" })
          yield* party.assignRole({ ...scope, partyId: buyer.id, role: "customer" })

          const customerRelationship = yield* party.createRelationship({
            ...scope,
            partyId: buyer.id,
            legalEntityId,
            kind: "customer",
          })

          const customer = yield* salesDocuments.createPartyCustomer({
            ...scope,
            partyRelationshipId: customerRelationship.id,
            email: "finance@pembeli.test",
          })

          const salesOrder = yield* sales.createOrder({
            ...scope,
            customerId: customer.id,
            lines: [
              { itemId: laptop.id, quantity: "2", unitPrice: "50.00" },
              { itemId: milk.id, quantity: "4", unitPrice: "5.00" },
            ],
          })

          yield* sales.confirmOrder({
            ...scope,
            orderId: salesOrder.id,
            commandId: uuidv7(),
            correlationId: uuidv7(),
            idempotencyKey: `confirm-${salesOrder.id}`,
          })

          const fulfillment = yield* salesDocuments.getFulfillment({
            ...scope,
            orderId: salesOrder.id,
          })

          const lineOf = (productId: string) =>
            fulfillment.lines.find((line) => line.productId === productId)!.orderLineId

          const deliver = (
            laptopIdentity: { serials: string[] },
            milkIdentity: { lots: { code: string; quantity: string }[] },
          ) =>
            orderToCash.deliverOrder({
              ...scope,
              orderId: salesOrder.id,
              warehouseId: warehouse!.id,
              deliveryDate: "2026-10-05",
              lines: [
                { orderLineId: lineOf(laptop.id), quantity: "2", identity: laptopIdentity },
                { orderLineId: lineOf(milk.id), quantity: "4", identity: milkIdentity },
              ],
            })

          // SN-3 was returned and L2 holds only 2: neither can be shipped.
          assert.strictEqual(
            yield* tagOf(
              deliver({ serials: ["SN-1", "SN-3"] }, { lots: [{ code: "L1", quantity: "4" }] }),
            ),
            "TrackedIdentityUnavailable",
          )

          assert.strictEqual(
            yield* tagOf(
              deliver({ serials: ["SN-1", "SN-2"] }, { lots: [{ code: "L1", quantity: "4" }] }),
            ),
            "TrackedIdentityUnavailable",
          )

          // The failed attempts changed nothing.
          assert.deepStrictEqual(await_(yield* lotRows()), [
            ["L1", "3", "2027-01-31"],
            ["L2", "2", null],
          ])

          const delivered = yield* deliver(
            { serials: ["SN-1", "SN-2"] },
            {
              lots: [
                { code: "L1", quantity: "3" },
                { code: "L2", quantity: "1" },
              ],
            },
          )

          assert.isNotNull(delivered.stock)

          assert.deepStrictEqual(await_(yield* lotRows()), [
            ["L1", "0", "2027-01-31"],
            ["L2", "1", null],
          ])

          // ---- Trace a serial to its customer and delivery.
          const trace = yield* documents.serialLookup({ ...scope, serial: "SN-1" })
          assert.strictEqual(trace.length, 1)
          assert.strictEqual(trace[0]!.itemId, laptop.id)
          assert.strictEqual(trace[0]!.status, "issued")
          assert.strictEqual(trace[0]!.delivery, "shown")
          assert.strictEqual(trace[0]!.customerName, customer.name)
          assert.strictEqual(trace[0]!.deliveryNumber, delivered.delivery.number)
          assert.strictEqual(trace[0]!.deliveryDate, "2026-10-05")

          // A caller who reads stock but not sales sees the unit and not its customer.
          const limited = yield* documents.serialLookup({
            principal: stockOnly,
            tenantId,
            serial: "SN-1",
          })

          assert.strictEqual(limited[0]!.delivery, "denied")
          assert.isNull(limited[0]!.customerName)

          // A near miss finds nothing.
          assert.deepStrictEqual(yield* documents.serialLookup({ ...scope, serial: "sn-1" }), [])

          // ---- The tracking mode is locked by stock and history, and free for a new item.
          assert.strictEqual(
            yield* tagOf(stock.setItemTracking({ ...scope, itemId: plain.id, tracking: "lot" })),
            "ItemTrackingLocked",
          )

          const fresh = yield* product("FRESH")
          yield* stock.registerProductItem({ ...scope, productId: fresh.id })

          assert.strictEqual(
            (yield* stock.setItemTracking({ ...scope, itemId: fresh.id, tracking: "serial" }))
              .tracking,
            "serial",
          )

          // ---- The database refuses a movement of a tracked item that skips the identity.
          const bypass = yield* Effect.tryPromise({
            try: () => client`
              insert into inventory.movements (tenant_id, warehouse_id, item_id, quantity, kind)
              values (${tenantId}, ${warehouse!.id}, ${laptop.id}, 1, 'receipt')
            `,
            catch: (cause) => cause,
          }).pipe(Effect.flip)

          assert.strictEqual(postgresConstraint(bypass), "tracked_item_requires_identity")
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 300_000 },
)

/** The lot rows as code, balance, and expiry, so a test reads them at a glance. */
const await_ = (rows: ReadonlyArray<{ code: string; on_hand: string; expiry: string | null }>) =>
  rows.map((row) => [row.code, row.on_hand, row.expiry])
