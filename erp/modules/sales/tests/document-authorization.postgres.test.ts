import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import { runMigrations } from "../../../../framework/platform/mod.ts"
import { seedErpFixture } from "../../../../tests/support/erp-fixture.ts"
import { erpChainLayers } from "../../../../tests/support/erp-layers.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { PartyCapabilities, PartyService } from "../../party/mod.ts"
import { ProductCapabilities, ProductService } from "../../product/mod.ts"
import { TaxCapabilities, TaxService } from "../../tax/mod.ts"
import { SalesCapabilities, SalesDocumentService } from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const admin = { userAccountId: "sales-auth-admin", sessionId: "sales-auth-admin-session" }
const reader = { userAccountId: "sales-auth-reader", sessionId: "sales-auth-reader-session" }
const configurer = { userAccountId: "sales-auth-config", sessionId: "sales-auth-config-session" }

// [SAL-AUTH-1] [SAL-CREDIT-1]
it.effect.skipIf(databaseUrl === undefined)(
  "refuses privileged document operations to a caller holding only another capability",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const { tenantId, legalEntityId } = yield* seedErpFixture(client)

        const grant = (userAccountId: string, capability: string) => ({
          userAccountId,
          tenantId,
          capability,
        })

        const grants = [
          ...[
            ...Object.values(PartyCapabilities),
            ...Object.values(ProductCapabilities),
            ...Object.values(SalesCapabilities),
            ...Object.values(TaxCapabilities),
          ].map((capability) => grant(admin.userAccountId, capability)),
          grant(reader.userAccountId, SalesCapabilities.orderRead),
          grant(configurer.userAccountId, SalesCapabilities.creditLimitConfigure),
        ]

        yield* Effect.gen(function* () {
          const party = yield* PartyService
          const products = yield* ProductService
          const tax = yield* TaxService
          const documents = yield* SalesDocumentService
          const scope = { principal: admin, tenantId }

          const buyer = yield* party.create({ ...scope, kind: "organization", name: "PT Buyer" })
          yield* party.assignRole({ ...scope, partyId: buyer.id, role: "customer" })

          const relationship = yield* party.createRelationship({
            ...scope,
            partyId: buyer.id,
            legalEntityId,
            kind: "customer",
          })

          const customer = yield* documents.createPartyCustomer({
            ...scope,
            partyRelationshipId: relationship.id,
            email: "buyer@example.test",
          })

          // The credit limit gates order confirmation, so reading orders must not set it.
          const deniedLimit = yield* Effect.flip(
            documents.setCreditLimit({
              principal: reader,
              tenantId,
              customerId: customer.id,
              creditLimit: "1000000.00",
            }),
          )

          assert.instanceOf(deniedLimit, AuthorizationDenied)

          const unchanged = yield* documents.getCreditStanding({
            ...scope,
            customerId: customer.id,
          })

          assert.strictEqual(unchanged.creditLimit, null)

          const standing = yield* documents.setCreditLimit({
            principal: configurer,
            tenantId,
            customerId: customer.id,
            creditLimit: "1000000.00",
          })

          assert.strictEqual(standing.creditLimit, "1000000.00")

          // Price lists are configured only with their own capability.
          const deniedList = yield* Effect.flip(
            documents.createPriceList({
              principal: reader,
              tenantId,
              name: "Retail",
              currency: "IDR",
            }),
          )

          assert.instanceOf(deniedList, AuthorizationDenied)

          // A quotation is decided only with the decide capability; a denial leaves it sent.
          const widget = yield* products.createProduct({
            ...scope,
            code: "WIDGET",
            name: "Widget",
            type: "stockable",
          })

          const vat = yield* tax.createTaxCode({
            ...scope,
            code: "VAT11",
            name: "Output VAT 11%",
            rate: "11",
            direction: "sales",
          })

          yield* tax.setProductTaxDefault({
            ...scope,
            productId: widget.id,
            direction: "sales",
            taxCodeId: vat.id,
          })

          const priceList = yield* documents.createPriceList({
            ...scope,
            name: "Retail",
            currency: "IDR",
          })

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

          const quotation = yield* documents.draftQuotation({
            ...scope,
            customerId: customer.id,
            validUntil: "2026-12-31",
            lines: [{ productId: widget.id, quantity: "1" }],
          })

          yield* documents.sendQuotation({ ...scope, quotationId: quotation.id })

          const deniedDecision = yield* Effect.flip(
            documents.rejectQuotation({
              principal: reader,
              tenantId,
              quotationId: quotation.id,
            }),
          )

          assert.instanceOf(deniedDecision, AuthorizationDenied)

          const stillSent = yield* documents.getQuotation({ ...scope, quotationId: quotation.id })
          assert.strictEqual(stillSent.status, "sent")
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 180_000 },
)
