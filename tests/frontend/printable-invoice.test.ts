import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { builtApp, connectToTenant, fulfillJson, mockRoutes } from "./browser.ts"

const tenantId = "01900000-0000-7000-8000-000000000010"
const legalEntityId = "01900000-0000-7000-8000-000000000020"
const buyerId = "01900000-0000-7000-8000-000000000021"
const sellerId = "01900000-0000-7000-8000-000000000023"
const invoiceId = "01900000-0000-7000-8000-000000000030"

const invoice = {
  id: invoiceId,
  tenantId,
  legalEntityId,
  kind: "customer_invoice",
  partyId: buyerId,
  number: "INV-0001",
  invoiceDate: "2026-10-24",
  subtotal: "100.00",
  taxTotal: "11.00",
  total: "111.00",
  openAmount: "111.00",
  sourceType: null,
  sourceId: null,
  creditedInvoiceId: null,
  supplierReference: null,
  journalEntryId: "01900000-0000-7000-8000-000000000032",
  lines: [
    {
      id: "01900000-0000-7000-8000-000000000031",
      productId: null,
      description: "Widget",
      quantity: "2",
      unitPrice: "50.00",
      netAmount: "100.00",
      taxCodeId: null,
      taxAmount: "11.00",
    },
  ],
}

it.effect(
  "prints the document on its own, with who issued it and who it is for",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp

      yield* Effect.promise(async () => {
        await mockRoutes(page, {
          "GET /user-accounts": (route) => fulfillJson(route, 200, []),
          "GET /parties": (route) =>
            fulfillJson(route, 200, [
              {
                party: { id: buyerId, tenantId, kind: "organization", name: "PT Pembeli" },
                legalEntityId: null,
              },
              {
                party: { id: sellerId, tenantId, kind: "organization", name: "PT Demo Trading" },
                legalEntityId,
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
          "GET /documents/chain": (route) => fulfillJson(route, 200, { legalEntityId, nodes: [] }),
        })

        await connectToTenant(page, url, "print-session", tenantId, "User accounts")
        await page.getByRole("link", { name: "Billing", exact: true }).click()
        await page.getByRole("link", { name: "INV-0001", exact: true }).click()
        await page.getByRole("button", { name: "Print or save as PDF" }).waitFor()

        // On screen the sheet stays out of the way.
        const sheet = page.locator("[data-print-sheet]")
        assert.isFalse(await sheet.isVisible())

        // In print it is the only thing shown.
        await page.emulateMedia({ media: "print" })
        assert.isTrue(await sheet.isVisible())
        assert.isFalse(await page.getByRole("link", { name: "Billing", exact: true }).isVisible())

        const text = await sheet.innerText()
        assert.include(text, "Invoice INV-0001")
        assert.include(text, "PT Demo Trading")
        assert.include(text, "PT Pembeli")
        assert.include(text, "111.00")

        const pdf = await page.pdf()
        assert.strictEqual(pdf.subarray(0, 4).toString(), "%PDF")
        assert.isAbove(pdf.length, 1_000)
      })

      assert.deepEqual(errors, [])
    }),
  { timeout: 120_000 },
)
