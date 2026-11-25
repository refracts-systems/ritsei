import { assert, describe, it } from "@effect/vitest"

import { InsightsModule, KpisInput } from "../mod.ts"
import { periodDates } from "../src/period.ts"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

describe("insights module", () => {
  it("declares a valid manifest", () => {
    assert.strictEqual(InsightsModule.name, "insights")
    assert.deepStrictEqual(InsightsModule.dependsOn, [
      "accounting",
      "billing",
      "party",
      "sales",
      "settlement",
    ])
    assert.deepStrictEqual(InsightsModule.capabilities, {})
  })

  it("finds the first and last day of a month and of the month before it", () => {
    assert.deepStrictEqual(periodDates("2026-10"), {
      from: "2026-10-01",
      to: "2026-10-31",
      previousPeriod: "2026-09",
      previousFrom: "2026-09-01",
      previousTo: "2026-09-30",
    })

    // A year boundary and a leap February.
    assert.strictEqual(periodDates("2026-01").previousPeriod, "2025-12")
    assert.strictEqual(periodDates("2026-01").previousTo, "2025-12-31")
    assert.strictEqual(periodDates("2028-03").previousTo, "2028-02-29")
    assert.strictEqual(periodDates("2027-03").previousTo, "2027-02-28")
  })

  it("accepts only a calendar month as a period", () => {
    const decode = Schema.decodeUnknownResult(KpisInput)

    const base = {
      principal: { userAccountId: "u", sessionId: "s" },
      tenantId: "00000000-0000-4000-8000-000000000001",
      legalEntityId: "00000000-0000-4000-8000-000000000002",
    }

    assert.isTrue(Result.isSuccess(decode({ ...base, period: "2026-10" })))

    for (const period of ["2026-13", "2026-00", "2026-1", "2026-10-01", "October"]) {
      assert.isTrue(Result.isFailure(decode({ ...base, period })), period)
    }
  })
})
