import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"

import { uuidv7 } from "../../../../framework/foundation/mod.ts"
import { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import { runMigrations } from "../../../../framework/platform/mod.ts"
import { seedErpFixture, seedLegalEntity } from "../../../../tests/support/erp-fixture.ts"
import { erpChainLayers } from "../../../../tests/support/erp-layers.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { AccountingCapabilities, GeneralLedgerService } from "../../accounting/mod.ts"
import { BillingCapabilities, BillingService } from "../../billing/mod.ts"
import { InventoryCapabilities } from "../../inventory/mod.ts"
import { PartyCapabilities, PartyService } from "../../party/mod.ts"
import { ProductCapabilities, ProductService } from "../../product/mod.ts"
import { ProcurementCapabilities, ProcurementService } from "../../procurement/mod.ts"
import { SalesCapabilities, SalesDocumentService, SalesService } from "../../sales/mod.ts"
import { SettlementCapabilities, SettlementService } from "../../settlement/mod.ts"
import { TaxCapabilities } from "../../tax/mod.ts"
import { DocumentsService } from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const principal = { userAccountId: "lookup-user", sessionId: "lookup-session" }
const salesOnly = { userAccountId: "lookup-sales", sessionId: "lookup-sales-session" }
const nobody = { userAccountId: "lookup-nobody", sessionId: "lookup-nobody-session" }

it.effect.skipIf(databaseUrl === undefined)(
  "finds documents of every owner by their exact number, only within the caller's tenant and reads",
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
          ...[tenantId, other.tenantId].flatMap((tenant) =>
            everything.map((capability) => ({
              userAccountId: principal.userAccountId,
              tenantId: tenant,
              capability,
            })),
          ),
          // Reads only sales documents.
          ...[SalesCapabilities.orderRead, SalesCapabilities.quotationRead].map((capability) => ({
            userAccountId: salesOnly.userAccountId,
            tenantId,
            capability,
          })),
        ]

        yield* Effect.gen(function* () {
          const ledger = yield* GeneralLedgerService
          const party = yield* PartyService
          const products = yield* ProductService
          const salesDocuments = yield* SalesDocumentService
          const sales = yield* SalesService
          const procurement = yield* ProcurementService
          const billing = yield* BillingService
          const settlement = yield* SettlementService
          const documents = yield* DocumentsService
          const scope = { principal, tenantId }

          const lookup = (number: string, as = scope) =>
            documents
              .lookup({ ...as, number })
              .pipe(
                Effect.map((found) =>
                  found.candidates.map((candidate) => [
                    candidate.type,
                    candidate.id,
                    candidate.legalEntityId,
                  ]),
                ),
              )

          yield* TestClock.setTime(Date.parse("2026-10-01T03:00:00.000Z"))
          yield* ledger.applyChartTemplate({ ...scope, legalEntityId, template: "neutral_trading" })

          const widget = yield* products.createProduct({
            ...scope,
            code: "WIDGET",
            name: "Widget",
            type: "stockable",
          })

          // One customer party with a customer role in each legal entity of the tenant.
          const buyer = yield* party.create({ ...scope, kind: "organization", name: "PT Pembeli" })
          yield* party.assignRole({ ...scope, partyId: buyer.id, role: "customer" })

          const customerIn = (entityId: string, email: string) =>
            Effect.gen(function* () {
              const relationship = yield* party.createRelationship({
                ...scope,
                partyId: buyer.id,
                legalEntityId: entityId,
                kind: "customer",
              })

              return yield* salesDocuments.createPartyCustomer({
                ...scope,
                partyRelationshipId: relationship.id,
                email,
              })
            })

          const first = yield* customerIn(legalEntityId, "first@pembeli.test")
          const another = yield* customerIn(second.legalEntityId, "second@pembeli.test")

          const confirmed = (customerId: string) =>
            Effect.gen(function* () {
              const order = yield* sales.createOrder({
                ...scope,
                customerId,
                lines: [{ itemId: widget.id, quantity: "10", unitPrice: "10.00" }],
              })

              return yield* sales.confirmOrder({
                ...scope,
                orderId: order.id,
                commandId: uuidv7(),
                correlationId: uuidv7(),
                idempotencyKey: `confirm-${order.id}`,
              })
            })

          // The same number in two legal entities: both are candidates, each with its own entity.
          const order = yield* confirmed(first.id)
          const sameNumber = yield* confirmed(another.id)

          assert.strictEqual(order.number, "SO/2026/00001")
          assert.strictEqual(sameNumber.number, "SO/2026/00001")

          assert.deepStrictEqual(
            yield* lookup("SO/2026/00001"),
            [
              ["sales.order", order.id, legalEntityId],
              ["sales.order", sameNumber.id, second.legalEntityId],
            ].toSorted((left, right) => left[2]!.localeCompare(right[2]!)),
          )

          // Exact only: a prefix, a different case, or a missing number finds nothing.
          for (const number of ["SO/2026", "so/2026/00001", "SO/2026/00099", "SO/2026/0001"]) {
            assert.deepStrictEqual(yield* lookup(number), [])
          }

          // The number is taken as given: untrimmed or blank input is refused, never widened.
          for (const number of [" SO/2026/00001", ""]) {
            const refused = yield* Effect.flip(documents.lookup({ ...scope, number }))
            assert.strictEqual(refused._tag, "SchemaError")
          }

          // A quotation, a delivery, an invoice, and a payment are found by their own numbers.
          const lineId = (yield* salesDocuments.getFulfillment({ ...scope, orderId: order.id }))
            .lines[0]!.orderLineId

          const delivery = yield* salesDocuments.recordDelivery({
            ...scope,
            orderId: order.id,
            warehouseId: warehouse!.id,
            deliveryDate: "2026-10-05",
            lines: [{ orderLineId: lineId, quantity: "4" }],
          })

          assert.deepStrictEqual(yield* lookup(delivery.number), [
            ["sales.delivery", delivery.id, legalEntityId],
          ])

          const invoice = yield* billing.invoiceSalesOrder({
            ...scope,
            orderId: order.id,
            invoiceDate: "2026-10-06",
          })

          assert.deepStrictEqual(yield* lookup(invoice.number), [
            ["billing.customer_invoice", invoice.id, legalEntityId],
          ])

          const payment = yield* settlement.receivePayment({
            ...scope,
            legalEntityId,
            partyId: buyer.id,
            paymentDate: "2026-10-07",
            amount: "10.00",
            allocations: [],
          })

          assert.deepStrictEqual(yield* lookup(payment.number), [
            ["settlement.payment", payment.id, legalEntityId],
          ])

          // A purchase order, numbered when confirmed in its supplier's legal entity.
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

          const purchase = yield* procurement.createPurchaseOrder({
            ...scope,
            supplierAccountId: supplier.id,
            lines: [{ itemId: widget.id, quantity: "5", unitPrice: "6.00" }],
          })

          const confirmedPurchase = yield* procurement.confirmPurchaseOrder({
            ...scope,
            purchaseOrderId: purchase.id,
            idempotencyKey: `confirm-${purchase.id}`,
          })

          assert.deepStrictEqual(yield* lookup(confirmedPurchase.number!), [
            ["procurement.purchase_order", purchase.id, legalEntityId],
          ])

          // A quotation, numbered when sent.
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
            customerId: first.id,
            priceListId: priceList.id,
          })

          const quotation = yield* salesDocuments.draftQuotation({
            ...scope,
            customerId: first.id,
            validUntil: "2026-12-31",
            lines: [{ productId: widget.id, quantity: "1" }],
          })

          assert.deepStrictEqual(yield* lookup("QT/2026/00001"), [])
          const sent = yield* salesDocuments.sendQuotation({ ...scope, quotationId: quotation.id })

          assert.deepStrictEqual(yield* lookup(sent.number!), [
            ["sales.quotation", quotation.id, legalEntityId],
          ])

          // Another tenant finds none of this, even with the same number and full access there.
          assert.deepStrictEqual(
            yield* lookup("SO/2026/00001", { principal, tenantId: other.tenantId }),
            [],
          )

          // A caller who reads only sales finds the order but not the purchase order or invoice.
          assert.strictEqual(
            (yield* lookup("SO/2026/00001", { principal: salesOnly, tenantId })).length,
            2,
          )

          assert.deepStrictEqual(
            yield* lookup(confirmedPurchase.number!, { principal: salesOnly, tenantId }),
            [],
          )

          assert.deepStrictEqual(
            yield* lookup(invoice.number, { principal: salesOnly, tenantId }),
            [],
          )

          // A caller who reads nothing in the tenant is told so, not shown an empty result.
          const denied = yield* Effect.flip(
            documents.lookup({ principal: nobody, tenantId, number: "SO/2026/00001" }),
          )

          assert.instanceOf(denied, AuthorizationDenied)
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 240_000 },
)
