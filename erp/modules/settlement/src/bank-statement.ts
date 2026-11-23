import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  CalendarDate,
  formatSignedMinor,
  requireSignedMajorToMinor,
  sha256Hex,
} from "../../../../framework/foundation/mod.ts"
import { InvalidBankStatement } from "./errors.ts"

/**
 * The one bank statement profile settlement imports. The profile is SET-BANK-1 in `RULES.md`; this
 * file enforces it. Rows count records, the header being row 1.
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

/** The SHA-256 checksum of the statement text: the identity SET-BANK-2 imports a statement by. */
export const bankStatementChecksum = (content: string) =>
  sha256Hex(content).pipe(Effect.catchTag("DocumentHashFailure", Effect.die))

/**
 * The Alchemy instance key of a statement: the four values that make an import unique (SET-BANK-2).
 * None changes after the import. It is not the row id, which stays a UUIDv7.
 */
export const bankStatementInstanceKey = (identity: {
  readonly tenantId: string
  readonly legalEntityId: string
  readonly bankAccountId: string
  readonly checksum: string
}) =>
  [identity.tenantId, identity.legalEntityId, identity.bankAccountId, identity.checksum].join("/")
