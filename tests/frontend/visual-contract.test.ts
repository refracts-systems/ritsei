import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { readFile, writeFile } from "node:fs/promises"
import type { Locator, Page, Route } from "playwright"
import { builtApp, connectToTenant } from "./browser.ts"

// Visual contract regression: computed styles of the shell, primitives, and patterns in both themes
// are compared with a committed baseline. Computed styles are deterministic across operating
// systems, unlike pixel screenshots, so the same baseline holds on Windows and Linux CI.
// Regenerate after an intentional design change with:
//   RITSEI_UPDATE_VISUAL_CONTRACT=1 pnpm exec varlock run -- vitest run tests/frontend/visual-contract.test.ts
const baselinePath = "tests/frontend/visual-contract.baseline.json"

const tenantId = "01900000-0000-7000-8000-000000000010"
const customerId = "01900000-0000-7000-8000-000000000101"
const customer = { id: customerId, tenantId, name: "Northwind Customer", email: "n@example.test" }

const quotation = {
  id: "01900000-0000-7000-8000-000000000201",
  tenantId,
  customerId,
  status: "accepted",
  total: "24750.00",
}

const order = {
  id: "01900000-0000-7000-8000-000000000301",
  tenantId,
  customerId,
  quotationId: null,
  status: "draft",
  confirmedAt: null,
  total: "1250.00",
  lines: [{ itemId: "01900000-0000-7000-8000-000000000401", quantity: "2", unitPrice: "625.00" }],
}

const properties = [
  "color",
  "background-color",
  "border-top-color",
  "border-top-width",
  "border-top-left-radius",
  "box-shadow",
  "font-size",
  "font-weight",
  "line-height",
  "height",
] as const

const fulfillJson = <Body>(route: Route, body: Body) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })

const styleOf = (locator: Locator) =>
  locator.first().evaluate(
    (element, names) => {
      const style = getComputedStyle(element)

      return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]))
    },
    [...properties],
  )

const capture = async (page: Page) => {
  const targets = {
    canvas: page.locator("[data-theme]").first(),
    sidebar: page.locator("#global-navigation"),
    topbar: page
      .locator("header")
      .filter({ has: page.getByRole("navigation", { name: /sections$/ }) }),
    navigationActive: page.locator("nav[aria-label=Primary] a[aria-current=page]"),
    navigationIdle: page.locator("nav[aria-label=Primary] a:not([aria-current])"),
    pageTitle: page.getByRole("heading", { name: "Sales", exact: true, level: 1 }),
    buttonPrimary: page.getByRole("button", { name: "Create sales order", exact: true }),
    buttonSecondary: page.getByRole("button", { name: "Create customer", exact: true }),
    surface: page.locator("section[aria-labelledby=sales-customers-heading]"),
    sectionTitle: page.locator("#sales-customers-heading"),
    tableHeader: page.locator("section[aria-labelledby=sales-quotations-heading] thead th"),
    tableCell: page.locator("section[aria-labelledby=sales-quotations-heading] tbody td"),
    badgeSuccess: page.getByText("accepted", { exact: true }),
    badgeNeutral: page.getByText("draft", { exact: true }),
    input: page.getByRole("textbox").first(),
  } satisfies Record<string, Locator>

  const result: Record<string, Record<string, string>> = {}

  for (const [name, locator] of Object.entries(targets)) result[name] = await styleOf(locator)

  await page.getByRole("button", { name: "Create customer", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Create customer" })
  await dialog.waitFor()
  result["dialog"] = await styleOf(dialog)
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })

  return result
}

it.effect(
  "keeps the visual contract of shell, primitives, and patterns in light and dark themes",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp

      const observed = yield* Effect.promise(async () => {
        await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" })
        await page.route("**/api/sales/**", (route) => {
          const path = new URL(route.request().url()).pathname.replace(/^\/api/, "")

          if (path === "/sales/customers") return fulfillJson(route, [customer])

          if (path === "/sales/quotations") return fulfillJson(route, [quotation])

          if (path === "/sales/orders") return fulfillJson(route, [order])

          return route.fallback()
        })
        await connectToTenant(page, url, "visual-session", tenantId, "My work")
        await page.getByRole("link", { name: "Revenue", exact: true }).click()
        await page.getByText("accepted", { exact: true }).waitFor()
        const light = await capture(page)
        await page.getByRole("button", { name: "Dark theme", exact: true }).click()
        const dark = await capture(page)

        return { light, dark }
      })

      assert.deepEqual(errors, [])

      if (process.env["RITSEI_UPDATE_VISUAL_CONTRACT"] === "1") {
        yield* Effect.promise(() =>
          writeFile(baselinePath, `${JSON.stringify(observed, null, 2)}\n`),
        )
      }

      const baseline = JSON.parse(yield* Effect.promise(() => readFile(baselinePath, "utf8")))
      assert.deepEqual(observed, baseline)
    }),
  { timeout: 120_000 },
)
