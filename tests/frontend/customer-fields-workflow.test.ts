import { AxeBuilder } from "@axe-core/playwright"
import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { builtApp, connectToTenant, fulfillJson, mockRoutes } from "./browser.ts"

const tenantId = "01910000-0000-7000-8000-000000000010"
const customerId = "01910000-0000-7000-8000-000000000011"

const customer = { id: customerId, tenantId, name: "Northwind Customer", email: "n@example.test" }

const tier = {
  id: "01910000-0000-7000-8000-000000000020",
  key: "tier",
  label: "Tier",
  kind: "choice",
  required: false,
  choices: ["gold", "silver"],
  position: 0,
}

it.effect(
  "defines a customer field and edits its value",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      const definitions: unknown[] = []
      const values = new Map<string, string | boolean | null>()
      const defined: unknown[] = []
      const saved: unknown[] = []

      yield* Effect.promise(async () => {
        await mockRoutes(page, {
          "GET /user-accounts": (route) => fulfillJson(route, 200, []),
          "GET /sales/customers": (route) => fulfillJson(route, 200, [customer]),
          "GET /sales/quotations": (route) => fulfillJson(route, 200, []),
          "GET /sales/orders": (route) => fulfillJson(route, 200, []),
          [`GET /sales/customers/${customerId}`]: (route) => fulfillJson(route, 200, customer),
          [`GET /sales/customers/${customerId}/credit`]: (route) =>
            fulfillJson(route, 200, {
              customerId,
              creditLimit: null,
              receivableBalance: "0.00",
              confirmedNotInvoiced: "0.00",
              available: null,
            }),
          "GET /sales/custom-fields": (route) => fulfillJson(route, 200, definitions),
          "POST /sales/custom-fields": (route) => {
            defined.push(route.request().postDataJSON())
            definitions.push(tier)

            return fulfillJson(route, 201, tier)
          },
          [`GET /sales/customers/${customerId}/custom-fields`]: (route) =>
            fulfillJson(route, 200, Object.fromEntries(values)),
          [`POST /sales/customers/${customerId}/custom-fields`]: (route) => {
            const body = route.request().postDataJSON()

            saved.push(body)

            for (const [key, value] of Object.entries<string | boolean | null>(body.values)) {
              values.set(key, value)
            }

            return fulfillJson(route, 200, Object.fromEntries(values))
          },
        })

        await connectToTenant(page, url, "fields-session", tenantId, "User accounts")
        await page.getByRole("link", { name: "Revenue", exact: true }).click()
        await page.getByRole("link", { name: customer.name, exact: true }).click()

        const section = page.getByRole("region", { name: "Custom fields" })
        await section.getByText("No custom fields are defined for customers yet.").waitFor()

        // A malformed key is explained and nothing is sent.
        await section.getByRole("button", { name: "Add a field" }).click()
        const add = page.getByRole("dialog", { name: "Add a customer field" })
        await add.getByLabel("Label").fill("Tier")
        await add.getByLabel("Key").fill("Tier!")
        await add.getByRole("button", { name: "Add field", exact: true }).click()
        await add.getByText("Enter a label, a key of lowercase letters", { exact: false }).waitFor()
        assert.deepEqual(defined, [])

        await add.getByLabel("Label").fill("Tier")
        await add.getByLabel("Key").fill("tier")
        await add.getByLabel("Kind").selectOption("choice")
        await add.getByLabel("Choices").fill("gold, silver")
        await add.getByRole("button", { name: "Add field", exact: true }).click()
        await add.waitFor({ state: "hidden" })
        assert.deepEqual(defined, [
          { key: "tier", label: "Tier", kind: "choice", choices: ["gold", "silver"] },
        ])
        await section.getByText("Not set").waitFor()
        assert.deepEqual(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
          [],
        )

        await section.getByRole("button", { name: "Edit custom fields" }).click()
        const edit = page.getByRole("dialog", { name: "Edit custom fields" })
        await edit.getByLabel("Tier").selectOption("gold")
        await edit.getByRole("button", { name: "Save fields", exact: true }).click()
        await edit.waitFor({ state: "hidden" })
        await section.getByText("gold", { exact: true }).waitFor()
        assert.deepEqual(saved, [{ values: { tier: "gold" } }])
      })

      assert.deepEqual(errors, [])
    }),
  { timeout: 120_000 },
)
