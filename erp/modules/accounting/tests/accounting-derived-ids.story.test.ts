import { assert, describe, it } from "@effect/vitest"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  Journal,
  JournalIdempotencyConflict,
  Ledger,
  OpeningJournalPosted,
  PostOpeningJournal,
} from "../src/domain-model.ts"
import { openingJournalKey, openingJournalReference } from "../src/opening-journal.ts"

const { Story } = Domain

const story = Story.make(Ledger)

const line = (accountId: string, debit: string, credit: string) => ({ accountId, debit, credit })

const lines = [line("acc-cash", "500.00", "0"), line("acc-equity", "0", "500.00")]

const post = (legalEntityId: string, postingLines = lines, postingDate = "2026-10-31") =>
  new PostOpeningJournal({ legalEntityId, postingDate, lines: postingLines, rules: [] })

const posted = (legalEntityId: string) =>
  new OpeningJournalPosted({ legalEntityId, postingDate: "2026-10-31", lines })

const entityOne = Journal.ref(openingJournalKey("tenant-a", "le-1"))
const otherTenant = Journal.ref(openingJournalKey("tenant-b", "le-1"))

describe("ACC-OPEN-1 on Alchemy: the opening journal is an instance keyed by the legal entity", () => {
  it("the model is well defined", () => assert.deepStrictEqual(Domain.verify(Ledger), []))

  // [ACC-OPEN-1]
  it("derives the reference production posts under", () =>
    assert.strictEqual(openingJournalReference("le-1"), "accounting.opening_balance/le-1"))

  // [ACC-OPEN-1]
  it.effect("a repeat of the same command returns the posted entry and records nothing", () =>
    story(
      Story.when(entityOne, post("le-1")),
      Story.then(entityOne, posted("le-1")),
      Story.when(entityOne, post("le-1", [...lines].reverse())),
      Story.then(entityOne),
    ),
  )

  // [ACC-OPEN-1]
  it.effect(
    "a different journal for the same legal entity fails with JournalIdempotencyConflict",
    () =>
      story(
        Story.given(entityOne, posted("le-1")),
        Story.when(
          entityOne,
          post("le-1", [line("acc-cash", "600.00", "0"), line("acc-equity", "0", "600.00")]),
        ),
        Story.rejected(new JournalIdempotencyConflict()),
        Story.then(entityOne),
        Story.when(entityOne, post("le-1", lines, "2026-11-30")),
        Story.rejected(new JournalIdempotencyConflict()),
      ),
  )

  // [ACC-OPEN-1]
  it.effect("another tenant's journal for the same legal entity is a different instance", () =>
    story(
      Story.given(entityOne, posted("le-1")),
      Story.when(
        otherTenant,
        post("le-1", [line("acc-cash", "600.00", "0"), line("acc-equity", "0", "600.00")]),
      ),
      Story.then(
        otherTenant,
        new OpeningJournalPosted({
          legalEntityId: "le-1",
          postingDate: "2026-10-31",
          lines: [line("acc-cash", "600.00", "0"), line("acc-equity", "0", "600.00")],
        }),
      ),
    ),
  )

  // [ACC-OPEN-1]
  it("the key depends on the tenant and on the legal entity", () => {
    assert.notStrictEqual(
      openingJournalKey("tenant-a", "le-1"),
      openingJournalKey("tenant-b", "le-1"),
    )
    assert.notStrictEqual(
      openingJournalKey("tenant-a", "le-1"),
      openingJournalKey("tenant-a", "le-2"),
    )
  })
})
