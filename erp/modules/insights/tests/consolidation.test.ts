import { assert, describe, it } from "@effect/vitest"

import { consolidate, translateAmount } from "../src/consolidation.ts"

describe("consolidation", () => {
  it("translates exactly and rounds half away from zero to the cent", () => {
    assert.strictEqual(translateAmount("100.00", "1"), "100.00")
    assert.strictEqual(translateAmount("100.00", "0.0000645"), "0.01")
    assert.strictEqual(translateAmount("100.00", "0.0000644999"), "0.01")
    assert.strictEqual(translateAmount("100.00", "0.0000494999"), "0.00")
    assert.strictEqual(translateAmount("0.05", "0.1"), "0.01")
    assert.strictEqual(translateAmount("1000000.00", "0.0000645"), "64.50")
    assert.strictEqual(translateAmount("-0.05", "0.1"), "-0.01")
    assert.strictEqual(translateAmount("-250.00", "1.5"), "-375.00")
    assert.strictEqual(
      translateAmount("12345678901234.56", "16000.1234567891"),
      "197532386577629366.03",
    )
  })

  it("totals translated figures and says which totals leave an entity out", () => {
    const result = consolidate(
      [
        {
          legalEntityId: "a",
          currency: "IDR",
          rate: "1",
          figures: { cash: "100.00", sales: "10.00" },
        },
        {
          legalEntityId: "b",
          currency: "USD",
          rate: "0.5",
          figures: { cash: "50.00", sales: null },
        },
        // No rate: nothing of this entity can be translated.
        {
          legalEntityId: "c",
          currency: "EUR",
          rate: null,
          figures: { cash: "9.00", sales: "9.00" },
        },
      ],
      ["cash", "sales"],
    )

    assert.deepStrictEqual(result.totals, { cash: "125.00", sales: "10.00" })
    assert.deepStrictEqual(result.complete, { cash: false, sales: false })
    assert.strictEqual(result.entities[1]!.translated["cash"], "25.00")
    assert.strictEqual(result.entities[1]!.translated["sales"], null)
    assert.strictEqual(result.entities[2]!.translated["cash"], null)

    const whole = consolidate(
      [
        { legalEntityId: "a", currency: "IDR", rate: "1", figures: { cash: "-0.50" } },
        { legalEntityId: "b", currency: "USD", rate: "2", figures: { cash: "-0.25" } },
      ],
      ["cash"],
    )

    assert.deepStrictEqual(whole.totals, { cash: "-1.00" })
    assert.deepStrictEqual(whole.complete, { cash: true })
  })
})
