import { assert, describe, it } from "@effect/vitest"

import { evaluateSeparationOfDuties } from "../mod.ts"

describe("separation of duties", () => {
  it("denies static and dynamic conflicts", () => {
    assert.deepStrictEqual(
      evaluateSeparationOfDuties({ staticResult: "conflict", dynamicResult: "clear" }),
      { allowed: false, result: "conflict", reason: "SEGREGATION_OF_DUTIES" },
    )
    assert.deepStrictEqual(
      evaluateSeparationOfDuties({ staticResult: "clear", dynamicResult: "conflict" }).allowed,
      false,
    )
  })

  it("fails closed when either owner-supplied result is unknown", () => {
    const decision = evaluateSeparationOfDuties({ staticResult: "clear", dynamicResult: "unknown" })
    assert.strictEqual(decision.allowed, false)
    assert.strictEqual(decision.result, "unknown")
  })

  it("allows only when both checks are clear", () => {
    assert.deepStrictEqual(
      evaluateSeparationOfDuties({ staticResult: "clear", dynamicResult: "clear" }),
      { allowed: true, result: "clear", reason: "SEGREGATION_OF_DUTIES_CLEAR" },
    )
  })
})
