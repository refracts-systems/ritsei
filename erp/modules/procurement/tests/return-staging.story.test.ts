import { assert, describe, it } from "@effect/vitest"
import * as Data from "effect/Data"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  ApplyReturn,
  IssueForReturn,
  OrderReceived,
  PositionId,
  PostReturnJournal,
  ProcurementReturns,
  ProcurementReturnsHandlers,
  PurchaseOrderId,
  PurchaseReturnExceedsReceipt,
  ReceiveStock,
  RecordReturn,
  ReturnApplied,
  ReturnCancelled,
  ReturnableOrder,
  ReturnFailed,
  ReturnId,
  ReturnJournal,
  ReturnJournalPosted,
  ReturnRecorded,
  ReturnStatus,
  ReturnStock,
  StockIn,
  StockOut,
  StockRestored,
  StockValuationUnavailable,
} from "../src/return-staging-model.ts"

const { Story } = Domain

type Outcome = Data.TaggedEnum<{
  Completed: { readonly result: undefined }
  Rejected: { readonly rejection: StockValuationUnavailable }
}>

const Outcome = Data.taggedEnum<Outcome>()

const story = Story.make(ProcurementReturns, { layer: ProcurementReturnsHandlers })

const order = ReturnableOrder.ref(PurchaseOrderId.make("po-1"))

const stock = (item: string) => ReturnStock.ref(PositionId.make(`w-1/${item}`))
const journal = (id: string) => ReturnJournal.ref(ReturnId.make(id))
const status = (id: string) => ReturnStatus.ref(ReturnId.make(id))

const itemA = "00000000-0000-4000-8000-0000000000a1"
const itemB = "00000000-0000-4000-8000-0000000000a2"

// The order: 10 of A at 6.00 and 4 of B at 2.50, all received.
const lines = [
  { purchaseOrderLineId: "L1", itemId: itemA, unitPrice: "600", received: "10" },
  { purchaseOrderLineId: "L2", itemId: itemB, unitPrice: "250", received: "4" },
]

const received = new OrderReceived({ lines })

const ask = (returnId: string, items: ReadonlyArray<readonly [string, string]>) =>
  new RecordReturn({
    returnId,
    warehouseId: "w-1",
    lines: items.map(([purchaseOrderLineId, quantity]) => ({ purchaseOrderLineId, quantity })),
  })

const recorded = (
  returnId: string,
  items: ReadonlyArray<readonly [string, string, string, string]>,
) =>
  new ReturnRecorded({
    returnId,
    warehouseId: "w-1",
    lines: items.map(([purchaseOrderLineId, itemId, quantity, value]) => ({
      purchaseOrderLineId,
      itemId,
      quantity,
      value,
    })),
  })

const stockIn = (sourceId: string, quantity: string, value: string) =>
  new StockIn({ sourceId, quantity, value, onHandAfter: quantity, valueAfter: value })

const out = (returnId: string, quantity: string, value: string, onHand: string, left: string) =>
  new StockOut({ returnId, quantity, value, onHandAfter: onHand, valueAfter: left })

const completed = Outcome.Completed({ result: undefined })

describe("a return to a supplier staged as a saga (PRC-RET-1)", () => {
  it("the model is well defined", () =>
    assert.deepStrictEqual(Domain.verify(ProcurementReturns), []))

  // [PRC-RET-1]
  it.effect("a return issues stock at the order price, posts one journal, and is applied", () =>
    story(
      Story.given(order, received),
      Story.given(stock(itemA), stockIn("g-1", "10", "6000")),
      // B is worth 2.75 a unit on average, but goes back at the order price of 2.50.
      Story.given(stock(itemB), stockIn("g-1", "4", "1100")),
      Story.when(
        order,
        ask("r-1", [
          ["L1", "4"],
          ["L2", "1"],
        ]),
      ),
      Story.then(
        order,
        recorded("r-1", [
          ["L1", itemA, "4", "2400"],
          ["L2", itemB, "1", "250"],
        ]),
      ),
      Story.then(stock(itemA), out("r-1", "4", "2400", "6", "3600")),
      Story.then(stock(itemB), out("r-1", "1", "250", "3", "850")),
      Story.then(journal("r-1"), new ReturnJournalPosted({ amountMinor: "2650" })),
      Story.then(status("r-1"), new ReturnApplied()),
      Story.saga(ApplyReturn, status("r-1"), completed),
    ),
  )

  // [PRC-RET-1]
  it.effect("returns add up to what was received and no further", () =>
    story(
      Story.given(order, received),
      Story.given(stock(itemA), stockIn("g-1", "10", "6000")),
      Story.when(order, ask("r-1", [["L1", "11"]])),
      Story.rejected(
        new PurchaseReturnExceedsReceipt({ purchaseOrderLineId: "L1", available: "10" }),
      ),
      Story.then(order),
      Story.when(order, ask("r-2", [["L1", "7"]])),
      Story.then(order, recorded("r-2", [["L1", itemA, "7", "4200"]])),
      Story.then(stock(itemA), out("r-2", "7", "4200", "3", "1800")),
      Story.then(journal("r-2"), new ReturnJournalPosted({ amountMinor: "4200" })),
      Story.then(status("r-2"), new ReturnApplied()),
      Story.when(order, ask("r-3", [["L1", "4"]])),
      Story.rejected(
        new PurchaseReturnExceedsReceipt({ purchaseOrderLineId: "L1", available: "3" }),
      ),
      Story.when(order, ask("r-4", [["L9", "1"]])),
      Story.rejected(
        new PurchaseReturnExceedsReceipt({ purchaseOrderLineId: "L9", available: "0" }),
      ),
    ),
  )

  // [PRC-RET-1]
  it.effect("stock that was consumed cancels the return and restores the earlier lines", () =>
    story(
      Story.given(order, received),
      Story.given(stock(itemA), stockIn("g-1", "10", "6000")),
      // Nothing of B is left: it was consumed after the receipt.
      Story.when(
        order,
        ask("r-1", [
          ["L1", "4"],
          ["L2", "1"],
        ]),
      ),
      Story.then(
        order,
        recorded("r-1", [
          ["L1", itemA, "4", "2400"],
          ["L2", itemB, "1", "250"],
        ]),
        new ReturnCancelled({ returnId: "r-1" }),
      ),
      Story.then(
        stock(itemA),
        out("r-1", "4", "2400", "6", "3600"),
        new StockRestored({ returnId: "r-1", onHandAfter: "10", valueAfter: "6000" }),
      ),
      Story.then(stock(itemB)),
      Story.then(journal("r-1")),
      Story.then(status("r-1"), new ReturnFailed({ reason: "the stock could not be issued" })),
      Story.saga(
        ApplyReturn,
        status("r-1"),
        Outcome.Rejected({ rejection: new StockValuationUnavailable({ itemId: itemB }) }),
      ),
      // The cancelled return frees its quantity: the whole line can be returned under a new id.
      Story.when(order, ask("r-2", [["L1", "10"]])),
      Story.then(order, recorded("r-2", [["L1", itemA, "10", "6000"]])),
      Story.then(stock(itemA), out("r-2", "10", "6000", "0", "0")),
      Story.then(journal("r-2"), new ReturnJournalPosted({ amountMinor: "6000" })),
      Story.then(status("r-2"), new ReturnApplied()),
      // The id of the cancelled return is spent: production rolled back and a retry re-ran.
      Story.when(order, ask("r-1", [["L2", "1"]])),
      Story.then(order),
    ),
  )

  // [PRC-RET-1]
  it.effect(
    "stock worth less than the order price is refused, and the last units take what is left",
    () =>
      story(
        Story.given(order, received),
        // 10 units worth 20.00 in all: 4 at the order price of 6.00 would take 24.00.
        Story.given(stock(itemA), stockIn("g-1", "10", "2000")),
        Story.when(order, ask("r-1", [["L1", "4"]])),
        Story.then(
          order,
          recorded("r-1", [["L1", itemA, "4", "2400"]]),
          new ReturnCancelled({ returnId: "r-1" }),
        ),
        Story.then(stock(itemA)),
        Story.then(status("r-1"), new ReturnFailed({ reason: "the stock could not be issued" })),
        Story.saga(
          ApplyReturn,
          status("r-1"),
          Outcome.Rejected({ rejection: new StockValuationUnavailable({ itemId: itemA }) }),
        ),
        // Returning all 10 takes the remaining 20.00, not 60.00.
        Story.when(order, ask("r-2", [["L1", "10"]])),
        Story.then(order, recorded("r-2", [["L1", itemA, "10", "6000"]])),
        Story.then(stock(itemA), out("r-2", "10", "2000", "0", "0")),
        Story.then(journal("r-2"), new ReturnJournalPosted({ amountMinor: "2000" })),
        Story.then(status("r-2"), new ReturnApplied()),
      ),
  )

  // [PRC-RET-1]
  it.effect(
    "fewer units in stock than returned are refused even when the value would cover them",
    () =>
      story(
        Story.given(order, received),
        Story.given(stock(itemA), stockIn("g-1", "2", "5000")),
        Story.when(order, ask("r-1", [["L1", "4"]])),
        Story.then(
          order,
          recorded("r-1", [["L1", itemA, "4", "2400"]]),
          new ReturnCancelled({ returnId: "r-1" }),
        ),
        Story.then(stock(itemA)),
        Story.then(status("r-1"), new ReturnFailed({ reason: "the stock could not be issued" })),
        Story.saga(
          ApplyReturn,
          status("r-1"),
          Outcome.Rejected({ rejection: new StockValuationUnavailable({ itemId: itemA }) }),
        ),
      ),
  )

  // [PRC-RET-1]
  it.effect("a repeated return id, issue or journal changes nothing", () =>
    story(
      Story.given(order, received, recorded("r-1", [["L1", itemA, "4", "2400"]])),
      Story.when(order, ask("r-1", [["L1", "9"]])),
      Story.then(order),
      Story.given(stock(itemA), stockIn("g-1", "10", "6000"), out("r-1", "4", "2400", "6", "3600")),
      Story.when(
        stock(itemA),
        new IssueForReturn({ returnId: "r-1", itemId: itemA, quantity: "4", value: "2400" }),
      ),
      Story.then(stock(itemA)),
      Story.when(stock(itemA), new ReceiveStock({ sourceId: "g-1", quantity: "1", value: "1" })),
      Story.then(stock(itemA)),
      Story.given(journal("r-1"), new ReturnJournalPosted({ amountMinor: "2400" })),
      Story.when(journal("r-1"), new PostReturnJournal({ amountMinor: "1" })),
      Story.then(journal("r-1")),
    ),
  )
})
