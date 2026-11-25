import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"

import { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import { uuidv7 } from "../../../../framework/foundation/mod.ts"
import { runMigrations } from "../../../../framework/platform/mod.ts"
import { seedErpFixture, seedLegalEntity } from "../../../../tests/support/erp-fixture.ts"
import { erpChainLayers } from "../../../../tests/support/erp-layers.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { AccountingCapabilities, GeneralLedgerService } from "../../accounting/mod.ts"
import { BillingCapabilities, BillingService } from "../../billing/mod.ts"
import { InventoryCapabilities, StockKeepingService } from "../../inventory/mod.ts"
import { PartyCapabilities, PartyService } from "../../party/mod.ts"
import { ProductCapabilities, ProductService } from "../../product/mod.ts"
import {
  ProcurementCapabilities,
  ProcurementService,
  PurchaseDocumentService,
} from "../../procurement/mod.ts"
import { SalesCapabilities, SalesDocumentService, SalesService } from "../../sales/mod.ts"
import { SettlementCapabilities, SettlementService } from "../../settlement/mod.ts"
import { TaxCapabilities, TaxService } from "../../tax/mod.ts"
import { InsightsService } from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const principal = { userAccountId: "kpi-user", sessionId: "kpi-session" }
const salesReader = { userAccountId: "kpi-sales", sessionId: "kpi-sales-session" }
const nobody = { userAccountId: "kpi-nobody", sessionId: "kpi-nobody-session" }

const at = (date: string) => TestClock.setTime(Date.parse(`${date}T03:00:00.000Z`))

it.effect.skipIf(databaseUrl === undefined)(
  "joins six figures of one legal entity for a month beside the month before it",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const { tenantId, legalEntityId } = yield* seedErpFixture(client)
        const second = yield* Effect.promise(() => seedLegalEntity(client, tenantId, "Second"))

        const [warehouse] = yield* Effect.promise(
          () => client<{ id: string }[]>`
            insert into inventory.warehouses (tenant_id, legal_entity_id, name)
            values (${tenantId}, ${legalEntityId}, 'Main') returning id
          `,
        )

        const everything = [
          ...Object.values(AccountingCapabilities),
          ...Object.values(BillingCapabilities),
          ...Object.values(InventoryCapabilities),
          ...Object.values(PartyCapabilities),
          ...Object.values(ProcurementCapabilities),
          ...Object.values(ProductCapabilities),
          ...Object.values(SalesCapabilities),
          ...Object.values(SettlementCapabilities),
          ...Object.values(TaxCapabilities),
        ]

        const grants = [
          ...everything.map((capability) => ({
            userAccountId: principal.userAccountId,
            tenantId,
            capability,
          })),
          // Reads orders only: the other owners deny this caller.
          ...[SalesCapabilities.orderRead, SalesCapabilities.quotationRead].map((capability) => ({
            userAccountId: salesReader.userAccountId,
            tenantId,
            capability,
          })),
        ]

        yield* Effect.gen(function* () {
          const ledger = yield* GeneralLedgerService
          const party = yield* PartyService
          const products = yield* ProductService
          const stock = yield* StockKeepingService
          const tax = yield* TaxService
          const salesDocuments = yield* SalesDocumentService
          const sales = yield* SalesService
          const procurement = yield* ProcurementService
          const purchasing = yield* PurchaseDocumentService
          const billing = yield* BillingService
          const settlement = yield* SettlementService
          const insights = yield* InsightsService
          const scope = { principal, tenantId }

          const kpis = (period: string, as = scope, legalEntity = legalEntityId) =>
            insights.kpis({ ...as, legalEntityId: legalEntity, period })

          yield* at("2026-09-01")
          yield* ledger.applyChartTemplate({ ...scope, legalEntityId, template: "neutral_trading" })

          // Nothing has happened yet: every figure is zero, and the previous month's too.
          const empty = yield* kpis("2026-09")
          assert.strictEqual(empty.netSales.value, "0.00")
          assert.strictEqual(empty.confirmedUndelivered.orders, 0)

          // ---- Masters.
          const widget = yield* products.createProduct({
            ...scope,
            code: "WIDGET",
            name: "Widget",
            type: "stockable",
          })

          yield* stock.registerProductItem({ ...scope, productId: widget.id })

          for (const [direction, code, rate] of [
            ["sales", "VAT11", "11"],
            ["purchase", "IN11", "11"],
          ] as const) {
            const taxCode = yield* tax.createTaxCode({
              ...scope,
              code,
              name: code,
              rate,
              direction,
            })

            yield* tax.setProductTaxDefault({
              ...scope,
              productId: widget.id,
              direction,
              taxCodeId: taxCode.id,
            })
          }

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

          yield* purchasing.setSupplierPrice({
            ...scope,
            supplierAccountId: supplier.id,
            productId: widget.id,
            unitPrice: "6.00",
          })

          // ---- September: sell 10 and deliver and invoice 4; buy 5, receive and bill all.
          yield* at("2026-09-03")

          const order = yield* sales.createOrder({
            ...scope,
            customerId: customer.id,
            lines: [{ itemId: widget.id, quantity: "10", unitPrice: "10.00" }],
          })

          yield* sales.confirmOrder({
            ...scope,
            orderId: order.id,
            commandId: uuidv7(),
            correlationId: uuidv7(),
            idempotencyKey: `confirm-${order.id}`,
          })

          const orderLineId = (yield* salesDocuments.getFulfillment({
            ...scope,
            orderId: order.id,
          })).lines[0]!.orderLineId

          const deliver = (quantity: string, deliveryDate: string) =>
            salesDocuments.recordDelivery({
              ...scope,
              orderId: order.id,
              warehouseId: warehouse!.id,
              deliveryDate,
              lines: [{ orderLineId, quantity }],
            })

          yield* deliver("4", "2026-09-05")

          const firstInvoice = yield* billing.invoiceSalesOrder({
            ...scope,
            orderId: order.id,
            invoiceDate: "2026-09-06",
          })

          const drafted = yield* purchasing.draftPurchaseOrder({
            ...scope,
            supplierAccountId: supplier.id,
            lines: [{ productId: widget.id, quantity: "7" }],
          })

          const released = yield* purchasing.releasePurchaseOrder({
            ...scope,
            purchaseOrderId: drafted.purchaseOrderId,
            idempotencyKey: `release-${drafted.purchaseOrderId}`,
          })

          const purchaseLineId = released.lines[0]!.purchaseOrderLineId

          const receive = (quantity: string, receiptDate: string) =>
            purchasing.receiveValued({
              ...scope,
              purchaseOrderId: drafted.purchaseOrderId,
              warehouseId: warehouse!.id,
              receiptDate,
              lines: [{ purchaseOrderLineId: purchaseLineId, quantity }],
            })

          yield* receive("5", "2026-09-10")

          yield* billing.billPurchaseOrder({
            ...scope,
            purchaseOrderId: drafted.purchaseOrderId,
            billDate: "2026-09-12",
            supplierReference: "SUP-001",
            lines: [{ purchaseOrderLineId: purchaseLineId, quantity: "5", unitPrice: "6.00" }],
          })

          // ---- October: deliver and invoice the other 6, settle the first invoice, take a
          // payment on account, and receive 2 more.
          yield* at("2026-10-05")
          yield* deliver("6", "2026-10-05")

          yield* billing.invoiceSalesOrder({
            ...scope,
            orderId: order.id,
            invoiceDate: "2026-10-06",
          })

          yield* billing.applySettlement({
            ...scope,
            invoiceId: firstInvoice.id,
            amount: firstInvoice.openAmount,
            source: { type: "settlement.payment", id: uuidv7() },
            settledOn: "2026-10-08",
          })

          yield* settlement.receivePayment({
            ...scope,
            legalEntityId,
            partyId: buyer.id,
            paymentDate: "2026-10-20",
            amount: "25.00",
            allocations: [],
          })

          yield* receive("2", "2026-10-10")

          // ---- The month and the one before it, side by side.
          const october = yield* kpis("2026-10")
          assert.strictEqual(october.previousPeriod, "2026-09")
          assert.strictEqual(october.from, "2026-10-01")
          assert.strictEqual(october.to, "2026-10-31")

          const flat = (kpi: { status: string; value: string | null; previous: string | null }) => [
            kpi.status,
            kpi.value,
            kpi.previous,
          ]

          // Sold before tax: 60.00 this month, 40.00 the month before.
          assert.deepStrictEqual(flat(october.netSales), ["ok", "60.00", "40.00"])

          // Open and past due on the last day: the second invoice (60.00) now, the first (40.00)
          // then. Payments on account are not netted off.
          assert.deepStrictEqual(flat(october.receivableOverdue), ["ok", "60.00", "40.00"])

          // The bill (30.00 plus 11% input tax) is past due both times.
          assert.deepStrictEqual(flat(october.payableOverdue), ["ok", "33.30", "33.30"])

          // Everything was delivered by the end of October; 6 of 10 were still to deliver in September.
          assert.deepStrictEqual(
            [
              october.confirmedUndelivered.status,
              october.confirmedUndelivered.value,
              october.confirmedUndelivered.orders,
              october.confirmedUndelivered.previous,
              october.confirmedUndelivered.previousOrders,
            ],
            ["ok", "0.00", 0, "60.00", 1],
          )

          // Stock at the purchase price: 5 x 6.00 in September, 7 x 6.00 by the end of October.
          assert.deepStrictEqual(flat(october.inventoryValue), ["ok", "42.00", "30.00"])

          // Cash: only the payment on account of October (a ledger balance, debit positive).
          assert.deepStrictEqual(flat(october.cash), ["ok", "25.00", "0.00"])

          // ---- Another legal entity of the tenant has none of it.
          const other = yield* kpis("2026-10", scope, second.legalEntityId)
          assert.strictEqual(other.netSales.value, "0.00")
          assert.strictEqual(other.receivableOverdue.value, "0.00")
          assert.strictEqual(other.confirmedUndelivered.orders, 0)

          // No posting rule for the cash or inventory role: unavailable, not zero.
          assert.strictEqual(other.cash.status, "unavailable")
          assert.strictEqual(other.cash.value, null)
          assert.strictEqual(other.inventoryValue.status, "unavailable")

          // ---- A caller who reads only orders gets that figure and is told the rest is denied.
          const partial = yield* kpis("2026-10", { principal: salesReader, tenantId })
          assert.strictEqual(partial.confirmedUndelivered.status, "ok")
          assert.strictEqual(partial.confirmedUndelivered.previousOrders, 1)

          for (const denied of [
            partial.netSales,
            partial.receivableOverdue,
            partial.payableOverdue,
            partial.cash,
            partial.inventoryValue,
          ]) {
            assert.deepStrictEqual(flat(denied), ["denied", null, null])
          }

          // ---- A caller denied by every owner is told so; so is a stranger to the tenant.
          const refused = yield* Effect.flip(kpis("2026-10", { principal: nobody, tenantId }))
          assert.instanceOf(refused, AuthorizationDenied)

          const foreign = yield* Effect.flip(
            kpis("2026-10", { principal, tenantId: "00000000-0000-4000-8000-000000000009" }),
          )

          assert.instanceOf(foreign, AuthorizationDenied)
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 240_000 },
)
