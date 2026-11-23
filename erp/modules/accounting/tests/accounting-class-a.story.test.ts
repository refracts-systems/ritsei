import { assert, describe, it } from "@effect/vitest"
import * as Predicate from "effect/Predicate"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  Journal,
  JournalIdempotencyConflict,
  Ledger,
  OpeningJournalControlAccount,
  OpeningJournalPosted,
  PostOpeningJournal,
} from "../src/domain-model.ts"

const { Story } = Domain

const story = Story.make(Ledger)

const opening = Journal.ref("accounting.opening_balance/le-1")

// The accounts the posting rules resolve each role to.
const rules = [
  { role: "cash", accountId: "acc-cash" },
  { role: "receivable", accountId: "acc-receivable" },
  { role: "payable", accountId: "acc-payable" },
  { role: "inventory", accountId: "acc-inventory" },
  { role: "migration_clearing", accountId: "acc-clearing" },
] as const

const line = (accountId: string, debit: string, credit: string) => ({ accountId, debit, credit })

const cashAndEquity = [line("acc-cash", "500.00", "0"), line("acc-equity", "0", "1000.00")]

// Cash and equity from the owners' trial balance, plus the plug to migration clearing.
const balanced = [...cashAndEquity, line("acc-clearing", "500.00", "0")]

const post = (
  lines: ReadonlyArray<ReturnType<typeof line>>,
  postingDate = "2026-10-31",
  legalEntityId = "le-1",
) => new PostOpeningJournal({ legalEntityId, postingDate, lines, rules })

const posted = (
  lines: ReadonlyArray<ReturnType<typeof line>>,
  postingDate = "2026-10-31",
  legalEntityId = "le-1",
) => new OpeningJournalPosted({ legalEntityId, postingDate, lines })

// The journal as first posted.
const stillPosted = (state: typeof Journal.definition.state.Type) => {
  assert.isTrue(Predicate.isTagged(state, "Posted"))
  assert.deepStrictEqual(Predicate.isTagged(state, "Posted") ? state.lines : [], balanced)
}

describe("Accounting on Alchemy", () => {
  it("the model is well defined", () => assert.deepStrictEqual(Domain.verify(Ledger), []))

  // [ACC-OPEN-2]
  it.effect("posts an opening journal that leaves the control accounts to their owners", () =>
    story(Story.when(opening, post(balanced)), Story.then(opening, posted(balanced))),
  )

  // [ACC-OPEN-2]
  it.effect("refuses a line on the receivable, payable, or inventory account", () =>
    story(
      Story.when(
        opening,
        post([
          ...cashAndEquity,
          line("acc-receivable", "300.00", "0"),
          line("acc-clearing", "200.00", "0"),
        ]),
      ),
      Story.rejected(
        new OpeningJournalControlAccount({ role: "receivable", accountId: "acc-receivable" }),
      ),
      Story.when(
        opening,
        post([
          ...cashAndEquity,
          line("acc-payable", "0", "200.00"),
          line("acc-clearing", "700.00", "0"),
        ]),
      ),
      Story.rejected(
        new OpeningJournalControlAccount({ role: "payable", accountId: "acc-payable" }),
      ),
      Story.when(
        opening,
        post([
          ...cashAndEquity,
          line("acc-inventory", "400.00", "0"),
          line("acc-clearing", "100.00", "0"),
        ]),
      ),
      Story.rejected(
        new OpeningJournalControlAccount({ role: "inventory", accountId: "acc-inventory" }),
      ),
      Story.then(opening),
      Story.state(opening, (state) => assert.isTrue(Predicate.isTagged(state, "Unposted"))),
    ),
  )

  // [ACC-OPEN-2]
  it.effect("names the first control role when several are touched", () =>
    story(
      Story.when(
        opening,
        post([line("acc-inventory", "1.00", "0"), line("acc-receivable", "0", "1.00")]),
      ),
      Story.rejected(
        new OpeningJournalControlAccount({ role: "receivable", accountId: "acc-receivable" }),
      ),
    ),
  )

  // [ACC-OPEN-2]
  it.effect("ignores a control role the legal entity has no posting rule for", () =>
    story(
      Story.when(
        opening,
        new PostOpeningJournal({
          legalEntityId: "le-1",
          postingDate: "2026-10-31",
          lines: [line("acc-receivable", "1.00", "0"), line("acc-equity", "0", "1.00")],
          rules: [{ role: "cash", accountId: "acc-cash" }],
        }),
      ),
      Story.then(
        opening,
        posted([line("acc-receivable", "1.00", "0"), line("acc-equity", "0", "1.00")]),
      ),
    ),
  )

  // ACC-OPEN-4: RULES.md marks it unenforced, and the modules test fails a test that names an
  // unenforced rule, so the identifier is not bracketed here.
  it.effect(
    "keeps a posted journal as it was: a repeat is a no-op, a different posting conflicts",
    () =>
      story(
        Story.given(opening, posted(balanced)),
        Story.when(opening, post([...balanced].reverse())),
        Story.then(opening),
        Story.when(opening, post(balanced, "2026-11-30")),
        Story.rejected(new JournalIdempotencyConflict()),
        Story.when(
          opening,
          post([
            line("acc-cash", "600.00", "0"),
            line("acc-equity", "0", "1000.00"),
            line("acc-clearing", "400.00", "0"),
          ]),
        ),
        Story.rejected(new JournalIdempotencyConflict()),
        Story.then(opening),
        Story.state(opening, stillPosted),
      ),
  )

  // ACC-OPEN-4: a posting to another journal never touches a posted one. The reversal and manual
  // entry paths that correct a wrong journal are not modelled.
  it.effect("leaves a posted journal untouched when another journal is posted", () =>
    story(
      Story.given(opening, posted(balanced)),
      Story.when(
        Journal.ref("accounting.opening_balance/le-2"),
        post(balanced, "2026-10-31", "le-2"),
      ),
      Story.then(
        Journal.ref("accounting.opening_balance/le-2"),
        posted(balanced, "2026-10-31", "le-2"),
      ),
      Story.then(opening),
      Story.state(opening, stillPosted),
    ),
  )

  // ACC-OPEN-4: the only way to write to a journal is to post it.
  it("offers no command that changes or deletes a posted journal", () =>
    assert.deepStrictEqual(
      Journal.definition.commands.map((command) => command.tag),
      ["PostOpeningJournal"],
    ))
})
