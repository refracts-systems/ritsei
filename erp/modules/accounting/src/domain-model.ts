/**
 * The Alchemy model of Accounting's class A rules (ADR-0124, phase 1). It runs on the in-memory host
 * in stories only: the ledger stays on its tables and this file is never loaded by production, so it
 * is not exported from `mod.ts`. `PostOpeningJournal` decides control accounts with
 * `firstControlAccountLine`, the function the PostgreSQL ledger store calls.
 *
 * The service validates lines (one positive side each, debits equal credits) and resolves roles to
 * accounts before it sends the command, so `decide` receives resolved lines, as the store does.
 */
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  FinancialMajorAmount,
  requireExactMajorToMinor,
} from "../../../../framework/foundation/mod.ts"
import { PostingRole } from "./general-ledger-contract.ts"
import { firstControlAccountLine, OPENING_CONTROL_ROLES } from "./opening-journal.ts"

/** A journal by reference: the opening journal is `accounting.opening_balance/<legal entity id>`. */
export const JournalRef = Schema.String.pipe(Schema.brand("JournalRef"))

export class OpeningJournalControlAccount extends Domain.Rejection("OpeningJournalControlAccount", {
  role: PostingRole,
  accountId: Schema.String,
}) {}

/** The journal was posted before with other lines or another date. */
export class JournalIdempotencyConflict extends Domain.Rejection("JournalIdempotencyConflict") {}

const Line = Schema.Struct({
  accountId: Schema.String,
  debit: FinancialMajorAmount,
  credit: FinancialMajorAmount,
})

export class OpeningJournalPosted extends Domain.Event("OpeningJournalPosted", {
  postingDate: Schema.String,
  lines: Schema.Array(Line),
}) {}

export class PostOpeningJournal extends Domain.Command("PostOpeningJournal", {
  target: JournalRef,
  input: {
    postingDate: Schema.String,
    lines: Schema.Array(Line),
    /** The legal entity's posting rules: the account each role resolves to. */
    rules: Schema.Array(Schema.Struct({ role: PostingRole, accountId: Schema.String })),
  },
  events: [OpeningJournalPosted],
  rejects: [OpeningJournalControlAccount, JournalIdempotencyConflict],
}) {}

const Unposted = Schema.TaggedStruct("Unposted", {})

const Posted = Schema.TaggedStruct("Posted", {
  postingDate: Schema.String,
  lines: Schema.Array(Line),
})

const JournalState = Schema.Union([Unposted, Posted])

type JournalState = typeof JournalState.Type

const minor = (value: string) => requireExactMajorToMinor(value, 2)

/** What a retried posting must repeat: the date and the lines, in any order. */
const postingKey = (postingDate: string, lines: ReadonlyArray<typeof Line.Type>) =>
  JSON.stringify([
    postingDate,
    lines.map((line) => `${line.accountId}:${minor(line.debit)}:${minor(line.credit)}`).toSorted(),
  ])

/**
 * A journal. It has one command, `PostOpeningJournal`: nothing changes or deletes a posted journal
 * (ACC-OPEN-4), which PostgreSQL also enforces with triggers on `journal_entries` and
 * `journal_lines`. A wrong journal is corrected by a new entry, a different instance.
 */
export class Journal extends Domain.Aggregate("Journal", {
  id: JournalRef,
  state: JournalState,
  initial: Unposted.make({}),
  commands: [PostOpeningJournal],
  decide: {
    PostOpeningJournal: (journal, cmd) => {
      // A retried posting repeats the posted entry; it is judged before control accounts, as the store does.
      if (Predicate.isTagged(journal, "Posted")) {
        return postingKey(journal.postingDate, journal.lines) ===
          postingKey(cmd.postingDate, cmd.lines)
          ? []
          : new JournalIdempotencyConflict()
      }

      const control = firstControlAccountLine(
        OPENING_CONTROL_ROLES,
        cmd.lines,
        new Map(cmd.rules.map((rule) => [rule.role, rule.accountId])),
      )

      return control === undefined
        ? [new OpeningJournalPosted({ postingDate: cmd.postingDate, lines: cmd.lines })]
        : new OpeningJournalControlAccount(control)
    },
  },
  evolve: {
    OpeningJournalPosted: (_, e): JournalState =>
      Posted.make({ postingDate: e.postingDate, lines: e.lines }),
  },
}) {}

export class Ledger extends Domain.Model("Ledger", {
  aggregates: [Journal],
}) {}
