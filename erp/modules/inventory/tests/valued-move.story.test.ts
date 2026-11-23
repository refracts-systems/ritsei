import { assert, describe, it } from "@effect/vitest"
import * as Data from "effect/Data"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  ApplyMove,
  DocumentId,
  InventoryValuedMove,
  InventoryValuedMoveHandlers,
  ItemId,
  journalRef,
  MarkMoveApplied,
  MoveApplied,
  MoveJournal,
  MoveJournalPosted,
  MoveParked,
  MoveRecorded,
  MoveReversed,
  MoveStatus,
  MoveStock,
  PostMoveJournal,
  RecordMove,
  StockDocument,
  StockMoved,
  StockValuationUnavailable,
  ValuedItem,
} from "../src/valued-move-model.ts"

const { Story } = Domain

type Outcome = Data.TaggedEnum<{
  Completed: { readonly result: undefined }
  Rejected: { readonly rejection: StockValuationUnavailable }
}>

const Outcome = Data.taggedEnum<Outcome>()

const story = Story.make(InventoryValuedMove, { layer: InventoryValuedMoveHandlers })

const itemA = "00000000-0000-4000-8000-0000000000a1"
const itemB = "00000000-0000-4000-8000-0000000000a2"

const document = (id: string) => StockDocument.ref(DocumentId.make(id))
const item = (itemId: string) => ValuedItem.ref(ItemId.make(`le-1/${itemId}`))
const journal = (id: string) => MoveJournal.ref(journalRef(id))
const status = (id: string) => MoveStatus.ref(DocumentId.make(id))

const line = (itemId: string, quantity: string, receiptValue: string | null = null) => ({
  itemId,
  quantity,
  receiptValue,
})

const record = (lines: ReadonlyArray<ReturnType<typeof line>>) =>
  new RecordMove({ legalEntityId: "le-1", lines })

const recorded = (lines: ReadonlyArray<ReturnType<typeof line>>) =>
  new MoveRecorded({ legalEntityId: "le-1", lines })

const moved = (
  documentId: string,
  quantity: string,
  value: string,
  onHandAfter: string,
  valueAfter: string,
) => new StockMoved({ documentId, quantity, value, onHandAfter, valueAfter })

const posted = (gainsMinor: string, lossesMinor: string) =>
  new MoveJournalPosted({ gainsMinor, lossesMinor })

const applied = new MoveApplied()
const completed = Outcome.Completed({ result: undefined })

describe("valued stock moves staged as a saga (INV-VAL-1, INV-VAL-2, INV-VAL-3)", () => {
  it("the model is well defined", () =>
    assert.deepStrictEqual(Domain.verify(InventoryValuedMove), []))

  // [INV-VAL-2]
  it.effect("a receipt moves each item at its document value and posts one journal", () =>
    story(
      Story.when(document("d-1"), record([line(itemA, "10", "3000"), line(itemB, "4", "800")])),
      Story.then(document("d-1"), recorded([line(itemA, "10", "3000"), line(itemB, "4", "800")])),
      Story.then(item(itemA), moved("d-1", "10", "3000", "10", "3000")),
      Story.then(item(itemB), moved("d-1", "4", "800", "4", "800")),
      Story.then(journal("d-1"), posted("3800", "0")),
      Story.then(status("d-1"), applied),
      Story.saga(ApplyMove, status("d-1"), completed),
    ),
  )

  // [INV-VAL-1]
  it.effect("an issue takes the moving-average cost rounded half up", () =>
    story(
      Story.given(item(itemA), moved("d-0", "3", "100", "3", "100")),
      Story.when(document("d-1"), record([line(itemA, "-1")])),
      Story.then(document("d-1"), recorded([line(itemA, "-1")])),
      // 100 / 3 = 33.33, rounded to 33.
      Story.then(item(itemA), moved("d-1", "-1", "-33", "2", "67")),
      Story.then(journal("d-1"), posted("0", "33")),
      Story.then(status("d-1"), applied),
      Story.saga(ApplyMove, status("d-1"), completed),
      // 67 / 2 = 33.5, rounded half up to 34.
      Story.when(document("d-2"), record([line(itemA, "-1")])),
      Story.then(document("d-2"), recorded([line(itemA, "-1")])),
      Story.then(item(itemA), moved("d-2", "-1", "-34", "1", "33")),
      Story.then(journal("d-2"), posted("0", "34")),
      Story.then(status("d-2"), applied),
    ),
  )

  // [INV-VAL-1]
  it.effect("the last units take the remaining value, so no value is stranded", () =>
    story(
      Story.given(item(itemA), moved("d-0", "3", "100", "3", "100")),
      Story.when(document("d-1"), record([line(itemA, "-3")])),
      Story.then(document("d-1"), recorded([line(itemA, "-3")])),
      Story.then(item(itemA), moved("d-1", "-3", "-100", "0", "0")),
      Story.then(journal("d-1"), posted("0", "100")),
      Story.then(status("d-1"), applied),
    ),
  )

  // [INV-VAL-1]
  it.effect("a gain without a value takes the moving average", () =>
    story(
      Story.given(item(itemA), moved("d-0", "10", "3000", "10", "3000")),
      Story.when(document("d-1"), record([line(itemA, "5")])),
      Story.then(document("d-1"), recorded([line(itemA, "5")])),
      Story.then(item(itemA), moved("d-1", "5", "1500", "15", "4500")),
      Story.then(journal("d-1"), posted("1500", "0")),
      Story.then(status("d-1"), applied),
    ),
  )

  // [INV-VAL-2]
  it.effect("a document that gains and loses posts both sides in one journal", () =>
    story(
      Story.given(item(itemB), moved("d-0", "10", "1000", "10", "1000")),
      Story.when(document("d-1"), record([line(itemA, "2", "500"), line(itemB, "-5")])),
      Story.then(document("d-1"), recorded([line(itemA, "2", "500"), line(itemB, "-5")])),
      Story.then(item(itemA), moved("d-1", "2", "500", "2", "500")),
      Story.then(item(itemB), moved("d-1", "-5", "-500", "5", "500")),
      Story.then(journal("d-1"), posted("500", "500")),
      Story.then(status("d-1"), applied),
    ),
  )

  // [INV-VAL-2]
  it.effect("a document that carries no value posts no journal", () =>
    story(
      Story.when(document("d-1"), record([line(itemA, "10", "0")])),
      Story.then(document("d-1"), recorded([line(itemA, "10", "0")])),
      Story.then(item(itemA), moved("d-1", "10", "0", "10", "0")),
      Story.then(status("d-1"), applied),
    ),
  )

  // [INV-VAL-3]
  it.effect(
    "an issue beyond the valued quantity is refused and the earlier items are reversed",
    () =>
      story(
        Story.given(item(itemB), moved("d-0", "1", "100", "1", "100")),
        Story.when(document("d-1"), record([line(itemA, "5", "500"), line(itemB, "-2")])),
        Story.then(document("d-1"), recorded([line(itemA, "5", "500"), line(itemB, "-2")])),
        Story.then(
          item(itemA),
          moved("d-1", "5", "500", "5", "500"),
          new MoveReversed({
            documentId: "d-1",
            onHandAfter: "0",
            valueAfter: "0",
          }),
        ),
        // The refused item is untouched, and no journal was posted.
        Story.then(item(itemB)),
        Story.then(journal("d-1")),
        Story.then(status("d-1"), new MoveParked({ reason: "an item could not be moved" })),
        Story.saga(
          ApplyMove,
          status("d-1"),
          Outcome.Rejected({ rejection: new StockValuationUnavailable({ itemId: itemB }) }),
        ),
      ),
  )

  // [INV-VAL-2]
  it.effect("a document moves an item at most once, whatever it carries the second time", () =>
    story(
      Story.given(item(itemA), moved("d-1", "10", "3000", "10", "3000")),
      Story.when(
        item(itemA),
        new MoveStock({ documentId: "d-1", itemId: itemA, quantity: "10", receiptValue: "3000" }),
      ),
      Story.then(item(itemA)),
      Story.when(
        item(itemA),
        new MoveStock({ documentId: "d-1", itemId: itemA, quantity: "-4", receiptValue: null }),
      ),
      Story.then(item(itemA)),
    ),
  )

  // [INV-VAL-2]
  it.effect("a repeated document records nothing and the journal is posted once", () =>
    story(
      Story.given(document("d-1"), recorded([line(itemA, "10", "3000")])),
      Story.when(document("d-1"), record([line(itemA, "99", "1")])),
      Story.then(document("d-1")),
      Story.given(journal("d-1"), posted("3000", "0")),
      Story.when(journal("d-1"), new PostMoveJournal({ gainsMinor: "1", lossesMinor: "0" })),
      Story.then(journal("d-1")),
      Story.given(status("d-1"), applied),
      Story.when(status("d-1"), new MarkMoveApplied({})),
      Story.then(status("d-1")),
    ),
  )
})
