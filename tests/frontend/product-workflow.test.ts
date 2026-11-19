import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { builtApp, connectToTenant, fulfillJson, mockRoutes } from "./browser.ts"

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
          const dialog = page.getByRole("dialog", { name: "Create product" })
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
