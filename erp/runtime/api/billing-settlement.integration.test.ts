import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import { Etag, HttpPlatform } from "effect/http"
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware"
import * as HttpApiTest from "effect/http-api/HttpApiTest"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"

import { partial } from "../../../tests/support/partial.ts"
import { BillingHttpHandlers } from "../../modules/billing/http.ts"
import {
  BillingDocumentNotFound,
  BillingService,
  type BillingDocumentType,
  type BillingServiceContract,
} from "../../modules/billing/mod.ts"
import { SettlementHttpHandlers } from "../../modules/settlement/http.ts"
import {
  SettlementService,
  type PaymentType,
  type SettlementServiceContract,
} from "../../modules/settlement/mod.ts"
import { BearerAuth, CurrentPrincipal, RitseiApi } from "./api.ts"

const tenantId = "018f3000-0000-7000-8000-000000000001"
const legalEntityId = "018f3000-0000-7000-8000-000000000002"
const partyId = "018f3000-0000-7000-8000-000000000003"
const orderId = "018f3000-0000-7000-8000-000000000004"
const invoiceId = "018f3000-0000-7000-8000-000000000005"
const journalEntryId = "018f3000-0000-7000-8000-000000000006"
const paymentId = "018f3000-0000-7000-8000-000000000007"
const principal = { userAccountId: "billing-api-user", sessionId: "billing-api-session" }

const invoice: BillingDocumentType = {
  id: invoiceId,
  tenantId,
  legalEntityId,
  kind: "customer_invoice",
  partyId,
  number: "INV-0001",
  invoiceDate: "2026-10-24",
  subtotal: "10.00",
  taxTotal: "1.10",
  total: "11.10",
  openAmount: "11.10",
  sourceType: "sales.order",
  sourceId: orderId,
  creditedInvoiceId: null,
  supplierReference: null,
  journalEntryId,
  lines: [],
}

const payment: PaymentType = {
  id: paymentId,
  tenantId,
  legalEntityId,
  direction: "incoming",
  partyId,
  number: "RCT-0001",
  paymentDate: "2026-10-24",
  amount: "11.10",
  unallocatedAmount: "0.00",
  cashAccountId: null,
  journalEntryId,
  allocations: [{ invoiceId, amount: "11.10" }],
}

const TestHttpServices = Layer.mergeAll(Path.layer, Etag.layerWeak, HttpPlatform.layer).pipe(
  Layer.provideMerge(FileSystem.layerNoop({})),
)

it.layer(TestHttpServices)("billing and settlement API contracts", (it) => {
  it.effect("forwards tenant and bearer context and maps typed failures", () =>
    Effect.gen(function* () {
      const observed: unknown[] = []

      const bearer = Layer.succeed(BearerAuth, {
        bearer: (effect) => Effect.provideService(effect, CurrentPrincipal, principal),
      })

      const bearerClient = HttpApiMiddleware.layerClient(BearerAuth, ({ request, next }) =>
        next(HttpClientRequest.bearerToken(request, "billing-token")),
      )

      const billing = partial<BillingServiceContract>()({
        listDocuments: (input: Parameters<BillingServiceContract["listDocuments"]>[0]) =>
          Effect.sync(() => {
            observed.push(input)

            return [invoice]
          }),
        getDocument: (input: Parameters<BillingServiceContract["getDocument"]>[0]) =>
          input.invoiceId === invoiceId
            ? Effect.succeed(invoice)
            : Effect.fail(new BillingDocumentNotFound({ tenantId, invoiceId: input.invoiceId })),
        listOpenItems: () =>
          Effect.succeed([
            {
              invoiceId,
              kind: "customer_invoice" as const,
              number: "INV-0001",
              partyId,
              invoiceDate: "2026-10-24",
              total: "11.10",
              openAmount: "11.10",
            },
          ]),
        invoiceSalesOrder: () => Effect.succeed(invoice),
      })

      const settlement = partial<SettlementServiceContract>()({
        receivePayment: (input: Parameters<SettlementServiceContract["receivePayment"]>[0]) =>
          Effect.sync(() => {
            observed.push(input)

            return payment
          }),
      })

      const handlers = Layer.mergeAll(BillingHttpHandlers, SettlementHttpHandlers).pipe(
        Layer.provide(bearer),
        Layer.provide(Layer.succeed(BillingService, billing)),
        Layer.provide(Layer.succeed(SettlementService, settlement)),
      )

      const client = yield* HttpApiTest.groups(RitseiApi, ["Billing", "Settlement"]).pipe(
        Effect.provide(Layer.mergeAll(handlers, bearerClient, bearer)),
      )

      const headers = { "x-tenant-id": tenantId }

      assert.deepStrictEqual(
        yield* client.Billing.listBillingDocuments({
          headers,
          query: { legalEntityId, side: "receivable" },
        }),
        [invoice],
      )
      // SAFETY: the test calls this double only with inputs of the shape it reads.
      const listed = observed.at(-1) as { tenantId: string; principal: typeof principal }
      assert.strictEqual(listed.tenantId, tenantId)
      assert.deepStrictEqual(listed.principal, principal)

      assert.deepStrictEqual(
        yield* client.Billing.getBillingDocument({ params: { id: invoiceId }, headers }),
        invoice,
      )

      const missing = yield* Effect.flip(
        client.Billing.getBillingDocument({
          params: { id: "018f3000-0000-7000-8000-0000000000ff" },
          headers,
        }),
      )

      assert.strictEqual(missing._tag, "ApiNotFound")

      assert.strictEqual(
        (yield* client.Billing.listOpenItems({
          headers,
          query: { legalEntityId, side: "receivable", asOf: "2026-10-24" },
        }))[0]?.openAmount,
        "11.10",
      )
      assert.deepStrictEqual(
        yield* client.Billing.invoiceSalesOrder({
          headers,
          payload: { orderId, invoiceDate: "2026-10-24" },
        }),
        invoice,
      )
      assert.deepStrictEqual(
        yield* client.Settlement.receivePayment({
          headers,
          payload: {
            legalEntityId,
            partyId,
            paymentDate: "2026-10-24",
            amount: "11.10",
            allocations: [{ invoiceId, amount: "11.10" }],
          },
        }),
        payment,
      )
      // SAFETY: the test calls this double only with inputs of the shape it reads.
      const received = observed.at(-1) as { tenantId: string; amount: string }
      assert.strictEqual(received.tenantId, tenantId)
      assert.strictEqual(received.amount, "11.10")
    }),
  )
})
