import { assert, describe, it } from "@effect/vitest"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  BilledOrder,
  BillExceedsReceipt,
  BillingBilling,
  BillingBillingHandlers,
  BillOrder,
  BillRecorded,
  ConfirmFeedPurchase,
  CreditTracked,
  FeedPurchase,
  PurchaseConfirmationTracked,
  PurchaseOrderId,
  PurchaseOrderNotConfirmed,
  PurchaseWasConfirmed,
  ReceiptTracked,
  ReceiptWasRecorded,
  RecordFeedReceipt,
  RecordFeedReturn,
  ReturnTracked,
  ReturnWasRecorded,
  TrackCredit,
  TrackedPurchaseId,
  TrackPurchaseConfirmation,
  TrackReceipt,
  TrackReturn,
} from "../src/billed-quantity-model.ts"

const { Story } = Domain

const story = Story.make(BillingBilling, { layer: BillingBillingHandlers })

const feed = FeedPurchase.ref(PurchaseOrderId.make("po-1"))
const tracker = BilledOrder.ref(TrackedPurchaseId.make("po-1"))

// Line 1 is ordered at 6.00, line 2 at 2.50.
const ordered = [
  { lineId: "l-1", unitPrice: "6.00" },
  { lineId: "l-2", unitPrice: "2.50" },
]

const lines = (items: ReadonlyArray<readonly [string, string]>) =>
  items.map(([lineId, quantity]) => ({ lineId, quantity }))

const confirmed = new PurchaseConfirmationTracked({ lines: ordered })

const receipt = (receiptId: string, items: ReadonlyArray<readonly [string, string]>) =>
  new ReceiptTracked({ receiptId, lines: lines(items) })

const returned = (returnId: string, items: ReadonlyArray<readonly [string, string]>) =>
  new ReturnTracked({ returnId, lines: lines(items) })

const bill = (
  billId: string,
  items: ReadonlyArray<readonly [string, string, string?]>,
  approvedVariance: string | null = null,
) =>
  new BillOrder({
    billId,
    approvedVariance,
    lines: items.map(([lineId, quantity, unitPrice]) => ({
      lineId,
      quantity,
      unitPrice: unitPrice ?? (lineId === "l-1" ? "6.00" : "2.50"),
    })),
  })

const billed = (billId: string, items: ReadonlyArray<readonly [string, string, string, string]>) =>
  new BillRecorded({
    billId,
    lines: items.map(([lineId, quantity, matched, matchedValue]) => ({
      lineId,
      quantity,
      matched,
      matchedValue,
    })),
  })

const exceeds = (lineId: string, billable: string, requested: string) =>
  new BillExceedsReceipt({ lineId, billable, requested })

describe("supplier bills staged on a tracker (BIL-BILL-1)", () => {
  it("the model is well defined", () => assert.deepStrictEqual(Domain.verify(BillingBilling), []))

  // [BIL-BILL-1]
  it.effect("confirmation, receipt, and return reach the tracker; a bill matches the receipt", () =>
    story(
      Story.when(feed, new ConfirmFeedPurchase({ lines: ordered })),
      Story.then(feed, new PurchaseWasConfirmed({ lines: ordered })),
      Story.then(tracker, confirmed),
      Story.when(feed, new RecordFeedReceipt({ receiptId: "r-1", lines: lines([["l-1", "10"]]) })),
      Story.then(feed, new ReceiptWasRecorded({ receiptId: "r-1", lines: lines([["l-1", "10"]]) })),
      Story.then(tracker, receipt("r-1", [["l-1", "10"]])),
      Story.when(feed, new RecordFeedReturn({ returnId: "x-1", lines: lines([["l-1", "2"]]) })),
      Story.then(feed, new ReturnWasRecorded({ returnId: "x-1", lines: lines([["l-1", "2"]]) })),
      Story.then(tracker, returned("x-1", [["l-1", "2"]])),
      Story.when(tracker, bill("b-1", [["l-1", "8"]])),
      Story.then(tracker, billed("b-1", [["l-1", "8", "8", "48.00"]])),
    ),
  )

  // [BIL-BILL-1]
  it.effect("billable is received less returned less billed plus credited, line by line", () =>
    story(
      Story.given(
        tracker,
        confirmed,
        receipt("r-1", [
          ["l-1", "10"],
          ["l-2", "5"],
        ]),
      ),
      Story.given(tracker, returned("x-1", [["l-1", "2"]])),
      Story.when(tracker, bill("b-1", [["l-1", "8"]])),
      Story.then(tracker, billed("b-1", [["l-1", "8", "8", "48.00"]])),
      // Nothing of line 1 is left, and line 2 is untouched by it.
      Story.when(tracker, bill("b-2", [["l-1", "1"]])),
      Story.rejected(exceeds("l-1", "0", "1")),
      Story.when(tracker, bill("b-2", [["l-2", "5"]])),
      Story.then(tracker, billed("b-2", [["l-2", "5", "5", "12.50"]])),
      // A credit note returns billed quantity to billable.
      Story.when(tracker, new TrackCredit({ creditId: "c-1", lines: lines([["l-1", "3"]]) })),
      Story.then(tracker, new CreditTracked({ creditId: "c-1", lines: lines([["l-1", "3"]]) })),
      Story.when(tracker, bill("b-3", [["l-1", "3"]])),
      Story.then(tracker, billed("b-3", [["l-1", "3", "3", "18.00"]])),
    ),
  )

  // [BIL-BILL-1]
  it.effect(
    "a return after a bill leaves the line with a negative billable quantity, so it bills nothing",
    () =>
      story(
        Story.given(tracker, confirmed, receipt("r-1", [["l-1", "10"]])),
        Story.given(tracker, billed("b-1", [["l-1", "8", "8", "48.00"]])),
        Story.given(tracker, returned("x-1", [["l-1", "5"]])),
        // 10 received, 5 returned, 8 billed: -3 is billable.
        Story.when(tracker, bill("b-2", [["l-1", "1"]])),
        Story.rejected(exceeds("l-1", "-3", "1")),
      ),
  )

  // [BIL-BILL-1]
  it.effect("two bills for the same receipt record once: the tracker serializes them", () =>
    story(
      Story.given(tracker, confirmed, receipt("r-1", [["l-1", "10"]])),
      Story.when(tracker, bill("b-1", [["l-1", "10"]])),
      Story.then(tracker, billed("b-1", [["l-1", "10", "10", "60.00"]])),
      Story.when(tracker, bill("b-2", [["l-1", "10"]])),
      Story.rejected(exceeds("l-1", "0", "10")),
      Story.then(tracker),
    ),
  )

  // [BIL-BILL-1]
  it.effect("a bill beyond receipt needs an approved variance covering the excess", () =>
    story(
      Story.given(tracker, confirmed, receipt("r-1", [["l-1", "10"]])),
      Story.when(tracker, bill("b-1", [["l-1", "12"]])),
      Story.rejected(exceeds("l-1", "10", "12")),
      // 2 units in excess at the bill's price of 6.00 is 12.00; 11.99 does not cover it.
      Story.when(tracker, bill("b-1", [["l-1", "12"]], "11.99")),
      Story.rejected(exceeds("l-1", "10", "12")),
      Story.when(tracker, bill("b-1", [["l-1", "12"]], "12.00")),
      // The bill records but matches only what was received.
      Story.then(tracker, billed("b-1", [["l-1", "12", "10", "60.00"]])),
    ),
  )

  // [BIL-BILL-1]
  it.effect("an excess is valued at the bill's price, not the order's", () =>
    story(
      Story.given(tracker, confirmed, receipt("r-1", [["l-1", "10"]])),
      // 1 unit in excess at 7.00 is 7.00.
      Story.when(tracker, bill("b-1", [["l-1", "11", "7.00"]], "6.99")),
      Story.rejected(exceeds("l-1", "10", "11")),
      Story.when(tracker, bill("b-1", [["l-1", "11", "7.00"]], "7.00")),
      Story.then(tracker, billed("b-1", [["l-1", "11", "10", "60.00"]])),
    ),
  )

  // [BIL-BILL-1]
  it.effect("a line not on the order is refused, even with an approval", () =>
    story(
      Story.given(tracker, confirmed, receipt("r-1", [["l-1", "10"]])),
      Story.when(tracker, bill("b-1", [["l-9", "1", "1.00"]], "999.00")),
      Story.rejected(exceeds("l-9", "0", "0")),
      Story.then(tracker),
    ),
  )

  // [BIL-BILL-1]
  it.effect("a receipt the tracker has not received yet is not billable: the lag state", () =>
    story(
      Story.given(feed, new PurchaseWasConfirmed({ lines: ordered })),
      Story.given(
        feed,
        new ReceiptWasRecorded({ receiptId: "r-1", lines: lines([["l-1", "10"]]) }),
      ),
      Story.given(tracker, confirmed),
      // Procurement recorded the receipt; the policy has not run.
      Story.when(tracker, bill("b-1", [["l-1", "10"]])),
      Story.rejected(exceeds("l-1", "0", "10")),
      Story.when(tracker, new TrackReceipt({ receiptId: "r-1", lines: lines([["l-1", "10"]]) })),
      Story.then(tracker, receipt("r-1", [["l-1", "10"]])),
      Story.when(tracker, bill("b-1", [["l-1", "10"]])),
      Story.then(tracker, billed("b-1", [["l-1", "10", "10", "60.00"]])),
    ),
  )

  // [BIL-BILL-1]
  it.effect("a return the tracker has not received yet lets a bill take returned goods", () =>
    story(
      Story.given(tracker, confirmed, receipt("r-1", [["l-1", "10"]])),
      // Procurement recorded a return of 4; the policy has not run.
      Story.when(tracker, bill("b-1", [["l-1", "10"]])),
      Story.then(tracker, billed("b-1", [["l-1", "10", "10", "60.00"]])),
      // When the return arrives, billable is -4: the line bills nothing more.
      Story.when(tracker, new TrackReturn({ returnId: "x-1", lines: lines([["l-1", "4"]]) })),
      Story.then(tracker, returned("x-1", [["l-1", "4"]])),
      Story.when(tracker, bill("b-2", [["l-1", "1"]])),
      Story.rejected(exceeds("l-1", "-4", "1")),
    ),
  )

  // [BIL-BILL-1]
  it.effect("an order whose confirmation the tracker lacks is not billed, in either order", () =>
    story(
      Story.given(tracker, receipt("r-1", [["l-1", "10"]])),
      Story.when(tracker, bill("b-1", [["l-1", "10"]])),
      Story.rejected(new PurchaseOrderNotConfirmed()),
      Story.then(tracker),
      Story.when(tracker, new TrackPurchaseConfirmation({ lines: ordered })),
      Story.then(tracker, confirmed),
      Story.when(tracker, bill("b-1", [["l-1", "10"]])),
      Story.then(tracker, billed("b-1", [["l-1", "10", "10", "60.00"]])),
    ),
  )

  // [BIL-BILL-1]
  it.effect("a repeated receipt, return, credit, confirmation, or bill id records nothing", () =>
    story(
      Story.given(tracker, confirmed, receipt("r-1", [["l-1", "10"]])),
      Story.given(
        tracker,
        returned("x-1", [["l-1", "1"]]),
        billed("b-1", [["l-1", "5", "5", "30.00"]]),
      ),
      Story.given(tracker, new CreditTracked({ creditId: "c-1", lines: lines([["l-1", "1"]]) })),
      Story.given(
        feed,
        new PurchaseWasConfirmed({ lines: ordered }),
        new ReceiptWasRecorded({ receiptId: "r-1", lines: lines([["l-1", "10"]]) }),
        new ReturnWasRecorded({ returnId: "x-1", lines: lines([["l-1", "1"]]) }),
      ),
      Story.when(feed, new ConfirmFeedPurchase({ lines: ordered })),
      Story.then(feed),
      Story.when(feed, new RecordFeedReceipt({ receiptId: "r-1", lines: lines([["l-1", "9"]]) })),
      Story.then(feed),
      Story.when(feed, new RecordFeedReturn({ returnId: "x-1", lines: lines([["l-1", "9"]]) })),
      Story.then(feed),
      Story.when(tracker, new TrackPurchaseConfirmation({ lines: ordered })),
      Story.then(tracker),
      Story.when(tracker, new TrackReceipt({ receiptId: "r-1", lines: lines([["l-1", "9"]]) })),
      Story.then(tracker),
      Story.when(tracker, new TrackReturn({ returnId: "x-1", lines: lines([["l-1", "9"]]) })),
      Story.then(tracker),
      Story.when(tracker, new TrackCredit({ creditId: "c-1", lines: lines([["l-1", "9"]]) })),
      Story.then(tracker),
      // Production returns the posted bill for a repeated id; the model records nothing again.
      Story.when(tracker, bill("b-1", [["l-1", "1"]])),
      Story.then(tracker),
    ),
  )
})
