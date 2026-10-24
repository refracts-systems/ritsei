import { AxeBuilder } from "@axe-core/playwright"
import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { builtApp, connectToTenant, fulfillJson, mockRoutes } from "./browser.ts"

const tenantId = "01900000-0000-7000-8000-000000000010"
const supplierAccountId = "01900000-0000-7000-8000-000000000021"
const partyId = "01900000-0000-7000-8000-000000000022"
const legalEntityId = "01900000-0000-7000-8000-000000000023"
const widgetId = "01900000-0000-7000-8000-000000000030"
const cableId = "01900000-0000-7000-8000-000000000031"

const products = [
  { id: widgetId, tenantId, code: "WIDGET", name: "Widget", type: "stockable" },
  { id: cableId, tenantId, code: "CABLE", name: "Cable", type: "stockable" },
]

it.effect(
  "lists a supplier's prices and sets one",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      const prices = [{ supplierAccountId, productId: widgetId, unitPrice: "6.00" }]
      const listed: Array<string | null> = []
      const posted: unknown[] = []

      yield* Effect.promise(async () => {
        await mockRoutes(page, {
          "GET /user-accounts": (route) => fulfillJson(route, 200, []),
          "GET /parties": (route) =>
            fulfillJson(route, 200, [
              {
                party: { id: partyId, tenantId, kind: "organization", name: "PT Pemasok" },
                legalEntityId: null,
              },
            ]),
          "GET /product/products": (route) => fulfillJson(route, 200, products),
          "GET /procurement/purchase-orders": (route) => fulfillJson(route, 200, []),
          "GET /procurement/supplier-accounts": (route) =>
            fulfillJson(route, 200, [
              {
                id: supplierAccountId,
                tenantId,
                supplierRelationshipId: "01900000-0000-7000-8000-000000000020",
                partyId,
                legalEntityId,
              },
            ]),
          "GET /procurement/supplier-prices": (route) => {
            listed.push(new URL(route.request().url()).searchParams.get("supplierAccountId"))

            return fulfillJson(route, 200, prices)
          },
          "POST /procurement/supplier-prices": (route) => {
            const body = route.request().postDataJSON()

            posted.push(body)
            prices.push(body)

            return fulfillJson(route, 200, body)
          },
        })

        await connectToTenant(page, url, "prices-session", tenantId, "User accounts")
        await page.getByRole("link", { name: "Supply", exact: true }).click()
        await page.getByRole("button", { name: "Prices", exact: true }).click()

        const dialog = page.getByRole("dialog", { name: "Supplier prices" })
        await dialog.getByRole("cell", { name: "6.00", exact: true }).waitFor()
        assert.deepEqual(listed, [supplierAccountId])
        assert.deepEqual(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
          [],
        )

        // A malformed price is explained and nothing is sent.
        await dialog.getByLabel("Product").selectOption(cableId)
        await dialog.getByLabel("Unit price").fill("6.505")
        await dialog.getByRole("button", { name: "Set price", exact: true }).click()
        await dialog.getByText("Choose a product and enter a price such as 6.50.").waitFor()
        assert.deepEqual(posted, [])

        await dialog.getByLabel("Product").selectOption(cableId)
        await dialog.getByLabel("Unit price").fill("4.25")
        await dialog.getByRole("button", { name: "Set price", exact: true }).click()
        await dialog.getByRole("cell", { name: "4.25", exact: true }).waitFor()
        assert.deepEqual(posted, [{ supplierAccountId, productId: cableId, unitPrice: "4.25" }])
        await dialog.getByText("Price saved.").waitFor()
      })

      assert.deepEqual(errors, [])
    }),
  { timeout: 120_000 },
)
