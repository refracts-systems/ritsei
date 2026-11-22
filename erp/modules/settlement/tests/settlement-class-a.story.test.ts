import { assert, describe, it } from "@effect/vitest"
import * as Predicate from "effect/Predicate"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  BankStatement,
  ImportStatement,
  InvalidBankStatement,
  Settlement,
  StatementImported,
} from "../src/domain-model.ts"

const { Story } = Domain

const story = Story.make(Settlement)

const statement = BankStatement.ref("st-1")
const header = "date,description,reference,amount"

const file = (...rows: ReadonlyArray<string>) => [header, ...rows].join("\n")

const refuse = (content: string, row: number, reason: string) => [
  Story.when(statement, new ImportStatement({ content })),
  Story.rejected(new InvalidBankStatement({ row, reason })),
  Story.then(statement),
  Story.state(statement, (state) => assert.isTrue(Predicate.isTagged(state, "Empty"))),
]

describe("Settlement on Alchemy", () => {
  it("the model is well defined", () => assert.deepStrictEqual(Domain.verify(Settlement), []))

  // [SET-BANK-1]
  it.effect("imports a file that follows the profile as one statement with every line", () =>
    story(
      Story.when(
        statement,
        new ImportStatement({
          content: file(
            "2026-10-01,Transfer PT Pembeli,INV-1,39.2",
            "",
            '2026-10-02,"Biaya, admin ""bulanan""",,-6500',
          ),
        }),
      ),
      Story.then(
        statement,
        new StatementImported({
          lines: [
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
          ],
        }),
      ),
      Story.state(statement, (state) =>
        assert.strictEqual(Predicate.isTagged(state, "Imported") ? state.lineCount : undefined, 2),
      ),
    ),
  )

  // [SET-BANK-1]
  it.effect("rejects the whole file at its first failing row and stores nothing", () =>
    story(
      // The first line is valid; the bad third row rejects the file, so the first imports nothing.
      ...refuse(
        file("2026-10-01,Ok,,10.00", "2026-02-30,Bad,,1", "2026-10-03,Later bad,,0"),
        3,
        "date must be YYYY-MM-DD",
      ),
      // The same statement can still be imported once the file is fixed.
      Story.when(
        statement,
        new ImportStatement({ content: file("2026-10-01,Ok,,10.00", "2026-10-02,Fixed,,1") }),
      ),
      Story.then(
        statement,
        new StatementImported({
          lines: [
            {
              lineNumber: 1,
              bookingDate: "2026-10-01",
              description: "Ok",
              reference: null,
              amount: "10.00",
            },
            {
              lineNumber: 2,
              bookingDate: "2026-10-02",
              description: "Fixed",
              reference: null,
              amount: "1.00",
            },
          ],
        }),
      ),
    ),
  )

  // [SET-BANK-1]
  it.effect(
    "accepts only the one profile: header, no empty file, nonzero two-decimal amounts",
    () =>
      story(
        ...refuse(
          "date,memo,reference,amount\n2026-10-01,Ok,,1",
          1,
          "the header must be date,description,reference,amount",
        ),
        ...refuse(`${header}\n`, 1, "no statement lines"),
        ...refuse(`${header}\n2026-10-01,Ok,,0.00`, 2, "amount must not be zero"),
        ...refuse(
          `${header}\n2026-10-01,Ok,,1.005`,
          2,
          "amount must be a signed decimal with at most two decimals",
        ),
        ...refuse(
          `${header}\n2026-10-01,,,5`,
          2,
          "description is required, at most 512 characters",
        ),
      ),
  )

  // [SET-BANK-1]
  it.effect(
    "judges a file before looking for an earlier import, so a broken file is rejected",
    () =>
      story(
        Story.given(statement, new StatementImported({ lines: expectedLines(1) })),
        Story.when(statement, new ImportStatement({ content: file("2026-10-01,Line,,0") })),
        Story.rejected(new InvalidBankStatement({ row: 2, reason: "amount must not be zero" })),
        Story.when(statement, new ImportStatement({ content: file("2026-10-01,Line,,1") })),
        Story.then(statement),
      ),
  )

  // [SET-BANK-1]
  it.effect("accepts at most 5000 lines", () => {
    const lines = (count: number) =>
      file(...Array.from({ length: count }, () => "2026-10-01,Line,,1"))

    return story(
      ...refuse(lines(5001), 5002, "a statement has at most 5000 lines"),
      Story.when(statement, new ImportStatement({ content: lines(5000) })),
      Story.then(statement, new StatementImported({ lines: expectedLines(5000) })),
    )
  })
})

const expectedLines = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    lineNumber: index + 1,
    bookingDate: "2026-10-01",
    description: "Line",
    reference: null,
    amount: "1.00",
  }))
