import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"

import { committedAmount, exceedsCreditLimit, standingOf } from "../src/credit.ts"
import { discountedPrice } from "../src/documents.ts"

// Amounts are generated in cents so every value is a valid money string. Small ranges are
// generated apart from large ones because rounding residues are decided at a fraction of a cent.
const cents = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: 10_000_000_000n }))
const smallCents = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: 500n }))
const points = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: 10_000n }))

const signedCents = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: -1_000_000n, maximum: 1_000_000n }),
)

const money = (value: bigint) => {
  const magnitude = value < 0n ? -value : value

  return `${value < 0n ? "-" : ""}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, "0")}`
}

const percent = (basisPoints: bigint) =>
  `${basisPoints / 100n}.${(basisPoints % 100n).toString().padStart(2, "0")}`

const parseCents = (value: string) => {
  const negative = value.startsWith("-")
  const [whole, fraction] = value.replace(/^-/, "").split(".")
  const amount = BigInt(whole!) * 100n + BigInt(fraction!)

  return negative ? -amount : amount
}

const priceCents = (list: bigint, discount: bigint) =>
  parseCents(discountedPrice(money(list), percent(discount)))

describe("quotation discount", () => {
  // [SAL-QUOT-1]
  it.prop(
    "is the exact discounted price rounded half up to the cent",
    { list: cents, discount: points },
    ({ list, discount }) => {
      const price = priceCents(list, discount)

      // The exact price is list · (10000 − discount) / 10000 cents; half up puts it in [price − ½, price + ½).
      const scaled = 2n * list * (10_000n - discount)
      const lower = 2n * price * 10_000n - 10_000n

      assert.isTrue(lower <= scaled && scaled < lower + 20_000n, `${list} cents less ${discount}`)
    },
  )

  // [SAL-QUOT-1]
  it.prop(
    "is the exact discounted price rounded half up for very small prices",
    { list: smallCents, discount: points },
    ({ list, discount }) => {
      const price = priceCents(list, discount)
      const scaled = 2n * list * (10_000n - discount)
      const lower = 2n * price * 10_000n - 10_000n

      assert.isTrue(lower <= scaled && scaled < lower + 20_000n, `${list} cents less ${discount}`)
    },
  )

  // [SAL-QUOT-1]
  it.prop(
    "never exceeds the list price and never goes below zero",
    { list: cents, discount: points },
    ({ list, discount }) => {
      const price = priceCents(list, discount)

      assert.isTrue(price >= 0n && price <= list)
    },
  )

  // [SAL-QUOT-1]
  it.prop(
    "leaves the price whole at zero discount and free at a full discount",
    { list: cents },
    ({ list }) => {
      assert.strictEqual(priceCents(list, 0n), list)
      assert.strictEqual(priceCents(list, 10_000n), 0n)
    },
  )

  // [SAL-QUOT-1]
  it.prop(
    "never rises when the discount rises",
    { list: cents, discount: points, more: points },
    ({ list, discount, more }) => {
      const deeper = discount + more > 10_000n ? 10_000n : discount + more

      assert.isTrue(priceCents(list, deeper) <= priceCents(list, discount))
    },
  )

  // [SAL-QUOT-1]
  it("rounds an exact half cent up and anything below it down", () => {
    assert.strictEqual(discountedPrice("0.01", "50.00"), "0.01")
    assert.strictEqual(discountedPrice("0.01", "50.01"), "0.00")
    assert.strictEqual(discountedPrice("0.03", "50"), "0.02")
    assert.strictEqual(discountedPrice("100.00", "12.5"), "87.50")
    assert.strictEqual(discountedPrice("19.99", "10"), "17.99")
  })
})

describe("customer credit", () => {
  const order = { total: cents, limit: cents, receivable: signedCents, committed: cents }

  // [SAL-CREDIT-1]
  it.prop(
    "refuses an order exactly when it exceeds what the standing still has available",
    order,
    ({ total, limit, receivable, committed }) => {
      const standing = standingOf("customer", money(limit), money(receivable), money(committed))

      const exposure = {
        receivableBalance: money(receivable),
        confirmedNotInvoiced: money(committed),
      }

      assert.strictEqual(
        exceedsCreditLimit(money(limit), exposure, money(total)),
        parseCents(standing.available!) < total,
      )
    },
  )

  // [SAL-CREDIT-1]
  it("lets an order that exactly fills the limit through", () => {
    const exposure = { receivableBalance: "40.00", confirmedNotInvoiced: "10.00" }

    assert.isFalse(exceedsCreditLimit("100.00", exposure, "50.00"))
    assert.isTrue(exceedsCreditLimit("100.00", exposure, "50.01"))
    assert.isFalse(
      exceedsCreditLimit(
        "0.00",
        { receivableBalance: "0.00", confirmedNotInvoiced: "0.00" },
        "0.00",
      ),
    )
    assert.isTrue(
      exceedsCreditLimit(
        "0.00",
        { receivableBalance: "0.00", confirmedNotInvoiced: "0.00" },
        "0.01",
      ),
    )
  })

  // [SAL-CREDIT-1]
  it("leaves available empty when the customer has no limit", () => {
    assert.isNull(standingOf("customer", null, "10.00", "5.00").available)
  })

  // [SAL-CREDIT-1]
  it.prop(
    "commits what confirmed orders total less what was invoiced, never below zero",
    { totals: Schema.Array(cents).check(Schema.isMaxLength(8)), invoiced: cents },
    ({ totals, invoiced }) => {
      const sum = totals.reduce((acc, total) => acc + total, 0n)
      const expected = sum > invoiced ? sum - invoiced : 0n

      assert.strictEqual(parseCents(committedAmount(totals.map(money), money(invoiced))), expected)
    },
  )

  // [SAL-CREDIT-1]
  it("commits nothing when invoicing has overtaken the confirmed orders", () => {
    assert.strictEqual(committedAmount(["10.00"], "25.00"), "0.00")
    assert.strictEqual(committedAmount([], "0.00"), "0.00")
    assert.strictEqual(committedAmount(["10.00", "5.50"], "3.25"), "12.25")
  })
})
