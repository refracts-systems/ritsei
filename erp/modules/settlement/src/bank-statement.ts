import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  CalendarDate,
  formatSignedMinor,
  requireSignedMajorToMinor,
} from "../../../../framework/foundation/mod.ts"
import { InvalidBankStatement } from "./errors.ts"

/**
 * The one bank statement profile settlement imports (ADR-0116): UTF-8 CSV with a header row of
 * exactly `date,description,reference,amount`. Fields follow RFC 4180 quoting. `date` is an ISO
 * calendar date. `amount` is a signed decimal with a dot and at most two decimals, no thousands
 * separators: positive is money in, negative is money out, zero is rejected. `description` is
 * required; `reference` may be empty. Blank lines are ignored. Any other deviation rejects the
 * whole file with the row that broke the profile; rows count records, the header being row 1.
 */
export const bankStatementHeader = ["date", "description", "reference", "amount"] as const

const maxBankStatementLines = 5000

const byteOrderMark = String.fromCharCode(0xfeff)

export type ParsedBankLine = {
  readonly lineNumber: number
  readonly bookingDate: string
  readonly description: string
  readonly reference: string | null
  readonly amount: string
}

// One field and what ends it. The quoted form is unrolled so that failing to match is linear.
const token = /("[^"]*(?:""[^"]*)*"|[^",\r\n]*)(,|\r\n|\n|\r|$)/y
const amountPattern = /^-?\d{1,18}(\.\d{1,2})?$/

const unquote = (raw: string) =>
  raw.startsWith('"') ? raw.slice(1, -1).replaceAll('""', '"') : raw

/** Splits CSV text into records of fields, or fails at the record with a misplaced quote. */
const tokenize = (content: string) =>
  Effect.gen(function* () {
    const records: string[][] = []
    let fields: string[] = []
    let position = 0

    for (;;) {
      token.lastIndex = position
      const match = token.exec(content)

      if (match === null) {
        return yield* Effect.fail(
          new InvalidBankStatement({
            row: records.length + 1,
            reason: "quotes must wrap whole fields and be closed",
          }),
        )
      }

      const [whole, raw = "", delimiter = ""] = match
      fields.push(unquote(raw))
      position += whole.length

      if (delimiter !== ",") {
        // A line with no characters at all is a blank line, not a record.
        if (fields.length > 1 || fields[0] !== "") records.push(fields)
        fields = []

        if (delimiter === "") return records
      }
    }
  })

const parseRow = (fields: ReadonlyArray<string>, lineNumber: number) =>
  Effect.gen(function* () {
    // The header is row 1, so the first statement line is row 2.
    const reject = (reason: string) =>
      Effect.fail(new InvalidBankStatement({ row: lineNumber + 1, reason }))

    if (fields.length !== bankStatementHeader.length)
      return yield* reject(`expected ${bankStatementHeader.length} fields`)

    const [date = "", description = "", reference = "", amount = ""] = fields.map((field) =>
      field.trim(),
    )

    if (!Schema.is(CalendarDate)(date)) return yield* reject("date must be YYYY-MM-DD")

    if (description === "" || description.length > 512)
      return yield* reject("description is required, at most 512 characters")

    if (reference.length > 128) return yield* reject("reference is at most 128 characters")

    if (!amountPattern.test(amount))
      return yield* reject("amount must be a signed decimal with at most two decimals")

    const minor = requireSignedMajorToMinor(amount, 2)

    if (minor === 0n) return yield* reject("amount must not be zero")

    return {
      lineNumber,
      bookingDate: date,
      description,
      reference: reference === "" ? null : reference,
      amount: formatSignedMinor(minor, 2),
    } satisfies ParsedBankLine
  })

/** Parses statement text into lines, or fails with the first row that breaks the profile. */
export const parseBankStatement = (content: string) =>
  Effect.gen(function* () {
    const [header = [], ...rows] = yield* tokenize(
      content.startsWith(byteOrderMark) ? content.slice(1) : content,
    )

    const reject = (row: number, reason: string) =>
      Effect.fail(new InvalidBankStatement({ row, reason }))

    if (
      header.length !== bankStatementHeader.length ||
      header.some((name, index) => name.trim() !== bankStatementHeader[index])
    )
      return yield* reject(1, `the header must be ${bankStatementHeader.join(",")}`)

    if (rows.length === 0) return yield* reject(1, "no statement lines")

    if (rows.length > maxBankStatementLines)
      return yield* reject(
        maxBankStatementLines + 2,
        `a statement has at most ${maxBankStatementLines} lines`,
      )

    return yield* Effect.forEach(rows, (fields, index) => parseRow(fields, index + 1))
  })
