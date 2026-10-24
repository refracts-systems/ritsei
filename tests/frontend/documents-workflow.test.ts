import { AxeBuilder } from "@axe-core/playwright"
import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import {
  builtApp,
  connectToTenant,
  fulfillJson,
  mockRoutes,
  serviceUnavailableBody,
} from "./browser.ts"

const tenantId = "01900000-0000-7000-8000-000000000010"
const legalEntityId = "01900000-0000-7000-8000-000000000020"
const partyId = "01900000-0000-7000-8000-000000000021"
const orderId = "01900000-0000-7000-8000-000000000022"
const quotationId = "01900000-0000-7000-8000-000000000023"
const invoiceId = "01900000-0000-7000-8000-000000000030"
const paymentId = "01900000-0000-7000-8000-000000000033"
const deliveryId = "01900000-0000-7000-8000-000000000034"

const invoice = {
  id: invoiceId,
  tenantId,
  legalEntityId,
  kind: "customer_invoice",
  partyId,
  number: "INV-0001",
  invoiceDate: "2026-10-24",
  subtotal: "100.00",
  taxTotal: "11.00",
  total: "111.00",
  openAmount: "11.00",
  sourceType: "sales.order",
  sourceId: orderId,
  creditedInvoiceId: null,
  supplierReference: null,
  journalEntryId: "01900000-0000-7000-8000-000000000032",
  lines: [],
}

interface NodeFields {
  readonly type: string
  readonly id: string
  readonly state: string
  readonly number?: string
  readonly amount?: string
  readonly date?: string
  readonly current?: boolean
}

const node = (fields: NodeFields) => ({
  number: null,
  amount: null,
  date: null,
  current: false,
  ...fields,
})

const chain = {
  legalEntityId,
  nodes: [
    node({ type: "sales.quotation", id: quotationId, state: "accepted", amount: "111.00" }),
    node({ type: "sales.order", id: orderId, state: "confirmed", amount: "111.00" }),
    node({
      type: "sales.delivery",
      id: deliveryId,
      number: "DLV/2026/00001",
      state: "delivered",
      date: "2026-10-22",
    }),
    node({
      type: "billing.customer_invoice",
      id: invoiceId,
      number: "INV-0001",
      state: "open",
      amount: "111.00",
      date: "2026-10-24",
      current: true,
    }),
    node({
      type: "settlement.payment",
      id: paymentId,
      number: "RCV/2026/00001",
      state: "partly allocated",
      amount: "100.00",
      date: "2026-10-25",
    }),
  ],
}

it.effect(
  "shows the documents before and after an invoice and lets the user retry a failed read",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      const chainRequests: string[] = []

      yield* Effect.promise(async () => {
        await mockRoutes(page, {
          "GET /user-accounts": (route) => fulfillJson(route, 200, []),
          "GET /parties": (route) =>
            fulfillJson(route, 200, [
              {
                party: { id: partyId, tenantId, kind: "organization", name: "PT Pembeli" },
                legalEntityId: null,
              },
            ]),
          "GET /accounting/configurations": (route) =>
            fulfillJson(route, 200, [
              {
                tenantId,
                legalEntityId,
                baseCurrency: "IDR",
                precision: 2,
                fiscalYearStartMonth: 1,
                postingEnabled: true,
                financialEngine: "postgresql",
              },
            ]),
          "GET /billing/documents": (route) => fulfillJson(route, 200, [invoice]),
          [`GET /billing/documents/${invoiceId}`]: (route) => fulfillJson(route, 200, invoice),
          "GET /documents/chain": (route) => {
            const query = new URL(route.request().url()).searchParams

            chainRequests.push(`${query.get("documentType")}:${query.get("documentId")}`)

            return chainRequests.length === 1
              ? fulfillJson(route, 503, serviceUnavailableBody())
              : fulfillJson(route, 200, chain)
          },
        })

        await connectToTenant(page, url, "documents-session", tenantId, "User accounts")
        await page.getByRole("link", { name: "Billing", exact: true }).click()
        await page.getByRole("link", { name: "INV-0001", exact: true }).click()
        await page.getByRole("heading", { name: "Invoice INV-0001", exact: true }).waitFor()

        // A failed flow leaves the document readable and offers a retry.
        await page.getByRole("button", { name: "Try loading document flow again" }).click()
        const flow = page.getByRole("list", { name: "Documents in this flow" })
        await flow.waitFor()

        const items = flow.getByRole("listitem")
        assert.equal(await items.count(), 5)
        assert.deepEqual(chainRequests, [
          `billing.document:${invoiceId}`,
          `billing.document:${invoiceId}`,
        ])

        // The current document is marked in words, and the others link to their workspaces.
        const current = flow.locator('[aria-current="true"]')
        assert.include(await current.innerText(), "INV-0001")
        assert.include(await current.innerText(), "This document")
        assert.equal(
          await flow.getByRole("link", { name: "Sales order", exact: true }).getAttribute("href"),
          `/sales/orders/${orderId}`,
        )
        assert.equal(
          await flow.getByRole("link", { name: "Quotation", exact: true }).getAttribute("href"),
          `/sales/quotations/${quotationId}`,
        )
        assert.include(await items.nth(4).innerText(), "RCV/2026/00001")
        assert.equal(await flow.getByRole("link", { name: "RCV/2026/00001" }).count(), 0)

        assert.deepEqual(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
          [],
        )
      })

      assert.deepEqual(errors, [])
    }),
  { timeout: 120_000 },
)
