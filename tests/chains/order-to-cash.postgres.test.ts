import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { uuidv7 } from "../../framework/foundation/mod.ts"
import { runMigrations } from "../../framework/platform/mod.ts"
import { AccountingCapabilities, GeneralLedgerService } from "../../erp/modules/accounting/mod.ts"
import {
  BillingCapabilities,
  BillingService,
  NothingToInvoice,
} from "../../erp/modules/billing/mod.ts"
import { InventoryCapabilities, StockKeepingService } from "../../erp/modules/inventory/mod.ts"
import { PartyCapabilities, PartyService } from "../../erp/modules/party/mod.ts"
import { OrderToCashService } from "../../erp/modules/process/mod.ts"
import { ProductCapabilities, ProductService } from "../../erp/modules/product/mod.ts"
import {
  DeliveryExceedsOrder,
  QuotationInvalidState,
  SalesCapabilities,
  SalesDocumentService,
  SalesService,
} from "../../erp/modules/sales/mod.ts"
import {
  AllocationBeforePayment,
  SettlementCapabilities,
  SettlementService,
} from "../../erp/modules/settlement/mod.ts"
import { TaxCapabilities, TaxService } from "../../erp/modules/tax/mod.ts"
import { seedErpFixture } from "../support/erp-fixture.ts"
import { erpChainLayers } from "../support/erp-layers.ts"
import { withTemporaryDatabase } from "../support/postgres-database.ts"

const databaseUrl = process.env["DATABASE_URL"]
const principal = { userAccountId: "o2c-user", sessionId: "o2c-session" }

it.effect.skipIf(databaseUrl === undefined)(
  "quotes, confirms, delivers partially, invoices with tax, collects, credits, and reconciles",
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
          const tax = yield* TaxService
          const salesDocuments = yield* SalesDocumentService
          const sales = yield* SalesService
          const orderToCash = yield* OrderToCashService
          const billing = yield* BillingService
          const settlement = yield* SettlementService
          const scope = { principal, tenantId }

          // Masters: chart, customer party role, products, stock, tax, prices, payment terms.
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
            email: "Finance@Pembeli.test",
          })
          assert.strictEqual(customer.name, "PT Pembeli")
          assert.strictEqual(customer.email, "finance@pembeli.test")
          assert.strictEqual(customer.legalEntityId, legalEntityId)

          const widget = yield* products.createProduct({
            ...scope,
            code: "WIDGET",
            name: "Widget",
            type: "stockable",
          })
          const setup = yield* products.createProduct({
            ...scope,
            code: "SETUP",
            name: "Installation",
            type: "service",
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

          const vat = yield* tax.createTaxCode({
            ...scope,
            code: "VAT11",
            name: "Output VAT 11%",
            rate: "11",
            direction: "sales",
          })
          for (const product of [widget, setup]) {
            yield* tax.setProductTaxDefault({
              ...scope,
              productId: product.id,
              direction: "sales",
              taxCodeId: vat.id,
            })
          }
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
          yield* salesDocuments.setPrice({
            ...scope,
            priceListId: priceList.id,
            productId: setup.id,
            unitPrice: "50.00",
          })
          yield* salesDocuments.assignCustomerPriceList({
            ...scope,
            customerId: customer.id,
            priceListId: priceList.id,
          })
          const net30 = yield* settlement.createPaymentTerm({
            ...scope,
            code: "net30",
            name: "Net 30 days",
            netDays: 30,
          })
          yield* settlement.assignPartyTerm({
            ...scope,
            partyId: buyer.id,
            side: "receivable",
            paymentTermId: net30.id,
          })

          // Quotation lifecycle: priced from the list with a discount and default taxes.
          const quotation = yield* salesDocuments.draftQuotation({
            ...scope,
            customerId: customer.id,
            validUntil: "2026-10-31",
            lines: [
              { productId: widget.id, quantity: "10", discountPercent: "10" },
              { productId: setup.id, quantity: "1" },
            ],
          })
          assert.deepStrictEqual(
            quotation.lines.map((line) => [line.listPrice, line.unitPrice, line.taxCodeId]),
            [
              ["10.00", "9.00", vat.id],
              ["50.00", "50.00", vat.id],
            ],
          )
          assert.strictEqual(quotation.total, "140.00")
          const early = yield* Effect.flip(
            salesDocuments.acceptQuotation({ ...scope, quotationId: quotation.id }),
          )
          assert.instanceOf(early, QuotationInvalidState)
          yield* salesDocuments.sendQuotation({ ...scope, quotationId: quotation.id })
          const accepted = yield* salesDocuments.acceptQuotation({
            ...scope,
            quotationId: quotation.id,
          })
          assert.strictEqual(accepted.status, "accepted")

          const stale = yield* salesDocuments.draftQuotation({
            ...scope,
            customerId: customer.id,
            validUntil: "2026-10-02",
            lines: [{ productId: widget.id, quantity: "1" }],
          })
          yield* salesDocuments.sendQuotation({ ...scope, quotationId: stale.id })
          const expired = yield* salesDocuments.expireQuotations({ ...scope, asOf: "2026-10-03" })
          assert.deepStrictEqual(expired, [stale.id])

          const { orderId } = yield* salesDocuments.convertQuotation({
            ...scope,
            quotationId: quotation.id,
          })
          const again = yield* salesDocuments.convertQuotation({
            ...scope,
            quotationId: quotation.id,
          })
          assert.strictEqual(again.orderId, orderId)
          yield* sales.confirmOrder({
            ...scope,
            orderId,
            commandId: uuidv7(),
            correlationId: uuidv7(),
            idempotencyKey: `confirm-${orderId}`,
          })
          const order = yield* salesDocuments.getFulfillment({ ...scope, orderId })
          const widgetLine = order.lines.find((line) => line.productId === widget.id)!
          const setupLine = order.lines.find((line) => line.productId === setup.id)!

          // Partial delivery: six widgets and the installation.
          const first = yield* orderToCash.deliverOrder({
            ...scope,
            orderId,
            warehouseId: warehouse!.id,
            deliveryDate: "2026-10-05",
            lines: [
              { orderLineId: widgetLine.orderLineId, quantity: "6" },
              { orderLineId: setupLine.orderLineId, quantity: "1" },
            ],
          })
          assert.strictEqual(first.delivery.number, "DO/2026/00001")
          assert.deepStrictEqual(
            first.stock?.lines.map((line) => [line.quantity, line.value]),
            [["-6", "-36.00"]],
          )
          const firstInvoice = yield* billing.invoiceSalesOrder({
            ...scope,
            orderId,
            invoiceDate: "2026-10-06",
          })
          assert.strictEqual(firstInvoice.number, "INV/2026/00001")
          assert.deepStrictEqual(
            [firstInvoice.subtotal, firstInvoice.taxTotal, firstInvoice.total],
            ["104.00", "11.44", "115.44"],
          )
          const nothing = yield* Effect.flip(
            billing.invoiceSalesOrder({ ...scope, orderId, invoiceDate: "2026-10-06" }),
          )
          assert.instanceOf(nothing, NothingToInvoice)

          yield* orderToCash.deliverOrder({
            ...scope,
            orderId,
            warehouseId: warehouse!.id,
            deliveryDate: "2026-10-20",
            lines: [{ orderLineId: widgetLine.orderLineId, quantity: "4" }],
          })
          const overDelivery = yield* Effect.flip(
            orderToCash.deliverOrder({
              ...scope,
              orderId,
              warehouseId: warehouse!.id,
              deliveryDate: "2026-10-21",
              lines: [{ orderLineId: widgetLine.orderLineId, quantity: "1" }],
            }),
          )
          assert.instanceOf(overDelivery, DeliveryExceedsOrder)
          const secondInvoice = yield* billing.invoiceSalesOrder({
            ...scope,
            orderId,
            invoiceDate: "2026-10-21",
          })
          assert.deepStrictEqual(
            [secondInvoice.subtotal, secondInvoice.taxTotal, secondInvoice.total],
            ["36.00", "3.96", "39.96"],
          )

          // Collection, a credit note, and a payment left partly on account.
          const receipt = yield* settlement.receivePayment({
            ...scope,
            legalEntityId,
            partyId: buyer.id,
            paymentDate: "2026-10-25",
            amount: "100.00",
            allocations: [{ invoiceId: firstInvoice.id, amount: "100.00" }],
          })
          assert.strictEqual(receipt.number, "RCV/2026/00001")
          const creditNote = yield* billing.creditInvoice({
            ...scope,
            invoiceId: secondInvoice.id,
            creditDate: "2026-10-26",
            lines: [{ invoiceLineId: secondInvoice.lines[0]!.id, quantity: "1" }],
          })
          assert.strictEqual(creditNote.total, "9.99")
          assert.strictEqual(creditNote.openAmount, "0.00")
          assert.strictEqual(
            (yield* billing.getDocument({ ...scope, invoiceId: secondInvoice.id })).openAmount,
            "29.97",
          )
          const onAccount = yield* settlement.receivePayment({
            ...scope,
            legalEntityId,
            partyId: buyer.id,
            paymentDate: "2026-10-28",
            amount: "50.00",
            allocations: [{ invoiceId: firstInvoice.id, amount: "15.44" }],
          })
          assert.strictEqual(onAccount.unallocatedAmount, "34.56")
          const premature = yield* Effect.flip(
            settlement.allocatePayment({
              ...scope,
              paymentId: onAccount.id,
              allocatedOn: "2026-10-27",
              allocations: [{ invoiceId: secondInvoice.id, amount: "10.00" }],
            }),
          )
          assert.instanceOf(premature, AllocationBeforePayment)

          // Receivables aging equals the receivables control account.
          const aging = yield* settlement.aging({
            ...scope,
            legalEntityId,
            side: "receivable",
            asOf: "2026-12-31",
          })
          const receivable = yield* ledger.roleBalance({
            ...scope,
            legalEntityId,
            role: "receivable",
            asOf: "2026-12-31",
          })
          assert.strictEqual(aging.totals.total, receivable.balance)
          assert.strictEqual(receivable.balance, "-4.59")
          assert.deepStrictEqual(aging.rows, [
            {
              partyId: buyer.id,
              current: "0.00",
              days1To30: "0.00",
              days31To60: "29.97",
              days61To90: "0.00",
              over90: "0.00",
              unapplied: "-34.56",
              total: "-4.59",
            },
          ])
          // Aging as of an earlier date ignores later settlements and agrees with the ledger then.
          for (const [asOf, total] of [
            ["2026-10-24", "155.40"],
            ["2026-10-27", "45.41"],
          ] as const) {
            const past = yield* settlement.aging({
              ...scope,
              legalEntityId,
              side: "receivable",
              asOf,
            })
            const ledgerThen = yield* ledger.roleBalance({
              ...scope,
              legalEntityId,
              role: "receivable",
              asOf,
            })
            assert.strictEqual(past.totals.total, total)
            assert.strictEqual(past.totals.total, ledgerThen.balance)
          }
          const statement = yield* settlement.customerStatement({
            ...scope,
            legalEntityId,
            partyId: buyer.id,
            from: "2026-10-01",
            to: "2026-10-31",
          })
          assert.deepStrictEqual(
            statement.entries.map((entry) => [entry.kind, entry.amount, entry.balance]),
            [
              ["invoice", "115.44", "115.44"],
              ["invoice", "39.96", "155.40"],
              ["payment", "-100.00", "55.40"],
              ["credit_note", "-9.99", "45.41"],
              ["payment", "-50.00", "-4.59"],
            ],
          )

          // Stock movements equal delivered quantities, and stock value equals the inventory account.
          const valuation = yield* stock.valuation({ ...scope, legalEntityId })
          assert.deepStrictEqual(valuation.rows, [
            { itemId: widget.id, quantity: "90", value: "540.00" },
          ])
          const inventory = yield* ledger.roleBalance({
            ...scope,
            legalEntityId,
            role: "inventory",
            asOf: "2026-12-31",
          })
          assert.strictEqual(inventory.balance, valuation.totalValue)
          const trialBalance = yield* ledger.trialBalance({
            ...scope,
            legalEntityId,
            to: "2026-12-31",
          })
          assert.strictEqual(trialBalance.totalDebit, trialBalance.totalCredit)
          const balances = new Map(trialBalance.rows.map((row) => [row.code, row.balance]))
          assert.strictEqual(balances.get("4100"), "-131.00")
          assert.strictEqual(balances.get("2200"), "-14.41")
          assert.strictEqual(balances.get("5100"), "60.00")
          assert.strictEqual(balances.get("1100"), "150.00")
        }).pipe(Effect.provide(erpChainLayers(client, grants)))

        const [issued] = yield* Effect.promise(
          () => client<{ quantity: string }[]>`
            select coalesce(sum(m.quantity), 0)::text as quantity
            from inventory.movements m
            where m.tenant_id = ${tenantId} and m.kind = 'issue'
          `,
        )
        const [delivered] = yield* Effect.promise(
          () => client<{ quantity: string }[]>`
            select coalesce(sum(l.quantity), 0)::text as quantity
            from sales.delivery_lines l
            join sales.order_lines o on o.tenant_id = l.tenant_id and o.id = l.order_line_id
            join product.products p on p.tenant_id = o.tenant_id and p.id = o.item_id
            where l.tenant_id = ${tenantId} and p.type = 'stockable'
          `,
        )
        assert.strictEqual(issued!.quantity, `-${delivered!.quantity}`)
      }),
    ),
  { timeout: 180_000 },
)
