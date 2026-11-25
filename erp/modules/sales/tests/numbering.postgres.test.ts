import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as TestClock from "effect/testing/TestClock"

import { Database, DatabaseFailure, uuidv7 } from "../../../../framework/foundation/mod.ts"
import { AuthorizationService } from "../../../../framework/modules/authorization/mod.ts"
import { MessagingService } from "../../../../framework/modules/messaging/mod.ts"
import { runMigrations } from "../../../../framework/platform/mod.ts"
import { seedErpFixture } from "../../../../tests/support/erp-fixture.ts"
import { erpChainLayers } from "../../../../tests/support/erp-layers.ts"
import { postgresConstraint } from "../../../../tests/support/postgres-error.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { PartyCapabilities, PartyService } from "../../party/mod.ts"
import { ProductCapabilities, ProductService } from "../../product/mod.ts"
import { TaxCapabilities, TaxService } from "../../tax/mod.ts"
import { makeSalesService, SalesCapabilities, SalesDocumentService, SalesService } from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const principal = { userAccountId: "sales-number-user", sessionId: "sales-number-session" }

const postgresFailure = <A>(effect: () => Promise<A>) =>
  Effect.tryPromise({ try: effect, catch: (cause) => cause }).pipe(Effect.flip)

// [SAL-NUM-1]
it.effect.skipIf(databaseUrl === undefined)(
  "numbers a quotation when sent and an order when confirmed, gapless per legal entity and fiscal year",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const { tenantId, legalEntityId } = yield* seedErpFixture(client)

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

          const issued = (documentType: string) =>
            Effect.promise(
              () => client<{ value: string }[]>`
                select i.value::text as value
                from numbering.issued_numbers i
                join numbering.number_series s on s.id = i.series_id
                where s.document_type = ${documentType}
                order by s.period_key, i.value
              `,
            ).pipe(Effect.map((rows) => rows.map((row) => row.value)))

          const confirm = (service: typeof sales, orderId: string, key = `confirm-${orderId}`) =>
            service.confirmOrder({
              ...scope,
              orderId,
              commandId: uuidv7(),
              correlationId: uuidv7(),
              idempotencyKey: key,
            })

          yield* TestClock.setTime(Date.UTC(2026, 2, 10, 3))

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

          const draftQuotation = () =>
            documents.draftQuotation({
              ...scope,
              customerId: customer.id,
              validUntil: "2027-12-31",
              lines: [{ productId: widget.id, quantity: "1" }],
            })

          const draftOrder = () =>
            sales.createOrder({
              ...scope,
              customerId: customer.id,
              lines: [{ itemId: widget.id, quantity: "1", unitPrice: "10.00" }],
            })

          // A draft has no number, and PostgreSQL refuses to give one to a draft.
          const first = yield* draftQuotation()
          assert.strictEqual(first.number, null)

          const numberedDraft = yield* postgresFailure(
            () =>
              client`update sales.quotations set number = 'QT/2026/00001' where id = ${first.id}`,
          )

          assert.strictEqual(postgresConstraint(numberedDraft), "quotations_draft_number_check")

          const draft = yield* draftOrder()
          assert.strictEqual(draft.number, null)

          const numberedDraftOrder = yield* postgresFailure(
            () => client`update sales.orders set number = 'SO/2026/00001' where id = ${draft.id}`,
          )

          assert.strictEqual(postgresConstraint(numberedDraftOrder), "orders_draft_number_check")

          // Sending numbers a quotation once; sending or accepting again keeps the number.
          const sent = yield* documents.sendQuotation({ ...scope, quotationId: first.id })
          assert.strictEqual(sent.number, "QT/2026/00001")

          const sentAgain = yield* documents.sendQuotation({ ...scope, quotationId: first.id })
          assert.strictEqual(sentAgain.number, "QT/2026/00001")

          const accepted = yield* documents.acceptQuotation({ ...scope, quotationId: first.id })
          assert.strictEqual(accepted.number, "QT/2026/00001")
          assert.strictEqual(
            (yield* documents.getQuotation({ ...scope, quotationId: first.id })).number,
            "QT/2026/00001",
          )

          const second = yield* draftQuotation()
          const secondSent = yield* documents.sendQuotation({ ...scope, quotationId: second.id })
          assert.strictEqual(secondSent.number, "QT/2026/00002")

          // Confirming numbers an order; the same key returns the same number.
          const confirmed = yield* confirm(sales, draft.id)
          assert.strictEqual(confirmed.number, "SO/2026/00001")
          assert.strictEqual((yield* confirm(sales, draft.id)).number, "SO/2026/00001")

          const next = yield* draftOrder()
          assert.strictEqual((yield* confirm(sales, next.id)).number, "SO/2026/00002")

          // A confirmation that fails after the number is allocated rolls the number back.
          const messaging = yield* MessagingService
          const database = yield* Database
          const authorization = yield* AuthorizationService

          const failingSales = yield* Effect.provide(
            makeSalesService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(AuthorizationService, authorization),
              Layer.succeed(MessagingService, {
                ...messaging,
                append: () =>
                  Effect.fail(
                    new DatabaseFailure({ operation: "messaging.test.append", cause: null }),
                  ),
              }),
            ),
          )

          const lost = yield* draftOrder()
          yield* Effect.flip(confirm(failingSales, lost.id))

          assert.strictEqual(
            (yield* sales.getOrder({ ...scope, orderId: lost.id })).status,
            "draft",
          )
          assert.deepStrictEqual(yield* issued("sales.order"), ["1", "2"])

          const afterRollback = yield* confirm(sales, lost.id)
          assert.strictEqual(afterRollback.number, "SO/2026/00003")
          assert.deepStrictEqual(yield* issued("sales.order"), ["1", "2", "3"])

          // A confirmed order keeps its number through cancellation, and nothing else may change it.
          const renumbered = yield* postgresFailure(
            () => client`
              update sales.orders set status = 'cancelled', number = 'SO/2026/00099'
              where id = ${draft.id}
            `,
          )

          assert.strictEqual(postgresConstraint(renumbered), "sales_terminal_order_immutable")
          const cancelled = yield* sales.cancelConfirmedOrder({ ...scope, orderId: draft.id })
          assert.strictEqual(cancelled.number, "SO/2026/00001")

          // The series restarts at 1 in the next fiscal year (the calendar year without a calendar).
          yield* TestClock.setTime(Date.UTC(2027, 0, 2, 3))
          const newYear = yield* draftOrder()
          assert.strictEqual((yield* confirm(sales, newYear.id)).number, "SO/2027/00001")

          const newYearQuotation = yield* draftQuotation()

          const newYearSent = yield* documents.sendQuotation({
            ...scope,
            quotationId: newYearQuotation.id,
          })

          assert.strictEqual(newYearSent.number, "QT/2027/00001")

          // A legacy customer has no legal entity to number in: its order confirms without a number.
          const legacy = yield* sales.createCustomer({
            ...scope,
            name: "Legacy",
            email: "legacy@example.test",
          })

          const legacyOrder = yield* sales.createOrder({
            ...scope,
            customerId: legacy.id,
            lines: [{ itemId: widget.id, quantity: "1", unitPrice: "10.00" }],
          })

          const legacyConfirmed = yield* confirm(sales, legacyOrder.id)
          assert.strictEqual(legacyConfirmed.status, "confirmed")
          assert.strictEqual(legacyConfirmed.number, null)
          assert.deepStrictEqual(yield* issued("sales.order"), ["1", "2", "3", "1"])
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 180_000 },
)
