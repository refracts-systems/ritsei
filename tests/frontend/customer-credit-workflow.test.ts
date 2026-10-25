import { AxeBuilder } from "@axe-core/playwright"
import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { builtApp, connectToTenant, fulfillJson, mockRoutes } from "./browser.ts"

const tenantId = "01910000-0000-7000-8000-000000000010"
const customerId = "01910000-0000-7000-8000-000000000011"

const customer = { id: customerId, tenantId, name: "Northwind Customer", email: "n@example.test" }

it.effect(
  "shows a customer's credit standing and sets or removes the limit",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      let limit: string | null = null
      const posted: unknown[] = []

      const standing = () => ({
        customerId,
        creditLimit: limit,
        receivableBalance: "115.44",
        confirmedNotInvoiced: "36.00",
        available: limit === null ? null : (Number(limit) - 115.44 - 36).toFixed(2),
      })

      yield* Effect.promise(async () => {
        await mockRoutes(page, {
          "GET /user-accounts": (route) => fulfillJson(route, 200, []),
          "GET /sales/customers": (route) => fulfillJson(route, 200, [customer]),
          "GET /sales/quotations": (route) => fulfillJson(route, 200, []),
          "GET /sales/orders": (route) => fulfillJson(route, 200, []),
          [`GET /sales/customers/${customerId}`]: (route) => fulfillJson(route, 200, customer),
          [`GET /sales/customers/${customerId}/credit`]: (route) =>
            fulfillJson(route, 200, standing()),
          [`POST /sales/customers/${customerId}/credit-limit`]: (route) => {
            const body = route.request().postDataJSON()

            posted.push(body)
            limit = body.creditLimit

            return fulfillJson(route, 200, standing())
          },
        })

        await connectToTenant(page, url, "credit-session", tenantId, "User accounts")
        await page.getByRole("link", { name: "Revenue", exact: true }).click()
        await page.getByRole("link", { name: customer.name, exact: true }).click()
        await page.getByRole("heading", { name: "Credit", exact: true }).waitFor()

        const credit = page.getByRole("region", { name: "Credit" })
        await credit.getByText("No limit").waitFor()
        await credit.getByText("115.44").waitFor()
        await credit.getByText("Confirmed, not yet invoiced").waitFor()
        await credit.getByText("36.00").waitFor()
        assert.deepEqual(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
          [],
        )

        // A malformed amount is explained and nothing is sent.
        await credit.getByRole("button", { name: "Set credit limit" }).click()
        const dialog = page.getByRole("dialog", { name: "Set credit limit" })
        await dialog.getByLabel("Credit limit").fill("5000.555")
        await dialog.getByRole("button", { name: "Save limit", exact: true }).click()
        await dialog.getByText("Enter an amount such as 5000.00, or leave it empty.").waitFor()
        assert.deepEqual(posted, [])

        await dialog.getByLabel("Credit limit").fill("500.00")
        await dialog.getByRole("button", { name: "Save limit", exact: true }).click()
        await dialog.waitFor({ state: "hidden" })
        await credit.getByText("348.56").waitFor()
        assert.deepEqual(posted, [{ creditLimit: "500.00" }])

        // Emptying the field removes the limit.
        await credit.getByRole("button", { name: "Set credit limit" }).click()
        await dialog.getByLabel("Credit limit").fill("")
        await dialog.getByRole("button", { name: "Save limit", exact: true }).click()
        await dialog.waitFor({ state: "hidden" })
        await credit.getByText("No limit").waitFor()
        assert.deepEqual(posted, [{ creditLimit: "500.00" }, { creditLimit: null }])
      })

      assert.deepEqual(errors, [])
    }),
  { timeout: 120_000 },
)
