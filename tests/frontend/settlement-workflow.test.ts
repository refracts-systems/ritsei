import { AxeBuilder } from "@axe-core/playwright"
import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { Page, Route } from "playwright"
import { builtApp, connectToTenant, forbiddenBody, conflictBody } from "./browser.ts"

const tenantId = "01900000-0000-7000-8000-000000000010"
const legalEntityId = "01900000-0000-7000-8000-000000000020"
const partyId = "01900000-0000-7000-8000-000000000021"
const orgId = "01900000-0000-7000-8000-000000000023"
const invoiceId = "01900000-0000-7000-8000-000000000030"
const paymentId = "01900000-0000-7000-8000-000000000060"
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

const directory = [
  {
    party: { id: partyId, tenantId, kind: "organization", name: "PT Pembeli" },
    legalEntityId: null,
  },
  {
    party: { id: orgId, tenantId, kind: "organization", name: "PT Demo Trading" },
    legalEntityId,
  },
]

const payment = {
  id: paymentId,
  tenantId,
  legalEntityId,
  direction: "incoming",
  partyId,
  number: "RCV/2026/00001",
  paymentDate: "2026-10-25",
  amount: "100.00",
  unallocatedAmount: "0.00",
  cashAccountId: null,
  journalEntryId,
  allocations: [{ invoiceId, amount: "100.00" }],
}

const buckets = {
  current: "15.44",
  days1To30: "0.00",
  days31To60: "0.00",
  days61To90: "0.00",
  over90: "0.00",
  unapplied: "0.00",
  total: "15.44",
}

const aging = {
  legalEntityId,
  side: "receivable",
  asOf: "2026-10-31",
  rows: [{ partyId, ...buckets }],
  totals: buckets,
}

const statement = {
  legalEntityId,
  partyId,
  from: "2026-10-01",
  to: "2026-10-31",
  openingBalance: "0.00",
  entries: [
    {
      date: "2026-10-06",
      kind: "invoice",
      documentId: invoiceId,
      number: "INV/2026/00001",
      amount: "115.44",
      balance: "115.44",
    },
    {
      date: "2026-10-25",
      kind: "payment",
      documentId: paymentId,
      number: "RCV/2026/00001",
      amount: "-100.00",
      balance: "15.44",
    },
  ],
  closingBalance: "15.44",
}

const fulfillJson = <Body>(route: Route, status: number, body: Body) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })

const openPayments = async (page: Page, url: string) => {
  await connectToTenant(page, url, "settlement-session", tenantId, "User accounts")
  await page.getByRole("link", { name: "Payments", exact: true }).click()
  await page.getByRole("heading", { name: "Payments", exact: true }).waitFor({ timeout: 5_000 })
}

const mockSettlement = async (
  page: Page,
  options: { readonly payments: unknown[]; readonly denied?: boolean },
) => {
  await page.route("**/api/**", (route) => {
    const requestUrl = new URL(route.request().url())
    const path = requestUrl.pathname.replace(/^\/api/, "")

    if (path === "/user-accounts") return fulfillJson(route, 200, [])

    if (path === "/parties") return fulfillJson(route, 200, directory)

    if (path === "/accounting/configurations") return fulfillJson(route, 200, [configuration])

    if (path === "/billing/documents") {
      return fulfillJson(route, 200, [{ id: invoiceId, number: "INV/2026/00001", partyId }])
    }

    if (path === "/settlement/payments") {
      return options.denied === true
        ? fulfillJson(route, 403, forbiddenBody())
        : fulfillJson(route, 200, options.payments)
    }

    if (path === "/settlement/aging") return fulfillJson(route, 200, aging)

    if (path === "/settlement/statements") return fulfillJson(route, 200, statement)

    return fulfillJson(route, 404, { code: "unexpected_test_request" })
  })
  await page.route("**/api/accounting/accounts**", (route) => fulfillJson(route, 200, []))
}

it.effect(
  "shows the payment register, its allocations, aging, and a customer statement",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp

      yield* Effect.promise(async () => {
        await mockSettlement(page, { payments: [payment] })
        await openPayments(page, url)

        await page.getByRole("link", { name: "RCV/2026/00001", exact: true }).waitFor()
        await page.getByText("Allocated", { exact: true }).first().waitFor()
        await page.getByRole("columnheader", { name: "Total" }).waitFor()
        await page.getByText("PT Pembeli", { exact: true }).first().waitFor()

        // Every register column keeps room for its content.
        const cells = page.locator("table").first().locator("tbody tr").first().locator("th, td")

        for (let index = 0; index < (await cells.count()); index += 1) {
          const box = await cells.nth(index).boundingBox()
          assert.isAbove(box?.width ?? 0, 48, `column ${index + 1} is too narrow`)
          assert.isBelow(box?.height ?? 999, 80, `column ${index + 1} wraps onto too many lines`)
        }

        await page.getByRole("link", { name: "RCV/2026/00001", exact: true }).click()
        await page.getByRole("heading", { name: "Payment RCV/2026/00001" }).waitFor()
        await page.getByRole("link", { name: "INV/2026/00001", exact: true }).waitFor()
        assert.equal(new URL(page.url()).pathname, `/settlement/${paymentId}`)
        assert.deepEqual(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
          [],
        )

        await page.getByRole("combobox", { name: "Customer", exact: true }).selectOption(partyId)
        await page.getByRole("button", { name: "Show statement", exact: true }).click()
        await page.getByRole("cell", { name: "INV/2026/00001", exact: true }).waitFor()
        await page.getByRole("row", { name: /Closing balance/ }).waitFor()
        assert.equal(new URL(page.url()).searchParams.get("statementPartyId"), partyId)
      })

      assert.deepEqual(errors, [])
    }),
  { timeout: 120_000 },
)

it.effect(
  "explains an empty register and a denied read",
  () =>
    Effect.gen(function* () {
      const empty = yield* builtApp

      yield* Effect.promise(async () => {
        await mockSettlement(empty.page, { payments: [] })
        await openPayments(empty.page, empty.url)
        await empty.page.getByText("No payments received in this legal entity yet.").waitFor()
        await empty.page.getByRole("link", { name: "Billing", exact: true }).first().waitFor()
      })

      const denied = yield* builtApp

      yield* Effect.promise(async () => {
        await mockSettlement(denied.page, { payments: [], denied: true })
        await openPayments(denied.page, denied.url)
        const alert = denied.page.getByRole("alert").first()
        await alert.waitFor()
        assert.include(await alert.innerText(), "permission")
      })
    }),
  { timeout: 180_000 },
)

it.effect(
  "imports a statement, matches payment cash, and reverses the match",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      const bankId = "01900000-0000-7000-8000-000000000081"
      const lineId = "01900000-0000-7000-8000-000000000082"
      const matchId = "01900000-0000-7000-8000-000000000083"
      let imported = false
      let matched = false
      let attempts = 0
      let matchBody: unknown

      const line = {
        id: lineId,
        statementId: matchId,
        sourceName: "bank.csv",
        lineNumber: 1,
        reference: null,
        bookingDate: "2026-10-25",
        description: "Customer transfer",
        amount: "100.00",
        unmatchedAmount: "100.00",
      }

      const unmatched = {
        id: paymentId,
        number: payment.number,
        direction: "incoming",
        paymentDate: payment.paymentDate,
        unmatchedCash: "100.00",
      }

      yield* Effect.promise(async () => {
        await mockSettlement(page, { payments: [payment] })
        await page.route("**/api/accounting/accounts**", (route) =>
          fulfillJson(route, 200, [
            { id: bankId, tenantId, code: "1101", name: "Bank", type: "asset" },
          ]),
        )
        await page.route("**/api/settlement/bank-reconciliation**", (route) =>
          fulfillJson(route, 200, {
            legalEntityId,
            bankAccountId: bankId,
            lines: imported && !matched ? [line] : [],
            payments: matched ? [] : [unmatched],
            matches: matched
              ? [
                  {
                    id: matchId,
                    lineId,
                    statementId: matchId,
                    paymentId,
                    paymentNumber: payment.number,
                    bookingDate: line.bookingDate,
                    description: line.description,
                    sourceName: line.sourceName,
                    lineNumber: line.lineNumber,
                    reference: line.reference,
                    amount: "100.00",
                  },
                ]
              : [],
          }),
        )
        await page.route("**/api/settlement/bank-statements", (route) => {
          attempts += 1

          if (attempts === 1) return fulfillJson(route, 409, conflictBody("invalid_request"))
          imported = true

          return fulfillJson(route, 201, {
            id: matchId,
            legalEntityId,
            bankAccountId: bankId,
            lineCount: 1,
          })
        })
        await page.route("**/api/settlement/bank-matches", (route) => {
          matchBody = route.request().postDataJSON()
          matched = true

          return fulfillJson(route, 201, {
            id: matchId,
            lineId,
            paymentId,
            amount: "100.00",
            reversed: false,
          })
        })
        await page.route(`**/api/settlement/bank-matches/${matchId}/reversal`, (route) => {
          matched = false

          return fulfillJson(route, 200, {
            id: matchId,
            lineId,
            paymentId,
            amount: "100.00",
            reversed: true,
          })
        })
        await openPayments(page, url)
        await page.setViewportSize({ width: 640, height: 720 })
        const account = page.getByRole("combobox", { name: "Reconciliation account" })
        await account.focus()
        await page.keyboard.press("ArrowDown")
        await page.keyboard.press("Enter")
        assert.equal(await account.inputValue(), bankId)
        await page.getByText("No unmatched statement lines.").waitFor()
        await page.getByLabel("Bank statement CSV").setInputFiles({
          name: "bank.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(
            "date,description,reference,amount\n2026-10-25,Customer transfer,,100.00",
          ),
        })
        await page.getByRole("button", { name: "Import statement" }).click()
        await page
          .getByText(
            "The change conflicts with existing data or invalid input. Review the fields and try again.",
          )
          .waitFor()
        await page.getByRole("button", { name: "Import statement" }).click()
        await page.getByText(/Customer transfer · No reference · 100.00 · Remaining/).waitFor()
        await page.getByRole("combobox", { name: "Statement line" }).selectOption(lineId)
        await page.getByRole("combobox", { name: "Payment", exact: true }).selectOption(paymentId)
        await page.getByRole("textbox", { name: "Match amount" }).fill("100.00")
        assert.deepEqual(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
          [],
        )
        await page.getByRole("button", { name: "Match", exact: true }).click()
        await page.getByRole("button", { name: "Reverse match" }).waitFor()
        assert.deepEqual(matchBody, { lineId, paymentId, amount: "100.00" })
        await page.getByRole("button", { name: "Reverse match" }).click()
        await page.getByText(/Customer transfer · No reference · 100.00 · Remaining/).waitFor()
      })
      assert.deepEqual(errors, [])
    }),
  { timeout: 120_000 },
)
