import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"

import { uuidv7 } from "../../../../framework/foundation/mod.ts"
import { ApprovalCapabilities } from "../../../../framework/modules/approvals/mod.ts"
import { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
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
import { TaxCapabilities, TaxService } from "../../tax/mod.ts"
import { DocumentsService, type PipelineType } from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const principal = { userAccountId: "pipeline-user", sessionId: "pipeline-session" }
const reader = { userAccountId: "pipeline-reader", sessionId: "pipeline-reader-session" }

/** A pipeline as rows of stage, count, and oldest date, so a test reads it at a glance. */
const rows = (pipeline: PipelineType) => ({
  receivable: pipeline.receivable.map((stage) => [stage.stage, stage.count, stage.oldestDate]),
  payable: pipeline.payable.map((stage) => [stage.stage, stage.count, stage.oldestDate]),
})

const at = (date: string) => TestClock.setTime(Date.parse(`${date}T03:00:00.000Z`))

it.effect.skipIf(databaseUrl === undefined)(
  "counts the documents at each stage with the oldest date, through partial deliveries, billing, and payment",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const { tenantId, legalEntityId } = yield* seedErpFixture(client)
        const other = yield* seedErpFixture(client)
        const second = yield* Effect.promise(() => seedLegalEntity(client, tenantId, "Second"))

        const [warehouse] = yield* Effect.promise(
          () => client<{ id: string }[]>`
            insert into inventory.warehouses (tenant_id, legal_entity_id, name)
            values (${tenantId}, ${legalEntityId}, 'Main') returning id
          `,
        )

        const everything = [
          ...Object.values(AccountingCapabilities),
          ...Object.values(ApprovalCapabilities),
          ...Object.values(BillingCapabilities),
          ...Object.values(InventoryCapabilities),
          ...Object.values(PartyCapabilities),
          ...Object.values(ProcurementCapabilities),
          ...Object.values(ProductCapabilities),
          ...Object.values(SalesCapabilities),
          ...Object.values(TaxCapabilities),
        ]

        const grants = [
          ...[tenantId, other.tenantId].flatMap((tenant) =>
            everything.map((capability) => ({
              userAccountId: principal.userAccountId,
              tenantId: tenant,
              capability,
            })),
          ),
          // A reader of orders and purchase orders who may not read billing documents.
          ...[
            SalesCapabilities.orderRead,
            SalesCapabilities.quotationRead,
            ProcurementCapabilities.purchaseOrderRead,
          ].map((capability) => ({ userAccountId: reader.userAccountId, tenantId, capability })),
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
          const documents = yield* DocumentsService
          const scope = { principal, tenantId }

          const pipeline = (legalEntity = legalEntityId) =>
            documents.pipeline({ ...scope, legalEntityId: legalEntity }).pipe(Effect.map(rows))

          const none = (stages: ReadonlyArray<string>) => stages.map((stage) => [stage, 0, null])

          yield* at("2026-10-01")
          yield* ledger.applyChartTemplate({ ...scope, legalEntityId, template: "neutral_trading" })

          // Nothing exists yet.
          assert.deepStrictEqual(yield* pipeline(), {
            receivable: none(["quotation", "order", "delivered", "invoiced", "paid"]),
            payable: none(["ordered", "received", "billed", "paid"]),
          })

          // ---- Order-to-Cash masters.
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

          const widget = yield* products.createProduct({
            ...scope,
            code: "WIDGET",
            name: "Widget",
            type: "stockable",
          })

          yield* stock.registerProductItem({ ...scope, productId: widget.id })

          const outputVat = yield* tax.createTaxCode({
            ...scope,
            code: "VAT11",
            name: "Output VAT 11%",
            rate: "11",
            direction: "sales",
          })

          const inputVat = yield* tax.createTaxCode({
            ...scope,
            code: "IN11",
            name: "Input VAT 11%",
            rate: "11",
            direction: "purchase",
          })

          for (const [direction, taxCodeId] of [
            ["sales", outputVat.id],
            ["purchase", inputVat.id],
          ] as const) {
            yield* tax.setProductTaxDefault({
              ...scope,
              productId: widget.id,
              direction,
              taxCodeId,
            })
          }

          const priceList = yield* salesDocuments.createPriceList({
            ...scope,
            name: "Retail",
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

          const quote = (quantity: string) =>
            salesDocuments.draftQuotation({
              ...scope,
              customerId: customer.id,
              validUntil: "2026-12-31",
              lines: [{ productId: widget.id, quantity }],
            })

          // ---- Quotation: sent or accepted, with no order. A draft is in no stage.
          const draft = yield* quote("1")
          assert.strictEqual((yield* pipeline()).receivable[0]![1], 0)

          yield* salesDocuments.sendQuotation({ ...scope, quotationId: draft.id })
          assert.deepStrictEqual((yield* pipeline()).receivable[0], ["quotation", 1, "2026-10-01"])

          yield* at("2026-10-02")
          const accepted = yield* quote("1")
          yield* salesDocuments.sendQuotation({ ...scope, quotationId: accepted.id })
          yield* salesDocuments.acceptQuotation({ ...scope, quotationId: accepted.id })
          assert.deepStrictEqual((yield* pipeline()).receivable[0], ["quotation", 2, "2026-10-01"])

          // Another legal entity and another tenant see none of it.
          assert.deepStrictEqual(yield* pipeline(second.legalEntityId), {
            receivable: none(["quotation", "order", "delivered", "invoiced", "paid"]),
            payable: none(["ordered", "received", "billed", "paid"]),
          })

          const foreign = yield* documents.pipeline({
            principal,
            tenantId: other.tenantId,
            legalEntityId,
          })

          assert.deepStrictEqual(
            rows(foreign).receivable,
            none(["quotation", "order", "delivered", "invoiced", "paid"]),
          )

          // ---- Order: converted and confirmed, nothing delivered. The quotation leaves its stage.
          yield* at("2026-10-03")
          const quotation = yield* quote("10")
          yield* salesDocuments.sendQuotation({ ...scope, quotationId: quotation.id })
          yield* salesDocuments.acceptQuotation({ ...scope, quotationId: quotation.id })

          const { orderId } = yield* salesDocuments.convertQuotation({
            ...scope,
            quotationId: quotation.id,
          })

          // A draft order is in no stage, and its quotation has left the quotation stage.
          const converted = (yield* pipeline()).receivable
          assert.deepStrictEqual(
            [converted[0], converted[1]],
            [
              ["quotation", 2, "2026-10-01"],
              ["order", 0, null],
            ],
          )

          yield* at("2026-10-04")
          yield* sales.confirmOrder({
            ...scope,
            orderId,
            commandId: uuidv7(),
            correlationId: uuidv7(),
            idempotencyKey: `confirm-${orderId}`,
          })

          assert.deepStrictEqual((yield* pipeline()).receivable.slice(0, 3), [
            ["quotation", 2, "2026-10-01"],
            ["order", 1, "2026-10-04"],
            ["delivered", 0, null],
          ])

          // ---- Delivered: part of the order delivered, not invoiced.
          const fulfillment = yield* salesDocuments.getFulfillment({ ...scope, orderId })
          const orderLineId = fulfillment.lines[0]!.orderLineId

          const deliver = (quantity: string, deliveryDate: string) =>
            salesDocuments.recordDelivery({
              ...scope,
              orderId,
              warehouseId: warehouse!.id,
              deliveryDate,
              lines: [{ orderLineId, quantity }],
            })

          yield* deliver("6", "2026-10-05")

          assert.deepStrictEqual((yield* pipeline()).receivable.slice(0, 3), [
            ["quotation", 2, "2026-10-01"],
            ["order", 0, null],
            ["delivered", 1, "2026-10-05"],
          ])

          // ---- Invoiced: invoicing everything delivered takes the order out of Delivered.
          const invoice = yield* billing.invoiceSalesOrder({
            ...scope,
            orderId,
            invoiceDate: "2026-10-06",
          })

          assert.deepStrictEqual((yield* pipeline()).receivable.slice(2), [
            ["delivered", 0, null],
            ["invoiced", 1, "2026-10-06"],
            ["paid", 0, null],
          ])

          // The rest delivered later is delivered, not invoiced, again.
          yield* deliver("4", "2026-10-07")
          assert.deepStrictEqual((yield* pipeline()).receivable[2], ["delivered", 1, "2026-10-05"])

          // ---- Paid: a part payment leaves the invoice open; the rest settles it.
          const part = "10.00"

          yield* billing.applySettlement({
            ...scope,
            invoiceId: invoice.id,
            amount: part,
            source: { type: "settlement.payment", id: uuidv7() },
            settledOn: "2026-10-08",
          })

          assert.deepStrictEqual((yield* pipeline()).receivable.slice(3), [
            ["invoiced", 1, "2026-10-06"],
            ["paid", 0, null],
          ])

          yield* billing.applySettlement({
            ...scope,
            invoiceId: invoice.id,
            amount: (Number(invoice.openAmount) - Number(part)).toFixed(2),
            source: { type: "settlement.payment", id: uuidv7() },
            settledOn: "2026-10-09",
          })

          assert.deepStrictEqual((yield* pipeline()).receivable.slice(3), [
            ["invoiced", 0, null],
            ["paid", 1, "2026-10-06"],
          ])

          // ---- Procure-to-Pay masters.
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

          // ---- Ordered: confirmed, nothing received. A draft is in no stage.
          yield* at("2026-10-10")

          const drafted = yield* purchasing.draftPurchaseOrder({
            ...scope,
            supplierAccountId: supplier.id,
            lines: [{ productId: widget.id, quantity: "10" }],
          })

          assert.strictEqual((yield* pipeline()).payable[0]![1], 0)

          const released = yield* purchasing.releasePurchaseOrder({
            ...scope,
            purchaseOrderId: drafted.purchaseOrderId,
            idempotencyKey: `release-${drafted.purchaseOrderId}`,
          })

          const lineId = released.lines[0]!.purchaseOrderLineId

          assert.deepStrictEqual((yield* pipeline()).payable.slice(0, 2), [
            ["ordered", 1, "2026-10-10"],
            ["received", 0, null],
          ])

          assert.deepStrictEqual(
            yield* pipeline(second.legalEntityId).pipe(Effect.map((p) => p.payable)),
            none(["ordered", "received", "billed", "paid"]),
          )

          // ---- Received: part received, not billed.
          const receive = (quantity: string, receiptDate: string) =>
            purchasing.receiveValued({
              ...scope,
              purchaseOrderId: drafted.purchaseOrderId,
              warehouseId: warehouse!.id,
              receiptDate,
              lines: [{ purchaseOrderLineId: lineId, quantity }],
            })

          yield* receive("6", "2026-10-11")

          const [received] = yield* Effect.promise(
            () => client<{ day: string }[]>`
              select min(received_at)::date::text as day from procurement.purchase_receipts
              where tenant_id = ${tenantId}
            `,
          )

          assert.deepStrictEqual((yield* pipeline()).payable.slice(0, 3), [
            ["ordered", 0, null],
            ["received", 1, received!.day],
            ["billed", 0, null],
          ])

          // ---- Billed: billing all that was received takes the order out of Received.
          const bill = yield* billing.billPurchaseOrder({
            ...scope,
            purchaseOrderId: drafted.purchaseOrderId,
            billDate: "2026-10-12",
            supplierReference: "SUP-001",
            lines: [{ purchaseOrderLineId: lineId, quantity: "6", unitPrice: "6.00" }],
          })

          assert.deepStrictEqual((yield* pipeline()).payable.slice(1), [
            ["received", 0, null],
            ["billed", 1, "2026-10-12"],
            ["paid", 0, null],
          ])

          // The rest received later is received, not billed, again; returning it undoes that.
          yield* receive("4", "2026-10-13")
          assert.strictEqual((yield* pipeline()).payable[1]![1], 1)

          yield* purchasing.returnToSupplier({
            ...scope,
            purchaseOrderId: drafted.purchaseOrderId,
            warehouseId: warehouse!.id,
            returnDate: "2026-10-14",
            lines: [{ purchaseOrderLineId: lineId, quantity: "4" }],
          })

          assert.strictEqual((yield* pipeline()).payable[1]![1], 0)

          // ---- Paid: a part payment leaves the bill open; the rest settles it.
          yield* billing.applySettlement({
            ...scope,
            invoiceId: bill.id,
            amount: "10.00",
            source: { type: "settlement.payment", id: uuidv7() },
            settledOn: "2026-10-15",
          })

          assert.deepStrictEqual((yield* pipeline()).payable.slice(2), [
            ["billed", 1, "2026-10-12"],
            ["paid", 0, null],
          ])

          yield* billing.applySettlement({
            ...scope,
            invoiceId: bill.id,
            amount: (Number(bill.openAmount) - 10).toFixed(2),
            source: { type: "settlement.payment", id: uuidv7() },
            settledOn: "2026-10-16",
          })

          assert.deepStrictEqual((yield* pipeline()).payable.slice(2), [
            ["billed", 0, null],
            ["paid", 1, "2026-10-12"],
          ])

          // ---- Authorization: reading needs the billing capability too, and the tenant's.
          const denied = yield* Effect.flip(
            documents.pipeline({ principal: reader, tenantId, legalEntityId }),
          )

          assert.instanceOf(denied, AuthorizationDenied)

          const strangerTenant = yield* Effect.flip(
            documents.pipeline({ principal: reader, tenantId: other.tenantId, legalEntityId }),
          )

          assert.instanceOf(strangerTenant, AuthorizationDenied)
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 240_000 },
)
