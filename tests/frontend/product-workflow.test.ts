import { AxeBuilder } from "@axe-core/playwright"
import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { CustomFieldValues } from "../../apps/web/src/shared/custom-field-values.ts"
import {
  builtApp,
  conflictBody,
  connectToTenant,
  forbiddenBody,
  fulfillJson,
  mockRoutes,
  openedDialog,
} from "./browser.ts"

const tenantId = "01910000-0000-7000-8000-000000000010"

it.effect(
  "keeps the chosen product type and code while the create is in flight",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      let arrived!: () => void
      let release!: () => void
      const requestArrived = new Promise<void>((resolve) => (arrived = resolve))
      const released = new Promise<void>((resolve) => (release = resolve))

      yield* Effect.promise(async () => {
        await mockRoutes(page, {
          "GET /user-accounts": (route) => fulfillJson(route, 200, []),
          "GET /product/products": (route) => fulfillJson(route, 200, []),
          "POST /product/products": async (route) => {
            arrived()
            await released

            return fulfillJson(route, 201, {
              id: "01910000-0000-7000-8000-000000000015",
              tenantId,
              code: "A1",
              name: "Svc",
              type: "service",
              category: null,
              unitOfMeasure: "EA",
              active: true,
            })
          },
        })

        try {
          await connectToTenant(page, url, "product-session", tenantId, "User accounts")
          await page.getByRole("link", { name: "Products", exact: true }).click()
          await page.getByRole("button", { name: "Create product", exact: true }).click()
          const dialog = await openedDialog(page, "Create product")
          await dialog.getByLabel("Code").fill("A1")
          await dialog.getByLabel("Name").fill("Svc")
          await dialog.getByLabel("Type").selectOption("service")
          await dialog.getByRole("button", { name: "Create product" }).click()
          await requestArrived
          // The fields are disabled while the request is pending and still show what was chosen.
          await page.waitForFunction(
            () => document.querySelector<HTMLInputElement>('input[name="code"]')?.disabled,
          )
          assert.equal(await dialog.getByLabel("Code").inputValue(), "A1")
          assert.equal(await dialog.getByLabel("Type").inputValue(), "service")
        } finally {
          release()
        }

        await page.getByRole("dialog", { name: "Create product" }).waitFor({ state: "hidden" })
      })

      assert.deepEqual(errors, [])
    }),
  { timeout: 120_000 },
)

const product = {
  id: "01910000-0000-7000-8000-000000000015",
  tenantId,
  code: "F-12",
  name: "Freight label",
  type: "consumable",
  category: "Packaging",
  unitOfMeasure: "EA",
  active: true,
}

const fieldPath = `/product/products/${product.id}/custom-fields`

const field = {
  tenantId,
  documentType: "product.product",
  required: false,
  choices: null,
}

const definitions = [
  {
    ...field,
    id: "01910000-0000-7000-8000-000000000021",
    key: "weight",
    label: "Weight",
    kind: "number",
    position: 0,
  },
  {
    ...field,
    id: "01910000-0000-7000-8000-000000000022",
    key: "fragile",
    label: "Fragile",
    kind: "boolean",
    position: 1,
  },
  {
    ...field,
    id: "01910000-0000-7000-8000-000000000023",
    key: "label_note",
    label: "Label note",
    kind: "text",
    position: 2,
  },
]

const initial = { weight: "1.2500", fragile: true, label_note: " Keep\r\nspacing " }

it.effect(
  "opens product details and saves only changed custom fields after a rejected edit",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp

      let allowWrite = false
      let invalidResponse = false
      let current: CustomFieldValues = initial
      const saved: unknown[] = []

      yield* Effect.promise(async () => {
        await mockRoutes(page, {
          "GET /product/products": (route) => fulfillJson(route, 200, [product]),
          [`GET /product/products/${product.id}`]: (route) => fulfillJson(route, 200, product),
          "GET /product/custom-fields": (route) => fulfillJson(route, 200, definitions),
          [`GET ${fieldPath}`]: (route) => fulfillJson(route, 200, current),
          [`POST ${fieldPath}`]: (route) => {
            const body = route.request().postDataJSON()
            saved.push(body)

            if (!allowWrite) return fulfillJson(route, 403, forbiddenBody())

            if (body.values.weight === "heavy") {
              return fulfillJson(route, 409, conflictBody("CustomFieldValueInvalid"))
            }

            current = { weight: body.values.weight, label_note: initial.label_note }

            return fulfillJson(route, 200, invalidResponse ? [] : current)
          },
        })

        await connectToTenant(page, url, "product-fields-session", tenantId, "My work")
        await page.getByRole("link", { name: "Products", exact: true }).click()
        const productLink = page.getByRole("link", { name: product.code, exact: true })
        await productLink.focus()
        await page.keyboard.press("Enter")
        await page.waitForURL(`**/product/${product.id}`)
        await page.getByRole("heading", { name: product.name }).waitFor()

        const fields = page.getByRole("region", { name: "Custom fields" })
        await fields.getByText("1.2500", { exact: true }).waitFor()
        await fields.getByText("Yes", { exact: true }).waitFor()
        const edit = fields.getByRole("button", { name: "Edit custom fields" })
        await edit.focus()
        await page.keyboard.press("Enter")
        const dialog = await openedDialog(page, "Edit custom fields")
        assert.deepEqual(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
          [],
        )

        const weight = dialog.getByLabel("Weight")
        const save = dialog.getByRole("button", { name: "Save fields" })
        await weight.fill("heavy")
        await save.press("Enter")
        await dialog.getByText("You do not have permission to perform this action.").waitFor()
        assert.equal(await weight.inputValue(), "heavy")
        assert.deepEqual(current, initial)

        allowWrite = true
        await save.press("Enter")
        await dialog.getByText("A value does not fit its field.", { exact: false }).waitFor()
        assert.equal(await weight.inputValue(), "heavy")

        await weight.fill("2.6400")
        await dialog.getByLabel("Fragile").selectOption("")
        await save.press("Enter")
        await dialog.waitFor({ state: "hidden" })
        await fields.getByText("2.6400", { exact: true }).waitFor()
        await fields.getByText("Not set", { exact: true }).waitFor()
        assert.deepEqual(saved, [
          { values: { weight: "heavy" } },
          { values: { weight: "heavy" } },
          { values: { weight: "2.6400", fragile: null } },
        ])

        invalidResponse = true
        await edit.click()
        await weight.fill("3.0000")
        await save.click()
        await dialog.getByText("The server may have saved this change.", { exact: false }).waitFor()
        assert.isTrue(await save.isDisabled())
        await dialog.getByRole("button", { name: "Reload custom fields before retrying" }).click()
        await dialog.waitFor({ state: "hidden" })
        await fields.getByText("3.0000", { exact: true }).waitFor()

        await page.getByRole("link", { name: "Back to Products" }).click()
        await productLink.waitFor()
      })

      assert.deepEqual(errors, [])
    }),
  { timeout: 120_000 },
)
