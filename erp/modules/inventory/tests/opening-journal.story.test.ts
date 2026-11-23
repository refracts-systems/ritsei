import { assert, describe, it } from "@effect/vitest"
import * as Data from "effect/Data"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import { AcceptOpening, OpeningAccepted, OpeningLoad } from "../src/domain-model.ts"
import {
  DeactivateItem,
  InventoryOpeningPosting,
  InventoryOpeningPostingHandlers,
  ItemDeactivated,
  ItemInactive,
  journalRef,
  OpeningJournal,
  OpeningJournalPosted,
  OpeningJournalReversedForFailedLoad,
  OpeningParked,
  OpeningPosition,
  OpeningPosted,
  OpeningStatus,
  PositionId,
  PositionLoaded,
  PositionUnloaded,
  PostOpening,
  PostOpeningJournal,
  ReverseOpeningJournal,
} from "../src/opening-journal-model.ts"

const { Story } = Domain

type Outcome = Data.TaggedEnum<{
  Completed: { readonly result: undefined }
  Rejected: { readonly rejection: ItemInactive }
}>

const Outcome = Data.taggedEnum<Outcome>()

const story = Story.make(InventoryOpeningPosting, { layer: InventoryOpeningPostingHandlers })

const warehouse = "w-1"
const cutoff = "2026-12-31"
const opening = OpeningLoad.ref("o-1")
const status = OpeningStatus.ref("o-1")
const journal = OpeningJournal.ref(journalRef("o-1"))
const position = (item: string) => OpeningPosition.ref(PositionId.make(`${warehouse}/${item}`))

const line = (itemId: string, sourceValue = "100.00") => ({
  itemId,
  quantity: "10",
  sourceValue,
  tracking: "none" as const,
  reservedQuantity: "0",
  inTransitQuantity: "0",
})

const accept = (items: ReadonlyArray<ReturnType<typeof line>>) =>
  new AcceptOpening({ warehouseId: warehouse, cutoffDate: cutoff, lines: items })

const accepted = (items: ReadonlyArray<ReturnType<typeof line>>) =>
  new OpeningAccepted({ warehouseId: warehouse, cutoffDate: cutoff, lines: items })

const loaded = new PositionLoaded({ openingId: "o-1", quantity: "10" })
const unloaded = new PositionUnloaded({ openingId: "o-1" })
const posted = (amountMinor: string) => new OpeningJournalPosted({ amountMinor })
const reversed = (amountMinor: string) => new OpeningJournalReversedForFailedLoad({ amountMinor })
const parked = new OpeningParked({ reason: "a later step was refused" })

const a = line("A")
const b = line("B")

describe("the opening stock load staged as a saga (INV-OPEN-5)", () => {
  it("the model is well defined", () =>
    assert.deepStrictEqual(Domain.verify(InventoryOpeningPosting), []))

  // [INV-OPEN-5]
  it.effect("the load is recorded, the journal posted once, and every position loaded", () =>
    story(
      Story.when(opening, accept([a, b])),
      Story.then(opening, accepted([a, b])),
      Story.then(journal, posted("20000")),
      Story.then(position("A"), loaded),
      Story.then(position("B"), loaded),
      Story.then(status, new OpeningPosted()),
      Story.saga(PostOpening, opening, Outcome.Completed({ result: undefined })),
    ),
  )

  // [INV-OPEN-5]
  it.effect("stock with no value posts no journal", () =>
    story(
      Story.when(opening, accept([line("A", "0.00")])),
      Story.then(opening, accepted([line("A", "0.00")])),
      Story.then(journal),
      Story.then(position("A"), loaded),
      Story.then(status, new OpeningPosted()),
      Story.saga(PostOpening, opening, Outcome.Completed({ result: undefined })),
    ),
  )

  // [INV-OPEN-5]
  it.effect("a refused position leaves the journal and one reversal marked as a failed load", () =>
    story(
      Story.given(position("B"), new ItemDeactivated()),
      Story.when(opening, accept([a, b])),
      Story.then(opening, accepted([a, b])),
      // The journal stays recorded and is reversed once; the position A loaded is unloaded.
      Story.then(journal, posted("20000"), reversed("20000")),
      Story.then(position("A"), loaded, unloaded),
      Story.then(position("B")),
      // The opening is parked for a person, not retried and not deleted.
      Story.then(status, parked),
      Story.saga(
        PostOpening,
        opening,
        Outcome.Rejected({ rejection: new ItemInactive({ itemId: "B" }) }),
      ),
    ),
  )

  // [INV-OPEN-5]
  it.effect("a journal is posted once per reference and a reversed one is never posted again", () =>
    story(
      Story.given(journal, posted("20000")),
      Story.when(journal, new PostOpeningJournal({ amountMinor: "20000" })),
      Story.then(journal),
      Story.when(journal, new ReverseOpeningJournal({})),
      Story.then(journal, reversed("20000")),
      Story.when(journal, new ReverseOpeningJournal({})),
      Story.then(journal),
      // A retry after the reversal posts nothing: the load is parked, not completed without a journal.
      Story.when(journal, new PostOpeningJournal({ amountMinor: "20000" })),
      Story.then(journal),
    ),
  )

  // [INV-OPEN-5]
  it.effect("a reversal with nothing posted records nothing", () =>
    story(Story.when(journal, new ReverseOpeningJournal({})), Story.then(journal)),
  )

  // [INV-OPEN-5]
  it.effect("an item deactivated after it was loaded does not undo the load", () =>
    story(
      Story.given(position("A"), loaded),
      Story.when(position("A"), new DeactivateItem({})),
      Story.then(position("A")),
    ),
  )
})
