import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"

import { LineValue, valueIssue } from "../src/valuation.ts"

const unitsOf = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))

const minorValue = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 0n, maximum: 10_000_000n }),
)

const chunks = Schema.Array(unitsOf).check(Schema.isMinLength(1), Schema.isMaxLength(30))

type Stock = { readonly quantity: bigint; readonly value: bigint }

const issue = (quantity: bigint, onHand: bigint, valuation: Stock) =>
  valueIssue({ itemId: "item", quantity: -quantity }, { onHand, reserved: 0n }, valuation)

/** The outcome of an issue: its positive cost, or why it was refused. */
const outcome = (quantity: bigint, onHand: bigint, valuation: Stock) =>
  LineValue.$match(issue(quantity, onHand, valuation), {
    Valued: ({ line }) => `cost ${-line.value}`,
    Unavailable: () => "Unavailable",
    Unvalued: () => "Unvalued",
  })

/** The positive cost of an issue that must be valued. */
const costOf = (quantity: bigint, onHand: bigint, valuation: Stock) => {
  const result = issue(quantity, onHand, valuation)

  assert.isTrue(LineValue.$is("Valued")(result), `issue of ${quantity} was refused`)

  return LineValue.$is("Valued")(result) ? -result.line.value : 0n
}

describe("moving-average issue valuation", () => {
  // [INV-VAL-1]
  it.prop(
    "draining an item in any sequence of issues removes exactly its value, never more",
    { quantity: unitsOf, value: minorValue, splits: chunks },
    ({ quantity, value, splits }) => {
      let remaining: Stock = { quantity: BigInt(quantity), value }
      let removed = 0n

      // Issue the given chunks while stock lasts, then whatever is left.
      for (const chunk of [...splits.map(BigInt), remaining.quantity]) {
        const units = chunk < remaining.quantity ? chunk : remaining.quantity

        if (units === 0n) break

        const cost = costOf(units, remaining.quantity, remaining)

        assert.isTrue(cost >= 0n && cost <= remaining.value)
        removed += cost
        remaining = { quantity: remaining.quantity - units, value: remaining.value - cost }
      }

      assert.strictEqual(remaining.quantity, 0n)
      assert.strictEqual(remaining.value, 0n)
      assert.strictEqual(removed, value)
    },
  )

  // [INV-VAL-1]
  it.prop(
    "a partial issue costs the average share rounded half up to the cent",
    { quantity: unitsOf, value: minorValue, issued: unitsOf },
    ({ quantity, value, issued }) => {
      const total = BigInt(quantity) + 1n
      const units = BigInt(issued) % total || 1n
      const cost = costOf(units, total, { quantity: total, value })

      // Half up: the exact share units·V/Q lies in (cost − ½, cost + ½] cents.
      const error = 2n * cost * total - 2n * value * units

      assert.isTrue(
        -total < error && error <= total,
        `cost ${cost} for ${units}/${total} of ${value}`,
      )
    },
  )

  // [INV-VAL-3]
  it.prop(
    "more than the valued quantity is unvalued, and more than the available stock is unavailable",
    { quantity: unitsOf, value: minorValue, extra: unitsOf },
    ({ quantity, value, extra }) => {
      const valued = BigInt(quantity)
      const units = valued + BigInt(extra)

      assert.strictEqual(outcome(units, units, { quantity: valued, value }), "Unvalued")
      assert.strictEqual(outcome(units, valued, { quantity: valued, value }), "Unavailable")
    },
  )

  // [INV-VAL-1]
  it("issues ten of twenty-eight units valued at 224.00 for 80.00", () => {
    assert.strictEqual(outcome(10n, 28n, { quantity: 28n, value: 22_400n }), "cost 8000")
  })
})
