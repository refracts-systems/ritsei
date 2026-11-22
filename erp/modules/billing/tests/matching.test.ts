import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"

import { creditShare, matchBill } from "../src/matching.ts"

const lineId = "01900000-0000-7000-8000-000000000001"
const count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 200 }))
const positive = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))
const cents = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100_000 }))

const cash = (minor: bigint) => `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`

/** One order line with the given receipt history, matched against one requested bill line. */
const matchOne = (input: {
  readonly received: number
  readonly returned: number
  readonly billed: number
  readonly credited: number
  readonly requested: number
  readonly orderPrice: number
  readonly billPrice: number
}) => {
  const match = matchBill(
    [
      {
        purchaseOrderLineId: lineId,
        quantity: String(input.requested),
        unitPrice: cash(BigInt(input.billPrice)),
      },
    ],
    [
      {
        purchaseOrderLineId: lineId,
        productId: lineId,
        ordered: String(input.received),
        received: String(input.received),
        returned: String(input.returned),
        unitPrice: cash(BigInt(input.orderPrice)),
        taxCodeId: null,
      },
    ],
    new Map([[lineId, BigInt(input.billed)]]),
    new Map([[lineId, BigInt(input.credited)]]),
  )

  if ("unknownLineId" in match) throw new Error("the line is on the order")

  const matchedValue = match.matched[0]!.matchedValue

  return {
    matched: matchedValue / BigInt(input.orderPrice),
    matchedValue,
    excessValue: match.excessValue,
  }
}

/** A receipt history where returns never exceed receipts and credits never exceed bills. */
const history = {
  received: count,
  returned: count,
  billed: count,
  credited: count,
  requested: positive,
  orderPrice: cents,
  billPrice: cents,
}

const consistent = <
  A extends { received: number; returned: number; billed: number; credited: number },
>(
  input: A,
): A => ({
  ...input,
  returned: Math.min(input.returned, input.received),
  credited: Math.min(input.credited, input.billed),
})

describe("three-way match", () => {
  // [BIL-BILL-1]
  it.prop(
    "matches no more than requested or billable, and values the rest as excess at the bill price",
    history,
    (generated) => {
      const input = consistent(generated)
      const billable = input.received - input.returned - (input.billed - input.credited)
      const { matched, matchedValue, excessValue } = matchOne(input)

      assert.isTrue(matched >= 0n && matched <= BigInt(input.requested))
      assert.isTrue(matched <= BigInt(Math.max(billable, 0)))
      assert.strictEqual(matchedValue, matched * BigInt(input.orderPrice))
      assert.strictEqual(excessValue, (BigInt(input.requested) - matched) * BigInt(input.billPrice))
    },
  )

  // [BIL-BILL-1]
  it.prop(
    "crediting k more billed units lets at most k more units match, never fewer",
    { ...history, k: count },
    (generated) => {
      const input = consistent(generated)
      const k = Math.min(generated.k, input.billed - input.credited)
      const before = matchOne(input).matched
      const after = matchOne({ ...input, credited: input.credited + k }).matched

      assert.isTrue(after >= before && after <= before + BigInt(k))
    },
  )

  // [BIL-BILL-1]
  it("bills 55 of 60 when 5 were returned and nothing was billed, as the procure-to-pay chain does", () => {
    const { matched } = matchOne({
      received: 60,
      returned: 5,
      billed: 0,
      credited: 0,
      requested: 60,
      orderPrice: 600,
      billPrice: 620,
    })

    assert.strictEqual(matched, 55n)
  })
})

describe("credit note share of a bill line's matched value", () => {
  const lineOf = (quantity: number, matchedValue: bigint) => ({
    id: lineId,
    productId: null,
    description: "line",
    quantity: String(quantity),
    unitPrice: "0.00",
    netAmount: "0.00",
    taxCodeId: null,
    taxAmount: "0.00",
    sourceLineId: null,
    matchedValue: cash(matchedValue),
  })

  const returnedBySplit = (quantity: number, matched: bigint, splits: ReadonlyArray<number>) => {
    const line = lineOf(quantity, matched)
    const shares: Array<bigint> = []
    let credited = 0n
    let returned = 0n

    for (const split of [...splits.map(BigInt), BigInt(quantity)]) {
      const left = BigInt(quantity) - credited
      const units = split < left ? split : left

      if (units === 0n) break

      const share = creditShare(
        line,
        units,
        new Map([[lineId, credited]]),
        new Map([[lineId, returned]]),
      )

      shares.push(share)
      credited += units
      returned += share
    }

    return { shares, credited, returned }
  }

  const splitsOf = Schema.Array(positive).check(Schema.isMinLength(1), Schema.isMaxLength(30))

  // [BIL-CREDIT-1]
  it.prop(
    "credits that use up a line in any split return exactly its matched value, none negative",
    {
      quantity: positive,
      matched: Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: 10_000_000n })),
      splits: splitsOf,
    },
    ({ quantity, matched, splits }) => {
      const { shares, credited, returned } = returnedBySplit(quantity, matched, splits)

      assert.isTrue(shares.every((share) => share >= 0n))
      assert.strictEqual(credited, BigInt(quantity))
      assert.strictEqual(returned, matched)
    },
  )

  // [BIL-CREDIT-1]
  it.prop(
    "the same holds for a few cents over a few units credited in small steps, where rounding matters most",
    {
      quantity: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
      matchedCents: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 12 })),
      splits: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3 }))).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(12),
      ),
    },
    ({ quantity, matchedCents, splits }) => {
      const { shares, returned } = returnedBySplit(quantity, BigInt(matchedCents), splits)

      assert.isTrue(shares.every((share) => share >= 0n))
      assert.strictEqual(returned, BigInt(matchedCents))
    },
  )

  // [BIL-CREDIT-1]
  it("credits 0.02 over four units one at a time as 0.01, 0.00, 0.01, 0.00, never negative", () => {
    assert.deepStrictEqual(returnedBySplit(4, 2n, [1, 1, 1, 1]).shares, [1n, 0n, 1n, 0n])
  })
})
