import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { uuidv7 } from "../../../../framework/foundation/mod.ts"
import { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import { runMigrations } from "../../../../framework/platform/mod.ts"
import { seedErpFixture } from "../../../../tests/support/erp-fixture.ts"
import { erpChainLayers } from "../../../../tests/support/erp-layers.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { PartyCapabilities, PartyService } from "../../party/mod.ts"
import { ProductCapabilities, ProductService } from "../../product/mod.ts"
import { TaxCapabilities, TaxService } from "../../tax/mod.ts"
import {
  CustomerPartyRoleInvalid,
  OrderLineNotFound,
  PriceListAlreadyExists,
  ProductPriceNotFound,
  QuotationInvalidState,
  SalesCapabilities,
  SalesDocumentService,
  SalesOrderInvalidState,
  SalesService,
} from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const principal = { userAccountId: "sales-docs-user", sessionId: "sales-docs-session" }
const outsider = { userAccountId: "sales-docs-outsider", sessionId: "sales-docs-outsider-session" }

// [SAL-CUST-2] [SAL-PRICE-1] [SAL-QUOT-1] [SAL-QUOT-2] [SAL-QUOT-3] [SAL-DLV-1] [SAL-AUTH-1]
it.effect.skipIf(databaseUrl === undefined)(
  "refuses invalid customer roles, prices, quotation transitions, and deliveries",
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
          ...Object.values(PartyCapabilities),
          ...Object.values(ProductCapabilities),
          ...Object.values(SalesCapabilities),
          ...Object.values(TaxCapabilities),
        ].map((capability) => ({ userAccountId: principal.userAccountId, tenantId, capability }))

        yield* Effect.gen(function* () {
          const party = yield* PartyService
          const products = yield* ProductService
          const tax = yield* TaxService
          const documents = yield* SalesDocumentService
          const sales = yield* SalesService
          const scope = { principal, tenantId }

          const buyer = yield* party.create({ ...scope, kind: "organization", name: "PT Buyer" })
          yield* party.assignRole({ ...scope, partyId: buyer.id, role: "customer" })
          yield* party.assignRole({ ...scope, partyId: buyer.id, role: "supplier" })

          const customerRelationship = yield* party.createRelationship({
            ...scope,
            partyId: buyer.id,
            legalEntityId,
            kind: "customer",
          })

          const supplierRelationship = yield* party.createRelationship({
            ...scope,
            partyId: buyer.id,
            legalEntityId,
            kind: "supplier",
          })

          // A customer comes only from a customer relationship, once per relationship.
          const wrongRole = yield* Effect.flip(
            documents.createPartyCustomer({
              ...scope,
              partyRelationshipId: supplierRelationship.id,
              email: "buyer@example.test",
            }),
          )

          assert.instanceOf(wrongRole, CustomerPartyRoleInvalid)

          const customer = yield* documents.createPartyCustomer({
            ...scope,
            partyRelationshipId: customerRelationship.id,
            email: "buyer@example.test",
          })

          const sameCustomer = yield* documents.createPartyCustomer({
            ...scope,
            partyRelationshipId: customerRelationship.id,
            email: "buyer@example.test",
          })

          assert.strictEqual(sameCustomer.id, customer.id)

          const widget = yield* products.createProduct({
            ...scope,
            code: "WIDGET",
            name: "Widget",
            type: "stockable",
          })

          const unpriced = yield* products.createProduct({
            ...scope,
            code: "UNPRICED",
            name: "Unpriced",
            type: "service",
          })

          const vat = yield* tax.createTaxCode({
            ...scope,
            code: "VAT11",
            name: "Output VAT 11%",
            rate: "11",
            direction: "sales",
          })

          for (const product of [widget, unpriced]) {
            yield* tax.setProductTaxDefault({
              ...scope,
              productId: product.id,
              direction: "sales",
              taxCodeId: vat.id,
            })
          }

          // Price list names are unique, and a quotation needs a price for every line.
          const priceList = yield* documents.createPriceList({
            ...scope,
            name: "Retail",
            currency: "IDR",
          })

          const duplicateList = yield* Effect.flip(
            documents.createPriceList({ ...scope, name: "Retail", currency: "IDR" }),
          )

          assert.instanceOf(duplicateList, PriceListAlreadyExists)
          yield* documents.setPrice({
            ...scope,
            priceListId: priceList.id,
            productId: widget.id,
            unitPrice: "10.00",
          })
          yield* documents.assignCustomerPriceList({
            ...scope,
            customerId: customer.id,
            priceListId: priceList.id,
          })

          const missingPrice = yield* Effect.flip(
            documents.draftQuotation({
              ...scope,
              customerId: customer.id,
              validUntil: "2026-12-31",
              lines: [{ productId: unpriced.id, quantity: "1" }],
            }),
          )

          assert.instanceOf(missingPrice, ProductPriceNotFound)

          // Without the capability, nothing is drafted.
          const denied = yield* Effect.flip(
            documents.draftQuotation({
              principal: outsider,
              tenantId,
              customerId: customer.id,
              validUntil: "2026-12-31",
              lines: [{ productId: widget.id, quantity: "1" }],
            }),
          )

          assert.instanceOf(denied, AuthorizationDenied)

          // Sending again is a no-op; a rejected quotation can be neither accepted nor converted.
          const rejected = yield* documents.draftQuotation({
            ...scope,
            customerId: customer.id,
            validUntil: "2026-12-31",
            lines: [{ productId: widget.id, quantity: "2" }],
          })

          yield* documents.sendQuotation({ ...scope, quotationId: rejected.id })
          const sentAgain = yield* documents.sendQuotation({ ...scope, quotationId: rejected.id })
          assert.strictEqual(sentAgain.status, "sent")

          const unacceptedConversion = yield* Effect.flip(
            documents.convertQuotation({ ...scope, quotationId: rejected.id }),
          )

          assert.instanceOf(unacceptedConversion, QuotationInvalidState)

          const decided = yield* documents.rejectQuotation({ ...scope, quotationId: rejected.id })
          assert.strictEqual(decided.status, "rejected")

          const lateAccept = yield* Effect.flip(
            documents.acceptQuotation({ ...scope, quotationId: rejected.id }),
          )

          assert.instanceOf(lateAccept, QuotationInvalidState)

          // A delivery needs a confirmed order and lines that belong to it.
          const quotation = yield* documents.draftQuotation({
            ...scope,
            customerId: customer.id,
            validUntil: "2026-12-31",
            lines: [{ productId: widget.id, quantity: "5" }],
          })

          yield* documents.sendQuotation({ ...scope, quotationId: quotation.id })
          yield* documents.acceptQuotation({ ...scope, quotationId: quotation.id })

          const { orderId } = yield* documents.convertQuotation({
            ...scope,
            quotationId: quotation.id,
          })

          const fulfillment = yield* documents.getFulfillment({ ...scope, orderId })
          const orderLineId = fulfillment.lines[0]!.orderLineId

          const draftDelivery = yield* Effect.flip(
            documents.recordDelivery({
              ...scope,
              orderId,
              warehouseId: warehouse!.id,
              deliveryDate: "2026-11-01",
              lines: [{ orderLineId, quantity: "1" }],
            }),
          )

          assert.instanceOf(draftDelivery, SalesOrderInvalidState)
          yield* sales.confirmOrder({
            ...scope,
            orderId,
            commandId: uuidv7(),
            correlationId: uuidv7(),
            idempotencyKey: `confirm-${orderId}`,
          })

          const foreignLine = yield* Effect.flip(
            documents.recordDelivery({
              ...scope,
              orderId,
              warehouseId: warehouse!.id,
              deliveryDate: "2026-11-01",
              lines: [{ orderLineId: uuidv7(), quantity: "1" }],
            }),
          )

          assert.instanceOf(foreignLine, OrderLineNotFound)

          const deliveryId = uuidv7()

          const delivered = yield* documents.recordDelivery({
            ...scope,
            deliveryId,
            orderId,
            warehouseId: warehouse!.id,
            deliveryDate: "2026-11-01",
            lines: [{ orderLineId, quantity: "2" }],
          })

          const replayed = yield* documents.recordDelivery({
            ...scope,
            deliveryId,
            orderId,
            warehouseId: warehouse!.id,
            deliveryDate: "2026-11-01",
            lines: [{ orderLineId, quantity: "2" }],
          })

          assert.strictEqual(replayed.number, delivered.number)

          const after = yield* documents.getFulfillment({ ...scope, orderId })
          assert.strictEqual(after.lines[0]!.delivered, "2")
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 180_000 },
)
