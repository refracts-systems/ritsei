import { AxeBuilder } from "@axe-core/playwright"
import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { Page } from "playwright"
import { builtApp, conflictBody, connectToTenant, fulfillJson, mockRoutes } from "./browser.ts"

const tenantId = "01900000-0000-7000-8000-000000000010"
const relationshipId = "01900000-0000-7000-8000-000000000020"
const supplierAccountId = "01900000-0000-7000-8000-000000000021"
const partyId = "01900000-0000-7000-8000-000000000022"
const legalEntityId = "01900000-0000-7000-8000-000000000023"
const productId = "01900000-0000-7000-8000-000000000030"
const orderId = "01900000-0000-7000-8000-000000000031"
const orderLineId = "01900000-0000-7000-8000-000000000032"
const warehouseId = "01900000-0000-7000-8000-000000000035"

const supplierAccount = {
  id: supplierAccountId,
  tenantId,
  supplierRelationshipId: relationshipId,
  partyId,
  legalEntityId,
}

const directory = [
  {
    party: { id: partyId, tenantId, kind: "organization", name: "PT Pemasok" },
    legalEntityId: null,
  },
]

const product = { id: productId, tenantId, code: "WIDGET", name: "Widget", type: "stockable" }

const legacyOrder = (status: string) => ({
  id: orderId,
  tenantId,
  supplierAccountId,
  status,
  confirmedAt: status === "draft" ? null : "2026-09-13T12:00:00.000Z",
  total: "25.00",
  lines: [{ id: orderLineId, itemId: productId, quantity: "2", unitPrice: "12.50" }],
})

const matching = (status: string, received: string, returned: string) => ({
  purchaseOrderId: orderId,
  supplierAccountId,
  partyId,
  legalEntityId,
  status,
  lines: [
    {
      purchaseOrderLineId: orderLineId,
      productId,
      ordered: "2",
      received,
      returned,
      unitPrice: "12.50",
      taxCodeId: null,
    },
  ],
})

const connectAndOpenProcurement = async (page: Page, url: string) => {
  await connectToTenant(page, url, "procurement-session", tenantId, "User accounts")
  await page.getByRole("link", { name: "Supply", exact: true }).click()
  await page.getByRole("heading", { name: "Procurement", exact: true }).waitFor({ timeout: 5_000 })
}

it.effect(
  "drafts, releases, receives, and returns a purchase order",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      let status = "draft"
      let received = "0"
      let returned = "0"
      let receiptAttempts = 0
      let draftBody: unknown
      let receiptBody: unknown
      let returnBody: unknown
      let released = 0

      yield* Effect.promise(async () => {
        await mockRoutes(page, {
          "GET /user-accounts": (route) => fulfillJson(route, 200, []),
          "GET /parties": (route) => fulfillJson(route, 200, directory),
          "GET /product/products": (route) => fulfillJson(route, 200, [product]),
          "GET /procurement/supplier-accounts": (route) =>
            fulfillJson(route, 200, [supplierAccount]),
          "GET /procurement/purchase-orders": (route) =>
            fulfillJson(
              route,
              200,
              status === "draft" && draftBody === undefined ? [] : [legacyOrder(status)],
            ),
          [`GET /procurement/purchase-orders/${orderId}`]: (route) =>
            fulfillJson(route, 200, legacyOrder(status)),
          [`GET /procurement/purchase-orders/${orderId}/receipts`]: (route) =>
            fulfillJson(route, 200, []),
          [`GET /procurement/purchase-orders/${orderId}/matching`]: (route) =>
            fulfillJson(route, 200, matching(status, received, returned)),
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
          "POST /procurement/purchase-order-drafts": (route) => {
            draftBody = route.request().postDataJSON()

            return fulfillJson(route, 201, {
              purchaseOrderId: orderId,
              total: "25.00",
              approval: null,
            })
          },
          [`POST /procurement/purchase-orders/${orderId}/release`]: (route) => {
            released += 1
            status = "confirmed"

            return fulfillJson(route, 200, matching(status, received, returned))
          },
          [`POST /procurement/purchase-orders/${orderId}/valued-receipts`]: (route) => {
            receiptAttempts += 1
            receiptBody = route.request().postDataJSON()

            if (receiptAttempts === 1) {
              return fulfillJson(route, 409, conflictBody("PurchaseReceiptQuantityExceeded"))
            }

            received = "2"

            return fulfillJson(route, 201, {
              id: orderLineId,
              purchaseOrderId: orderId,
              number: "GR/2026/00001",
            })
          },
          [`POST /procurement/purchase-orders/${orderId}/returns`]: (route) => {
            returnBody = route.request().postDataJSON()
            returned = "1"

            return fulfillJson(route, 201, {
              id: orderLineId,
              purchaseOrderId: orderId,
              number: "RT/2026/00001",
            })
          },
        })

        await connectAndOpenProcurement(page, url)

        await page.getByRole("button", { name: "Create purchase order", exact: true }).click()
        const draftDialog = page.getByRole("dialog", { name: "Create purchase order" })
        await draftDialog.waitFor()
        await draftDialog
          .getByRole("combobox", { name: "Supplier", exact: true })
          .selectOption(supplierAccountId)
        await draftDialog
          .getByRole("combobox", { name: "Product 1", exact: true })
          .selectOption(productId)
        await draftDialog.getByRole("textbox", { name: "Quantity 1", exact: true }).fill("2")
        await draftDialog.getByRole("textbox", { name: "Unit price 1", exact: true }).fill("12.50")
        assert.deepEqual(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
          [],
        )
        await draftDialog
          .getByRole("button", { name: "Create purchase order", exact: true })
          .click()
        await draftDialog.waitFor({ state: "hidden" })
        await page.getByRole("heading", { name: "Purchase order detail", exact: true }).waitFor()
        assert.equal(new URL(page.url()).pathname, `/procurement/${orderId}`)
        assert.deepEqual(draftBody, {
          supplierAccountId,
          lines: [{ productId, quantity: "2", unitPrice: "12.50" }],
        })

        await page.getByRole("heading", { name: "Receiving", exact: true }).waitFor()
        await page.getByRole("button", { name: "Release purchase order", exact: true }).click()
        await page.getByRole("button", { name: "Receive goods", exact: true }).waitFor()
        assert.equal(released, 1)

        await page.getByRole("button", { name: "Receive goods", exact: true }).click()
        const receiveDialog = page.getByRole("dialog", { name: "Receive goods" })
        await receiveDialog.waitFor()
        await receiveDialog.getByRole("combobox", { name: "Warehouse" }).selectOption(warehouseId)
        await receiveDialog.getByRole("button", { name: "Receive goods", exact: true }).click()
        await receiveDialog.getByRole("alert").waitFor()
        assert.include(
          await receiveDialog.getByRole("alert").innerText(),
          "more than what is still to be received",
        )
        await receiveDialog.getByRole("button", { name: "Receive goods", exact: true }).click()
        await receiveDialog.waitFor({ state: "hidden" })
        assert.deepEqual(receiptBody, {
          warehouseId,
          receiptDate: new Date().toISOString().slice(0, 10),
          lines: [{ purchaseOrderLineId: orderLineId, quantity: "2" }],
        })
        await page.getByText("Everything ordered has been received.").waitFor()

        await page.getByRole("button", { name: "Return to supplier", exact: true }).click()
        const returnDialog = page.getByRole("dialog", { name: "Return to supplier" })
        await returnDialog.waitFor()
        await returnDialog.getByRole("combobox", { name: "Warehouse" }).selectOption(warehouseId)
        await returnDialog.getByRole("textbox", { name: /Widget.*can be returned/ }).fill("1")
        await returnDialog.getByRole("button", { name: "Return to supplier", exact: true }).click()
        await returnDialog.waitFor({ state: "hidden" })
        assert.deepEqual(returnBody, {
          warehouseId,
          returnDate: new Date().toISOString().slice(0, 10),
          lines: [{ purchaseOrderLineId: orderLineId, quantity: "1" }],
        })
      })

      assert.deepEqual(errors, [])
    }),
  { timeout: 150_000 },
)

it.effect(
  "keeps the workspace usable when the order cannot be found",
  () =>
    Effect.gen(function* () {
      const { page, url } = yield* builtApp

      yield* Effect.promise(async () => {
        await mockRoutes(page, {
          "GET /user-accounts": (route) => fulfillJson(route, 200, []),
          "GET /parties": (route) => fulfillJson(route, 200, directory),
          "GET /procurement/supplier-accounts": (route) =>
            fulfillJson(route, 200, [supplierAccount]),
          "GET /procurement/purchase-orders": (route) => fulfillJson(route, 200, []),
        })
        await connectAndOpenProcurement(page, url)
        await page.getByText("No purchase orders match the current filters.").waitFor()
      })
    }),
  { timeout: 120_000 },
)
