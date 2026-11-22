import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"

import { normalizeRate, rateToTenThousandths, taxOn } from "../src/contract.ts"

// Amounts are generated in cents and rates in ten-thousandths of a percent, so every generated
// value is a valid amount or rate. Small values are generated on their own: rounding residues
// matter most when the exact tax is a fraction of a cent.
const cents = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: 10_000_000_000n }))
const smallCents = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: 300n }))
const rateUnits = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: 1_000_000n }))
const smallRateUnits = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: 100n }))

const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`

const rate = (units: bigint) =>
  `${units / 10_000n}.${(units % 10_000n).toString().padStart(4, "0")}`

const taxCents = (base: bigint, units: bigint) => {
  const [whole, fraction] = taxOn(money(base), rate(units)).split(".")

  return BigInt(whole!) * 100n + BigInt(fraction!)
}

describe("tax on a tax-exclusive base", () => {
  // [TAX-CALC-1]
  it.prop(
    "is the exact tax rounded half up to the cent",
    { base: cents, units: rateUnits },
    ({ base, units }) => {
      const tax = taxCents(base, units)

      // The exact tax is base · units / 10⁶ cents. Half up means it lies in [tax − ½, tax + ½).
      const scaled = 2n * base * units
      const lower = 2n * tax * 1_000_000n - 1_000_000n

      assert.isTrue(lower <= scaled && scaled < lower + 2_000_000n, `${base} cents at ${units}`)
    },
  )

  // [TAX-CALC-1]
  it.prop(
    "is the exact tax rounded half up for very small amounts and rates",
    { base: smallCents, units: smallRateUnits },
    ({ base, units }) => {
      const tax = taxCents(base, units)
      const scaled = 2n * base * units
      const lower = 2n * tax * 1_000_000n - 1_000_000n

      assert.isTrue(lower <= scaled && scaled < lower + 2_000_000n, `${base} cents at ${units}`)
    },
  )

  // [TAX-CALC-1]
  it.prop(
    "is zero for a zero base or a zero rate",
    { base: cents, units: rateUnits },
    ({ base, units }) => {
      assert.strictEqual(taxCents(0n, units), 0n)
      assert.strictEqual(taxCents(base, 0n), 0n)
    },
  )

  // [TAX-CALC-1]
  it.prop(
    "never falls when the base or the rate rises",
    { low: cents, rise: cents, units: rateUnits, more: smallRateUnits },
    ({ low, rise, units, more }) => {
      assert.isTrue(taxCents(low, units) <= taxCents(low + rise, units))
      assert.isTrue(taxCents(low, units) <= taxCents(low, units + more))
    },
  )

  // [TAX-CALC-1]
  it.prop(
    "differs from the sum of its parts by at most one cent",
    { first: cents, second: cents, units: rateUnits },
    ({ first, second, units }) => {
      const whole = taxCents(first + second, units)
      const parts = taxCents(first, units) + taxCents(second, units)

      assert.isTrue(whole - parts <= 1n && parts - whole <= 1n)
    },
  )

  // [TAX-CALC-1]
  it("rounds an exact half cent up and anything below it down", () => {
    assert.strictEqual(taxOn("0.01", "50"), "0.01")
    assert.strictEqual(taxOn("0.01", "49.9999"), "0.00")
    assert.strictEqual(taxOn("0.05", "10"), "0.01")
    assert.strictEqual(taxOn("0.04", "10"), "0.00")
    assert.strictEqual(taxOn("100.00", "11"), "11.00")
    assert.strictEqual(taxOn("33.33", "12.5"), "4.17")
  })
})

describe("tax rates", () => {
  // [TAX-RATE-1]
  it.prop(
    "normalize to four decimals without changing their value",
    { units: rateUnits },
    ({ units }) => {
      const text = rate(units)
      const short = text.replace(/\.?0+$/, "")

      assert.strictEqual(rateToTenThousandths(text), units)
      assert.strictEqual(rateToTenThousandths(short === "" ? "0" : short), units)
      assert.strictEqual(normalizeRate(short === "" ? "0" : short), text)
      assert.strictEqual(normalizeRate(text), text)
    },
  )
})
