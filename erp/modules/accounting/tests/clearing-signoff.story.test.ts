import { assert, describe, it } from "@effect/vitest"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  AccountingClearingSignoff,
  AccountingClearingSignoffHandlers,
  ClearingMoved,
  EntityLedger,
  LegalEntityId,
  NotPosted,
  NotZero,
  OpeningPosted,
  PostOpening,
  PostOwnerLoad,
  VerifyClearing,
  Verified,
} from "../src/clearing-signoff-model.ts"

const { Story } = Domain

const story = Story.make(AccountingClearingSignoff, { layer: AccountingClearingSignoffHandlers })

const ledger = EntityLedger.ref(LegalEntityId.make("le-1"))

const verdict = (
  asOf: string,
  expected: typeof Verified.Type | typeof NotZero.Type | typeof NotPosted.Type,
) => Story.query(VerifyClearing, { asOf }, (result) => assert.deepStrictEqual(result, expected))

// The source trial balance of the production test: the opening journal plugs +500.00 into clearing,
// and the owners' loads bring it back to zero.
const opening = (date: string) => new PostOpening({ postingDate: date, clearing: "500.00" })
const openingPosted = (date: string) => new OpeningPosted({ postingDate: date, clearing: "500.00" })

const load = (sourceId: string, date: string, amount: string) =>
  new PostOwnerLoad({ sourceId, postingDate: date, amount })

const moved = (sourceId: string, date: string, amount: string) =>
  new ClearingMoved({ sourceId, postingDate: date, amount })

describe("migration sign-off against the clearing view (ACC-OPEN-3)", () => {
  it("the model is well defined", () =>
    assert.deepStrictEqual(Domain.verify(AccountingClearingSignoff), []))

  // [ACC-OPEN-3]
  it.effect("nothing loaded is not signed off, though its balance is zero", () =>
    story(verdict("2026-01-01", NotPosted.make({}))),
  )

  // [ACC-OPEN-3]
  it.effect("an opening journal with clearing left over is refused with the balance", () =>
    story(
      Story.when(ledger, opening("2026-01-01")),
      Story.then(ledger, openingPosted("2026-01-01")),
      verdict("2026-01-01", NotZero.make({ balance: "500.00" })),
    ),
  )

  // [ACC-OPEN-3]
  it.effect("owner loads that bring clearing to exactly zero are signed off", () =>
    story(
      Story.when(ledger, opening("2026-01-01")),
      Story.then(ledger, openingPosted("2026-01-01")),
      Story.when(ledger, load("receivables", "2026-01-01", "-300.00")),
      Story.then(ledger, moved("receivables", "2026-01-01", "-300.00")),
      // A balance the owners have not finished is still refused: one cent is not zero.
      verdict("2026-01-01", NotZero.make({ balance: "200.00" })),
      Story.when(ledger, load("inventory", "2026-01-01", "-199.99")),
      Story.then(ledger, moved("inventory", "2026-01-01", "-199.99")),
      verdict("2026-01-01", NotZero.make({ balance: "0.01" })),
      Story.when(ledger, load("payables", "2026-01-01", "-0.01")),
      Story.then(ledger, moved("payables", "2026-01-01", "-0.01")),
      verdict("2026-01-01", Verified.make({ asOf: "2026-01-01" })),
    ),
  )

  // [ACC-OPEN-3]
  it.effect(
    "an opening journal dated after the cutoff does not count, and neither do later moves",
    () =>
      story(
        Story.when(ledger, opening("2026-02-01")),
        Story.then(ledger, openingPosted("2026-02-01")),
        verdict("2026-01-31", NotPosted.make({})),
        Story.when(ledger, load("receivables", "2026-03-01", "-500.00")),
        Story.then(ledger, moved("receivables", "2026-03-01", "-500.00")),
        // At the cutoff of the opening date the balance is still 500; the later load is not in it.
        verdict("2026-02-01", NotZero.make({ balance: "500.00" })),
        verdict("2026-03-01", Verified.make({ asOf: "2026-03-01" })),
      ),
  )

  // [ACC-OPEN-3]
  it.effect("a second opening journal or a repeated owner load changes nothing", () =>
    story(
      Story.given(
        ledger,
        openingPosted("2026-01-01"),
        moved("receivables", "2026-01-01", "-500.00"),
      ),
      Story.when(ledger, opening("2026-01-01")),
      Story.then(ledger),
      Story.when(ledger, load("receivables", "2026-01-01", "-500.00")),
      Story.then(ledger),
      verdict("2026-01-01", Verified.make({ asOf: "2026-01-01" })),
    ),
  )

  // [ACC-OPEN-3]
  it.effect("clearing pushed below zero is refused as well", () =>
    story(
      Story.when(ledger, opening("2026-01-01")),
      Story.then(ledger, openingPosted("2026-01-01")),
      Story.when(ledger, load("receivables", "2026-01-01", "-600.00")),
      Story.then(ledger, moved("receivables", "2026-01-01", "-600.00")),
      verdict("2026-01-01", NotZero.make({ balance: "-100.00" })),
    ),
  )
})
