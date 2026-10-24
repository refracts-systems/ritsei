import { AxeBuilder } from "@axe-core/playwright"
import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { Page } from "playwright"
import {
  builtApp,
  conflictBody,
  connectToTenant,
  fulfillJson,
  mockRoutes,
  type RouteHandler,
} from "./browser.ts"

const tenantId = "01910000-0000-7000-8000-000000000010"
const customerId = "01910000-0000-7000-8000-000000000011"
const quotationId = "01910000-0000-7000-8000-000000000012"
const orderId = "01910000-0000-7000-8000-000000000013"
const productId = "01910000-0000-7000-8000-000000000015"
const legalEntityId = "01910000-0000-7000-8000-000000000016"
const orderLineId = "01910000-0000-7000-8000-000000000017"
const warehouseId = "01910000-0000-7000-8000-000000000018"

const customer = { id: customerId, tenantId, name: "Northwind Customer", email: "n@example.test" }
const product = { id: productId, tenantId, code: "WIDGET", name: "Widget", type: "stockable" }

const quotationDocument = (status: string) => ({
  id: quotationId,
  tenantId,
  customerId,
  legalEntityId,
  status,
  validUntil: "2026-12-31",
  total: "25.00",
  lines: [
    {
      id: orderLineId,
      productId,
      quantity: "2",
      listPrice: "12.50",
      discountPercent: "0",
      unitPrice: "12.50",
      taxCodeId: null,
      lineTotal: "25.00",
    },
  ],
})

const confirmedOrder = {
  id: orderId,
  tenantId,
  customerId,
  quotationId,
  status: "confirmed",
  confirmedAt: "2026-10-20T00:00:00.000Z",
  total: "25.00",
  lines: [{ itemId: productId, quantity: "2", unitPrice: "12.50" }],
}

const fulfillment = (delivered: string) => ({
  orderId,
  tenantId,
  legalEntityId,
  customerId,
  partyId: customerId,
  status: "confirmed",
  lines: [
    { orderLineId, productId, quantity: "2", unitPrice: "12.50", taxCodeId: null, delivered },
  ],
})

const openSales = async (page: Page, url: string) => {
  await connectToTenant(page, url, "sales-session", tenantId, "User accounts")
  await page.getByRole("link", { name: "Revenue", exact: true }).click()
  await page.getByRole("heading", { name: "Sales", exact: true }).waitFor({ timeout: 5_000 })
}

const common = {
  "GET /user-accounts": (route) => fulfillJson(route, 200, []),
  "GET /sales/customers": (route) => fulfillJson(route, 200, [customer]),
  "GET /product/products": (route) => fulfillJson(route, 200, [product]),
} satisfies Record<string, RouteHandler>

it.effect(
  "sends, accepts, and converts a priced quotation",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      let status = "draft"
      const taken: string[] = []

      const step = (action: string, next: string): [string, RouteHandler] => [
        `POST /sales/quotation-documents/${quotationId}/${action}`,
        (route) => {
          taken.push(action)
          status = next

          return fulfillJson(
            route,
            200,
            action === "convert" ? { orderId } : quotationDocument(status),
          )
        },
      ]

      yield* Effect.promise(async () => {
        await mockRoutes(page, {
          ...common,
          "GET /sales/quotations": (route) =>
            fulfillJson(route, 200, [
              { id: quotationId, tenantId, customerId, status, total: "25.00" },
            ]),
          [`GET /sales/quotations/${quotationId}`]: (route) =>
            fulfillJson(route, 200, {
              id: quotationId,
              tenantId,
              customerId,
              status,
              total: "25.00",
            }),
          [`GET /sales/quotation-documents/${quotationId}`]: (route) =>
            fulfillJson(route, 200, quotationDocument(status)),
          "GET /sales/orders": (route) => fulfillJson(route, 200, []),
          [`GET /sales/orders/${orderId}`]: (route) => fulfillJson(route, 200, confirmedOrder),
          [`GET /sales/orders/${orderId}/fulfillment`]: (route) =>
            fulfillJson(route, 200, fulfillment("0")),
          "GET /inventory/warehouses": (route) => fulfillJson(route, 200, []),
          ...Object.fromEntries([
            step("send", "sent"),
            step("accept", "accepted"),
            step("convert", "accepted"),
          ]),
        })

        await openSales(page, url)
        await page.locator(`a[href="/sales/quotations/${quotationId}"]`).first().click()
        await page.getByRole("heading", { name: "Quoted lines", exact: true }).waitFor()
        await page.getByRole("rowheader", { name: "Widget", exact: true }).waitFor()
        assert.equal(await page.getByRole("button", { name: "Accept quotation" }).count(), 0)
        assert.deepEqual(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
          [],
        )

        await page.getByRole("button", { name: "Send quotation", exact: true }).click()
        await page.getByRole("button", { name: "Accept quotation", exact: true }).waitFor()
        assert.equal(await page.getByRole("button", { name: "Send quotation" }).count(), 0)

        await page.getByRole("button", { name: "Accept quotation", exact: true }).click()
        await page.getByRole("button", { name: "Convert to order", exact: true }).waitFor()

        await page.getByRole("button", { name: "Convert to order", exact: true }).click()
        await page.getByRole("heading", { name: "Sales order detail", exact: true }).waitFor()
        assert.equal(new URL(page.url()).pathname, `/sales/orders/${orderId}`)
        assert.deepEqual(taken, ["send", "accept", "convert"])
      })

      assert.deepEqual(errors, [])
    }),
  { timeout: 120_000 },
)

it.effect(
  "records a delivery that issues stock and explains why it cannot",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      let delivered = "0"
      let attempts = 0
      let deliveryBody: unknown

      yield* Effect.promise(async () => {
        await mockRoutes(page, {
          ...common,
          "GET /sales/quotations": (route) => fulfillJson(route, 200, []),
          "GET /sales/orders": (route) => fulfillJson(route, 200, [confirmedOrder]),
          [`GET /sales/orders/${orderId}`]: (route) => fulfillJson(route, 200, confirmedOrder),
          [`GET /sales/orders/${orderId}/fulfillment`]: (route) =>
            fulfillJson(route, 200, fulfillment(delivered)),
          "GET /inventory/warehouses": (route) =>
            fulfillJson(route, 200, [
              {
                id: warehouseId,
                tenantId,
                legalEntityId,
                primaryBranchId: null,
                name: "Main Warehouse",
              },
            ]),
          "POST /process/order-deliveries": (route) => {
            attempts += 1
            deliveryBody = route.request().postDataJSON()

            if (attempts === 1) return fulfillJson(route, 409, conflictBody("StockUnavailable"))
            delivered = "2"

            return fulfillJson(route, 201, {
              delivery: { id: orderLineId, number: "DO/2026/00001", deliveryDate: "2026-10-24" },
              stock: null,
            })
          },
        })

        await openSales(page, url)
        await page.locator(`a[href="/sales/orders/${orderId}"]`).first().click()
        await page.getByRole("heading", { name: "Delivery", exact: true }).waitFor()
        await page.getByRole("rowheader", { name: "Widget", exact: true }).waitFor()

        await page.getByRole("button", { name: "Record delivery", exact: true }).click()
        const dialog = page.getByRole("dialog", { name: "Record delivery" })
        await dialog.waitFor()
        assert.equal(
          await dialog.getByRole("textbox", { name: /Widget.*2 left/ }).inputValue(),
          "2",
        )
        assert.deepEqual(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
          [],
        )
        await dialog.getByRole("combobox", { name: "Warehouse" }).selectOption(warehouseId)
        await dialog.getByRole("button", { name: "Record delivery", exact: true }).click()
        await dialog.getByRole("alert").waitFor()
        assert.include(await dialog.getByRole("alert").innerText(), "not enough stock")

        await dialog.getByRole("button", { name: "Record delivery", exact: true }).click()
        await page.getByText("Everything on this order has been delivered.").waitFor()
        assert.deepEqual(deliveryBody, {
          orderId,
          warehouseId,
          deliveryDate: new Date().toISOString().slice(0, 10),
          lines: [{ orderLineId, quantity: "2" }],
        })
      })

      assert.deepEqual(errors, [])
    }),
  { timeout: 120_000 },
)
