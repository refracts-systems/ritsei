import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { uuidv7 } from "../../../../framework/foundation/mod.ts"
import { runMigrations } from "../../../../framework/platform/mod.ts"
import { AccountingCapabilities, GeneralLedgerService } from "../../accounting/mod.ts"
import { BillingCapabilities, BillingService } from "../../billing/mod.ts"
import { InventoryCapabilities, StockKeepingService } from "../../inventory/mod.ts"
import { PartyCapabilities, PartyService } from "../../party/mod.ts"
import { OrderToCashService } from "../../process/mod.ts"
import { ProductCapabilities, ProductService } from "../../product/mod.ts"
import { SalesCapabilities, SalesDocumentService, SalesService } from "../../sales/mod.ts"
import { TaxCapabilities } from "../../tax/mod.ts"
import { AllocationExceedsPayment, SettlementCapabilities, SettlementService } from "../mod.ts"
import { seedErpFixture } from "../../../../tests/support/erp-fixture.ts"
import { erpChainLayers } from "../../../../tests/support/erp-layers.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"

const databaseUrl = process.env["DATABASE_URL"]
const principal = { userAccountId: "alloc-user", sessionId: "alloc-session" }

// The rule has no RULES.md identifier (RULES.md does not cover allocation), so no [ID] tag: the
// modules test rejects an unknown one.
it.effect.skipIf(databaseUrl === undefined)(
  "refuses an allocation one cent above the unallocated amount and accepts exactly that amount",
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
          ...Object.values(AccountingCapabilities),
          ...Object.values(BillingCapabilities),
          ...Object.values(InventoryCapabilities),
          ...Object.values(PartyCapabilities),
          ...Object.values(ProductCapabilities),
          ...Object.values(SalesCapabilities),
          ...Object.values(SettlementCapabilities),
          ...Object.values(TaxCapabilities),
        ].map((capability) => ({ userAccountId: principal.userAccountId, tenantId, capability }))

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

          yield* ledger.applyChartTemplate({ ...scope, legalEntityId, template: "neutral_trading" })
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

          // A payment of 10.00 recorded on account, with nothing allocated yet.
          const payment = yield* settlement.receivePayment({
            ...scope,
            legalEntityId,
            partyId: buyer.id,
            paymentDate: "2026-10-10",
            amount: "10.00",
            allocations: [],
          })

          assert.strictEqual(payment.unallocatedAmount, "10.00")

          const overAllocation = yield* Effect.flip(
            settlement.allocatePayment({
              ...scope,
              paymentId: payment.id,
              allocatedOn: "2026-10-11",
              allocations: [{ invoiceId: invoice.id, amount: "10.01" }],
            }),
          )

          assert.instanceOf(overAllocation, AllocationExceedsPayment)
          assert.strictEqual(overAllocation.unallocated, "10.00")
          assert.strictEqual(overAllocation.requested, "10.01")

          const untouched = (yield* settlement.listPayments({ ...scope, legalEntityId })).find(
            (candidate) => candidate.id === payment.id,
          )

          assert.strictEqual(untouched?.unallocatedAmount, "10.00")
          assert.strictEqual(
            (yield* billing.getDocument({ ...scope, invoiceId: invoice.id })).openAmount,
            "100.00",
          )

          const exact = yield* settlement.allocatePayment({
            ...scope,
            paymentId: payment.id,
            allocatedOn: "2026-10-11",
            allocations: [{ invoiceId: invoice.id, amount: "10.00" }],
          })

          assert.strictEqual(exact.unallocatedAmount, "0.00")
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
)
