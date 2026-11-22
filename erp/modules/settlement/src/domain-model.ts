/**
 * The Alchemy model of Settlement's class A rule (ADR-0124, phase 1). It runs on the in-memory host
 * in stories only: production keeps its tables and never loads this file, so it is not exported from
 * `mod.ts`. `ImportStatement` decides with `parseBankStatement`, the function `importBankStatement`
 * calls, so the model and the service cannot disagree about which files the profile accepts.
 */
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import { parseBankStatement } from "./bank-statement.ts"

export const StatementId = Schema.String.pipe(Schema.brand("StatementId"))

/** The file breaks the profile at `row` (the header is row 1); nothing is imported. */
export class InvalidBankStatement extends Domain.Rejection("InvalidBankStatement", {
  row: Schema.Int,
  reason: Schema.String,
}) {}

const StatementLine = Schema.Struct({
  lineNumber: Schema.Int,
  bookingDate: Schema.String,
  description: Schema.String,
  reference: Schema.NullOr(Schema.String),
  amount: Schema.String,
})

/** The whole statement: every line of the file, or no event at all. */
export class StatementImported extends Domain.Event("StatementImported", {
  lines: Schema.Array(StatementLine),
}) {}

export class ImportStatement extends Domain.Command("ImportStatement", {
  target: StatementId,
  input: { content: Schema.String },
  events: [StatementImported],
  rejects: [InvalidBankStatement],
}) {}

const Empty = Schema.TaggedStruct("Empty", {})
const Imported = Schema.TaggedStruct("Imported", { lineCount: Schema.Int })
const StatementState = Schema.Union([Empty, Imported])

type StatementState = typeof StatementState.Type

export class BankStatement extends Domain.Aggregate("BankStatement", {
  id: StatementId,
  state: StatementState,
  initial: Empty.make({}),
  commands: [ImportStatement],
  decide: {
    ImportStatement: (statement, cmd) =>
      // The file is judged first, as the service does before it looks for an earlier import.
      parseBankStatement(cmd.content).pipe(
        Effect.map((lines) =>
          // An imported statement never changes, so importing again records nothing.
          Predicate.isTagged(statement, "Imported") ? [] : [new StatementImported({ lines })],
        ),
        Effect.mapError(
          (error) => new InvalidBankStatement({ row: error.row, reason: error.reason }),
        ),
      ),
  },
  evolve: {
    StatementImported: (_, e): StatementState => Imported.make({ lineCount: e.lines.length }),
  },
}) {}

export class Settlement extends Domain.Model("Settlement", {
  aggregates: [BankStatement],
}) {}
