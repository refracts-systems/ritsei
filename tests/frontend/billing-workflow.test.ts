import { AxeBuilder } from "@axe-core/playwright"
import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { Page, Route } from "playwright"
import { builtApp, connectToTenant, forbiddenBody } from "./browser.ts"

const tenantId = "01900000-0000-7000-8000-000000000010"
const legalEntityId = "01900000-0000-7000-8000-000000000020"
const partyId = "01900000-0000-7000-8000-000000000021"
const orderId = "01900000-0000-7000-8000-000000000022"
const invoiceId = "01900000-0000-7000-8000-000000000030"
const lineId = "01900000-0000-7000-8000-000000000031"
const journalEntryId = "01900000-0000-7000-8000-000000000032"

const configuration = {
  tenantId,
  legalEntityId,
  baseCurrency: "IDR",
  precision: 2,
  fiscalYearStartMonth: 1,
  postingEnabled: true,
  financialEngine: "postgresql",
}

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
  openAmount: "111.00",
  sourceType: "sales.order",
  sourceId: orderId,
  creditedInvoiceId: null,
  supplierReference: null,
  journalEntryId,
  lines: [
    {
      id: lineId,
      productId: null,
      description: "Widget",
      quantity: "2",
      unitPrice: "50.00",
      netAmount: "100.00",
      taxCodeId: null,
      taxAmount: "11.00",
      sourceLineId: null,
      matchedValue: "0.00",
    },
  ],
}

const fulfillJson = <Body>(route: Route, status: number, body: Body) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })

const openBilling = async (page: Page, url: string) => {
  await connectToTenant(page, url, "billing-session", tenantId, "User accounts")
  await page.getByRole("link", { name: "Billing", exact: true }).click()
  await page.getByRole("heading", { name: "Billing", exact: true }).waitFor({ timeout: 5_000 })
}

it.effect(
  "lists billing documents and opens one by URL",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      const configurations: unknown[] = [configuration]
      const documentsStatus = 200
      const requests: Array<{ path: string; search: string }> = []

      yield* Effect.promise(async () => {
        await page.route("**/api/**", (route) => {
          const requestUrl = new URL(route.request().url())
          const path = requestUrl.pathname.replace(/^\/api/, "")
          requests.push({ path, search: requestUrl.search })

          if (path === "/user-accounts") return fulfillJson(route, 200, [])

          if (path === "/accounting/configurations") return fulfillJson(route, 200, configurations)

          if (path === "/billing/documents") {
            if (documentsStatus === 403) return fulfillJson(route, 403, forbiddenBody())

            return fulfillJson(
              route,
              200,
              requestUrl.searchParams.get("side") === "payable" ? [] : [invoice],
            )
          }

          if (path === `/billing/documents/${invoiceId}`) return fulfillJson(route, 200, invoice)

          return fulfillJson(route, 404, { code: "unexpected_test_request" })
        })

        await openBilling(page, url)

        await page.getByRole("link", { name: "INV-0001", exact: true }).waitFor()
        assert.isTrue(
          requests.some(
            (request) =>
              request.path === "/billing/documents" &&
              request.search.includes(`legalEntityId=${legalEntityId}`) &&
              request.search.includes("side=receivable"),
          ),
        )
        await page.getByText("Open", { exact: true }).first().waitFor()
        assert.deepEqual(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
          [],
        )

        await page.getByRole("link", { name: "INV-0001", exact: true }).click()
        await page.getByRole("heading", { name: "Invoice INV-0001", exact: true }).waitFor()
        assert.equal(new URL(page.url()).pathname, `/billing/${invoiceId}`)
        await page.getByRole("cell", { name: "111.00" }).first().waitFor()
        await page.getByRole("rowheader", { name: "Widget", exact: true }).waitFor()
        assert.deepEqual(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
          [],
        )

        await page
          .getByRole("combobox", { name: "Documents for", exact: true })
          .selectOption("payable")
        await page.getByRole("button", { name: "Apply filters", exact: true }).click()
        await page.getByText("No supplier bills in this legal entity yet.").waitFor()
        assert.equal(new URL(page.url()).searchParams.get("side"), "payable")
      })

      assert.deepEqual(errors, [])
    }),
  { timeout: 120_000 },
)

const mockBilling = (
  page: Page,
  options: { readonly configurations: unknown[]; readonly documentsStatus: number },
) =>
  page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "")

    if (path === "/user-accounts") return fulfillJson(route, 200, [])

    if (path === "/accounting/configurations") {
      return fulfillJson(route, 200, options.configurations)
    }

    if (path === "/billing/documents") {
      return options.documentsStatus === 403
        ? fulfillJson(route, 403, forbiddenBody())
        : fulfillJson(route, 200, [invoice])
    }

    return fulfillJson(route, 404, { code: "unexpected_test_request" })
  })

it.effect(
  "tells the user when they may not read billing documents",
  () =>
    Effect.gen(function* () {
      const { page, url } = yield* builtApp

      yield* Effect.promise(async () => {
        await mockBilling(page, { configurations: [configuration], documentsStatus: 403 })
        await openBilling(page, url)
        const alert = page.getByRole("alert")
        await alert.waitFor()
        assert.include(await alert.innerText(), "permission")
        await page.getByRole("button", { name: "Try loading billing documents again" }).waitFor()
      })
    }),
  { timeout: 120_000 },
)

it.effect(
  "explains that billing needs a configured legal entity",
  () =>
    Effect.gen(function* () {
      const { page, url } = yield* builtApp

      yield* Effect.promise(async () => {
        await mockBilling(page, { configurations: [], documentsStatus: 200 })
        await openBilling(page, url)
        await page.getByText("No legal entity is configured for accounting yet.").waitFor()
        await page.getByRole("link", { name: "Configure one in Accounting" }).waitFor()
      })
    }),
  { timeout: 120_000 },
)
