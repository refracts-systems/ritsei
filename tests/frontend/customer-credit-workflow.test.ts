import { AxeBuilder } from "@axe-core/playwright"
import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { Page } from "playwright"
import { builtApp, connectToTenant, entranceFinished, fulfillJson, mockRoutes } from "./browser.ts"
import type { RouteHandler } from "./browser.ts"

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
        await dialog.waitFor()
        assert.isTrue(await entranceFinished(page))
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
        await dialog.waitFor()
        assert.isTrue(await entranceFinished(page))
        // Clearing presses Delete on the focused element; the focus trap must be done moving focus.
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

/** Opens the customer's "Set credit limit" dialog, answering the save with `save`. */
const openLimitDialog = async (page: Page, url: string, save: RouteHandler) => {
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
        receivableBalance: "115.44",
        confirmedNotInvoiced: "36.00",
        available: null,
      }),
    [`POST /sales/customers/${customerId}/credit-limit`]: save,
  })

  await connectToTenant(page, url, "credit-session", tenantId, "User accounts")
  await page.getByRole("link", { name: "Revenue", exact: true }).click()
  await page.getByRole("link", { name: customer.name, exact: true }).click()
  await page.getByRole("heading", { name: "Credit", exact: true }).waitFor()

  const credit = page.getByRole("region", { name: "Credit" })
  await credit.getByText("No limit").waitFor()
  await credit.getByRole("button", { name: "Set credit limit" }).click()
  const dialog = page.getByRole("dialog", { name: "Set credit limit" })

  return {
    dialog,
    field: dialog.getByLabel("Credit limit"),
    save: dialog.getByRole("button", { name: "Save limit", exact: true }),
  }
}

it.effect(
  "keeps the typed credit limit visible while the save is in flight",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      let arrived!: () => void
      let release!: () => void
      const requestArrived = new Promise<void>((resolve) => (arrived = resolve))
      const responseReleased = new Promise<void>((resolve) => (release = resolve))

      yield* Effect.promise(async () => {
        const { dialog, field, save } = await openLimitDialog(page, url, async (route) => {
          arrived()
          // Hold the save in flight so the pending state can be observed.
          await responseReleased

          return fulfillJson(route, 200, {
            customerId,
            creditLimit: "500.00",
            receivableBalance: "115.44",
            confirmedNotInvoiced: "36.00",
            available: "348.56",
          })
        })

        try {
          await field.fill("500.00")
          await save.click()
          await requestArrived
          // The field is disabled while the request is pending and still shows what was typed.
          await page.waitForFunction(
            () => document.querySelector<HTMLInputElement>('input[name="creditLimit"]')?.disabled,
          )
          assert.equal(await field.inputValue(), "500.00")
        } finally {
          release()
        }

        await dialog.waitFor({ state: "hidden" })
      })

      assert.deepEqual(errors, [])
    }),
  { timeout: 120_000 },
)

it.effect(
  "keeps the typed credit limit when an invalid submit shows its error",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      let requests = 0

      yield* Effect.promise(async () => {
        const { dialog, field, save } = await openLimitDialog(page, url, (route) => {
          requests += 1

          return fulfillJson(route, 500, { code: "unexpected_test_request" })
        })

        await field.fill("5000.555")
        await save.click()
        await dialog.getByText("Enter an amount such as 5000.00, or leave it empty.").waitFor()
        // The error appears beside the field; the field is the same input, flagged invalid.
        assert.equal(await field.inputValue(), "5000.555")
        assert.equal(await field.getAttribute("aria-invalid"), "true")
        // The field is described by its helper text and the new error.
        const describedBy = ((await field.getAttribute("aria-describedby")) ?? "").split(" ")
        assert.equal(describedBy.length, 2)
        assert.isTrue(describedBy[1]?.endsWith("-error") ?? false)
        assert.equal(requests, 0)
      })

      assert.deepEqual(errors, [])
    }),
  { timeout: 120_000 },
)
