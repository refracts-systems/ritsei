import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import { InvalidWithholding } from "../mod.ts"
import { checkWithholding, paymentLines } from "../src/service.ts"

const cents = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 10_000_000_000n }))
const smallCents = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 20n }))

const allocatedCents = Schema.Array(
  Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: 10_000_000_000n })),
).check(Schema.isMaxLength(4))

const smallAllocatedCents = Schema.Array(
  Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: 20n })),
).check(Schema.isMaxLength(4))

const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`

const parse = (value: string) => {
  const [whole = "0", fraction = ""] = value.split(".")

  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))
}

const accountId = "00000000-0000-4000-8000-0000000000a1"
const withholdingAccountId = "00000000-0000-4000-8000-0000000000a2"
const tenantId = "00000000-0000-4000-8000-000000000001"
const invoiceId = "00000000-0000-4000-8000-0000000000b1"

const totals = (lines: ReadonlyArray<{ readonly debit: string; readonly credit: string }>) => ({
  debit: lines.reduce((sum, line) => sum + parse(line.debit), 0n),
  credit: lines.reduce((sum, line) => sum + parse(line.credit), 0n),
})

const receipt = (amount: bigint, withheld: bigint | undefined) => {
  const base = { amount: money(amount), cashAccountId: accountId }

  if (withheld === undefined) return base

  return {
    ...base,
    withholding: {
      amount: money(withheld),
      certificateReference: "WHT-1",
      accountId: withholdingAccountId,
    },
  }
}

describe("payment journal lines", () => {
  // [SET-WHT-1]
  it.prop(
    "balance for a receipt, with cash taking the amount less what was withheld",
    { amount: cents, withheld: cents },
    ({ amount, withheld }) => {
      const kept = withheld % amount
      const lines = paymentLines("incoming", receipt(amount, kept === 0n ? undefined : kept))
      const sum = totals(lines)

      assert.strictEqual(sum.debit, sum.credit)
      assert.strictEqual(sum.credit, amount)
      assert.strictEqual(parse(lines[0]!.debit), amount - kept)
    },
  )

  // [SET-WHT-1]
  it.prop(
    "balance for a receipt of very small amounts",
    { amount: smallCents, withheld: smallCents },
    ({ amount, withheld }) => {
      const kept = withheld % amount
      const sum = totals(paymentLines("incoming", receipt(amount, kept === 0n ? undefined : kept)))

      assert.strictEqual(sum.debit, sum.credit)
    },
  )

  // [SET-WHT-1]
  it.prop(
    "debit the claim account with exactly the withheld amount",
    { amount: cents, withheld: cents },
    ({ amount, withheld }) => {
      const kept = (withheld % (amount - 1n || 1n)) + 1n

      if (kept >= amount) return

      const claim = paymentLines("incoming", receipt(amount, kept)).filter(
        (line) => "accountId" in line && line.accountId === withholdingAccountId,
      )

      assert.strictEqual(claim.length, 1)
      assert.strictEqual(parse(claim[0]!.debit), kept)
    },
  )

  // [SET-WHT-1]
  it.prop("balance for a payment, with no withholding", { amount: cents }, ({ amount }) => {
    const sum = totals(paymentLines("outgoing", receipt(amount, undefined)))

    assert.strictEqual(sum.debit, amount)
    assert.strictEqual(sum.credit, amount)
  })

  // [SET-WHT-1]
  it("splits a worked receipt into cash, claim and receivable", () => {
    assert.deepStrictEqual(paymentLines("incoming", receipt(10_000n, 220n)), [
      { accountId, debit: "97.80", credit: "0" },
      { accountId: withholdingAccountId, debit: "2.20", credit: "0" },
      { role: "receivable", debit: "0", credit: "100.00" },
    ])
  })
})

describe("withholding check", () => {
  const verdict = (amount: bigint, withheld: bigint, allocated: ReadonlyArray<bigint>) =>
    checkWithholding({
      tenantId,
      ...receipt(amount, withheld),
      allocations: allocated.map((part) => ({ invoiceId, amount: money(part) })),
    }).pipe(
      Effect.result,
      Effect.map((result) => {
        if (Result.isSuccess(result)) return "accepted" as const

        assert.instanceOf(result.failure, InvalidWithholding)

        return result.failure.reason
      }),
    )

  const expected = (amount: bigint, withheld: bigint, allocated: ReadonlyArray<bigint>) => {
    if (withheld >= amount) return "not_below_payment"

    return withheld > allocated.reduce((sum, part) => sum + part, 0n) ? "not_allocated" : "accepted"
  }

  // [SET-WHT-1]
  it.effect.prop(
    "accepts a withholding exactly when it is below the amount and allocated",
    { amount: cents, withheld: cents, allocated: allocatedCents },
    ({ amount, withheld, allocated }) =>
      Effect.gen(function* () {
        assert.strictEqual(
          yield* verdict(amount, withheld, allocated),
          expected(amount, withheld, allocated),
        )
      }),
  )

  // [SET-WHT-1]
  it.effect.prop(
    "accepts a withholding exactly when it is below the amount and allocated, for very small amounts",
    { amount: smallCents, withheld: smallCents, allocated: smallAllocatedCents },
    ({ amount, withheld, allocated }) =>
      Effect.gen(function* () {
        assert.strictEqual(
          yield* verdict(amount, withheld, allocated),
          expected(amount, withheld, allocated),
        )
      }),
  )

  // [SET-WHT-1]
  it.effect("refuses a withholding equal to the amount before it looks at allocation", () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* verdict(1_000n, 1_000n, [1_000n]), "not_below_payment")
      assert.strictEqual(yield* verdict(1_000n, 999n, [998n]), "not_allocated")
      assert.strictEqual(yield* verdict(1_000n, 999n, [500n, 499n]), "accepted")
    }),
  )
})
