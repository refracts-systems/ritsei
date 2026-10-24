import { AxeBuilder } from "@axe-core/playwright"
import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { builtApp, conflictBody, connectToTenant, fulfillJson, mockRoutes } from "./browser.ts"

const tenantId = "01900000-0000-7000-8000-000000000010"
const buyerId = "01900000-0000-7000-8000-000000000011"
const orderId = "01900000-0000-7000-8000-000000000020"
const requestId = "01900000-0000-7000-8000-000000000030"

const pending = {
  id: requestId,
  tenantId,
  subjectType: "procurement.purchase_order",
  subjectId: orderId,
  amount: "600.00",
  reason: "Purchase order above the approval limit",
  status: "pending",
  requestedBy: buyerId,
  decidedBy: null,
  decidedAt: null,
}

const buyer = { id: buyerId, email: "buyer@example.test", status: "active" }

it.effect(
  "lists pending requests, records a decision, and explains why a decision is refused",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      const statuses: string[] = []
      const decisions: unknown[] = []
      let decided = false
      let refuse = false

      yield* Effect.promise(async () => {
        await mockRoutes(page, {
          "GET /user-accounts": (route) => fulfillJson(route, 200, [buyer]),
          "GET /approvals/requests": (route) => {
            statuses.push(new URL(route.request().url()).searchParams.get("status") ?? "all")

            return fulfillJson(route, 200, decided ? [] : [pending])
          },
          [`POST /approvals/requests/${requestId}/decision`]: (route) => {
            decisions.push(route.request().postDataJSON())

            if (refuse) return fulfillJson(route, 409, conflictBody("SelfApprovalForbidden"))

            decided = true

            return fulfillJson(route, 200, { ...pending, status: "approved", decidedBy: buyerId })
          },
        })

        await connectToTenant(page, url, "approvals-session", tenantId, "User accounts")
        await page.getByRole("link", { name: "Approvals", exact: true }).click()
        await page.getByRole("heading", { name: "Approvals", exact: true }).waitFor()

        // Pending requests are what an approver opens first, named by e-mail address.
        await page.getByRole("link", { name: "Purchase order", exact: true }).waitFor()
        await page.getByRole("cell", { name: "buyer@example.test", exact: true }).waitFor()
        await page.getByRole("cell", { name: "600.00", exact: true }).waitFor()
        assert.include(statuses, "pending")
        assert.deepEqual(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
          [],
        )

        assert.equal(
          await page
            .getByRole("link", { name: "Purchase order", exact: true })
            .getAttribute("href"),
          `/procurement/${orderId}`,
        )

        // A refused decision says why and leaves the request in the list.
        refuse = true
        await page
          .getByRole("button", { name: "Reject Purchase order for 600.00", exact: true })
          .click()
        await page.getByText("You requested this approval yourself").waitFor()
        await page.getByRole("link", { name: "Purchase order", exact: true }).waitFor()
        assert.deepEqual(decisions, [{ decision: "reject" }])

        refuse = false
        await page
          .getByRole("button", { name: "Approve Purchase order for 600.00", exact: true })
          .click()
        await page.getByText("Nothing is waiting for a decision.").waitFor()
        assert.deepEqual(decisions, [{ decision: "reject" }, { decision: "approve" }])
      })

      assert.deepEqual(errors, [])
    }),
  { timeout: 120_000 },
)
