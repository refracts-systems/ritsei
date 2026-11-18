import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { InvalidBankStatement, parseBankStatement } from "../mod.ts"

const header = "date,description,reference,amount"

const rejection = (content: string) =>
  Effect.flip(parseBankStatement(content)).pipe(
    Effect.map((error) => {
      assert.instanceOf(error, InvalidBankStatement)

      return [error.row, error.reason] as const
    }),
  )

describe("bank statement profile", () => {
  it.effect("parses signed exact amounts, quoted fields, and a byte order mark", () =>
    Effect.gen(function* () {
      const lines = yield* parseBankStatement(
        [
          `${String.fromCharCode(0xfeff)}${header}`,
          "2026-10-01,Transfer PT Pembeli,INV-1,39.2",
          '2026-10-02,"Biaya, admin ""bulanan""",,-6500',
          "",
          "2026-10-03,Setoran,  ,1250000.50",
          "",
        ].join("\r\n"),
      )

      assert.deepStrictEqual(lines, [
        {
          lineNumber: 1,
          bookingDate: "2026-10-01",
          description: "Transfer PT Pembeli",
          reference: "INV-1",
          amount: "39.20",
        },
        {
          lineNumber: 2,
          bookingDate: "2026-10-02",
          description: 'Biaya, admin "bulanan"',
          reference: null,
          amount: "-6500.00",
        },
        {
          lineNumber: 3,
          bookingDate: "2026-10-03",
          description: "Setoran",
          reference: null,
          amount: "1250000.50",
        },
      ])
    }),
  )

  it.effect("rejects the whole file at the first row that breaks the profile", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* rejection("date,memo,reference,amount\n"), [
        1,
        "the header must be date,description,reference,amount",
      ])
      assert.deepStrictEqual(yield* rejection(`${header}\n`), [1, "no statement lines"])

      assert.deepStrictEqual(
        yield* rejection(`${header}\n2026-10-01,Ok,,10.00\n2026-02-30,Bad,,1`),
        [3, "date must be YYYY-MM-DD"],
      )

      assert.deepStrictEqual(yield* rejection(`${header}\n2026-10-01,Ok,,1.005`), [
        2,
        "amount must be a signed decimal with at most two decimals",
      ])

      assert.deepStrictEqual(yield* rejection(`${header}\n2026-10-01,Ok,,1.000,extra`), [
        2,
        "expected 4 fields",
      ])
      assert.deepStrictEqual(yield* rejection(`${header}\n2026-10-01,Ok,,0.00`), [
        2,
        "amount must not be zero",
      ])
      assert.deepStrictEqual(yield* rejection(`${header}\n2026-10-01,,,5`), [
        2,
        "description is required, at most 512 characters",
      ])
      assert.deepStrictEqual(yield* rejection(`${header}\n2026-10-01,"open,,5`), [
        2,
        "quotes must wrap whole fields and be closed",
      ])

      // A long unterminated quote is rejected without catastrophic backtracking.
      assert.deepStrictEqual(yield* rejection(`${header}\n2026-10-01,"${"a,".repeat(200_000)}`), [
        2,
        "quotes must wrap whole fields and be closed",
      ])
      assert.deepStrictEqual(yield* rejection(`${header}\n2026-10-01,"a"b,,5`), [
        2,
        "quotes must wrap whole fields and be closed",
      ])
    }),
  )
})
