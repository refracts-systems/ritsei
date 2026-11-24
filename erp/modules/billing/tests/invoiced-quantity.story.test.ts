import { assert, describe, it } from "@effect/vitest"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  BillingInvoicing,
  BillingInvoicingHandlers,
  CompleteFeedDelivery,
  ConfirmationTracked,
  ConfirmFeedOrder,
  DeliveryTracked,
  DeliveryWasCompleted,
  FeedOrder,
  InvoiceJournal,
  InvoiceJournalId,
  InvoiceJournalPosted,
  InvoicedOrder,
  InvoiceOrder,
  InvoiceRecorded,
  NothingToInvoice,
  OrderNotConfirmed,
  OrderWasConfirmed,
  PostInvoiceJournal,
  SalesOrderId,
  TrackConfirmation,
  TrackDelivery,
  TrackedOrderId,
} from "../src/invoiced-quantity-model.ts"

const { Story } = Domain

const story = Story.make(BillingInvoicing, { layer: BillingInvoicingHandlers })

const feed = FeedOrder.ref(SalesOrderId.make("so-1"))
const tracker = InvoicedOrder.ref(TrackedOrderId.make("so-1"))

const journal = (invoiceId: string) =>
  InvoiceJournal.ref(InvoiceJournalId.make(`invoice/${invoiceId}`))

// Line 1: 10.00 with 10% tax. Line 2: 5.00 without tax.
const priced = [
  { lineId: "l-1", unitPrice: "10.00", taxBps: 1000 },
  { lineId: "l-2", unitPrice: "5.00", taxBps: 0 },
]

const delivery = (deliveryId: string, items: ReadonlyArray<readonly [string, string]>) => ({
  deliveryId,
  lines: items.map(([lineId, quantity]) => ({ lineId, quantity })),
})

const confirmedFeed = new OrderWasConfirmed({ lines: priced })
const tracked = new ConfirmationTracked({ lines: priced })

const trackedDelivery = (deliveryId: string, items: ReadonlyArray<readonly [string, string]>) =>
  new DeliveryTracked(delivery(deliveryId, items))

const completedDelivery = (deliveryId: string, items: ReadonlyArray<readonly [string, string]>) =>
  new DeliveryWasCompleted(delivery(deliveryId, items))

const invoice = (
  invoiceId: string,
  items: ReadonlyArray<readonly [string, string, string, string]>,
  amounts: { subtotal: string; taxTotal: string; total: string },
) =>
  new InvoiceRecorded({
    invoiceId,
    lines: items.map(([lineId, quantity, net, tax]) => ({ lineId, quantity, net, tax })),
    ...amounts,
  })

const posted = (amounts: { subtotal: string; taxTotal: string; total: string }) =>
  new InvoiceJournalPosted({
    lines: [
      { role: "receivable", debit: amounts.total, credit: "0" },
      { role: "revenue", debit: "0", credit: amounts.subtotal },
      { role: "output_tax", debit: "0", credit: amounts.taxTotal },
    ],
  })

const forty = { subtotal: "40.00", taxTotal: "4.00", total: "44.00" }

describe("customer invoices staged on a tracker (BIL-INV-1)", () => {
  it("the model is well defined", () => assert.deepStrictEqual(Domain.verify(BillingInvoicing), []))

  // [BIL-INV-1]
  it.effect(
    "a delivery reaches the tracker and is invoiced at the order price, then journaled",
    () =>
      story(
        Story.when(feed, new ConfirmFeedOrder({ lines: priced })),
        Story.then(feed, confirmedFeed),
        Story.then(tracker, tracked),
        Story.when(feed, new CompleteFeedDelivery(delivery("d-1", [["l-1", "4"]]))),
        Story.then(feed, completedDelivery("d-1", [["l-1", "4"]])),
        Story.then(tracker, trackedDelivery("d-1", [["l-1", "4"]])),
        Story.when(tracker, new InvoiceOrder({ invoiceId: "i-1" })),
        Story.then(tracker, invoice("i-1", [["l-1", "4", "40.00", "4.00"]], forty)),
        Story.then(journal("i-1"), posted(forty)),
      ),
  )

  // [BIL-INV-1]
  it.effect("each invoice bills what was delivered since the last, and nothing twice", () =>
    story(
      Story.given(tracker, tracked, trackedDelivery("d-1", [["l-1", "4"]])),
      Story.when(tracker, new InvoiceOrder({ invoiceId: "i-1" })),
      Story.then(tracker, invoice("i-1", [["l-1", "4", "40.00", "4.00"]], forty)),
      Story.then(journal("i-1"), posted(forty)),
      Story.when(tracker, new InvoiceOrder({ invoiceId: "i-2" })),
      Story.rejected(new NothingToInvoice()),
      // A second delivery, of both lines, bills only what is new.
      Story.given(
        tracker,
        trackedDelivery("d-2", [
          ["l-1", "1"],
          ["l-2", "2"],
        ]),
      ),
      Story.when(tracker, new InvoiceOrder({ invoiceId: "i-3" })),
      Story.then(
        tracker,
        invoice(
          "i-3",
          [
            ["l-1", "1", "10.00", "1.00"],
            ["l-2", "2", "10.00", "0.00"],
          ],
          { subtotal: "20.00", taxTotal: "1.00", total: "21.00" },
        ),
      ),
      Story.then(journal("i-3"), posted({ subtotal: "20.00", taxTotal: "1.00", total: "21.00" })),
    ),
  )

  // [BIL-INV-1]
  it.effect("two invoices for the same deliveries post once: the tracker serializes them", () =>
    story(
      Story.given(tracker, tracked, trackedDelivery("d-1", [["l-1", "4"]])),
      Story.when(tracker, new InvoiceOrder({ invoiceId: "i-1" })),
      Story.then(tracker, invoice("i-1", [["l-1", "4", "40.00", "4.00"]], forty)),
      Story.then(journal("i-1"), posted(forty)),
      // The second caller, with its own id, finds nothing left and posts no journal.
      Story.when(tracker, new InvoiceOrder({ invoiceId: "i-2" })),
      Story.rejected(new NothingToInvoice()),
      Story.then(journal("i-2")),
    ),
  )

  // [BIL-INV-1]
  it.effect("a delivery the tracker has not received yet is not invoiceable: the lag state", () =>
    story(
      Story.given(feed, confirmedFeed, completedDelivery("d-1", [["l-1", "4"]])),
      Story.given(tracker, tracked),
      // Sales recorded the delivery; the policy has not run.
      Story.when(tracker, new InvoiceOrder({ invoiceId: "i-1" })),
      Story.rejected(new NothingToInvoice()),
      Story.when(tracker, new TrackDelivery(delivery("d-1", [["l-1", "4"]]))),
      Story.then(tracker, trackedDelivery("d-1", [["l-1", "4"]])),
      Story.when(tracker, new InvoiceOrder({ invoiceId: "i-1" })),
      Story.then(tracker, invoice("i-1", [["l-1", "4", "40.00", "4.00"]], forty)),
      Story.then(journal("i-1"), posted(forty)),
    ),
  )

  // [BIL-INV-1]
  it.effect("an order whose confirmation the tracker lacks is not invoiced, in either order", () =>
    story(
      Story.given(tracker, trackedDelivery("d-1", [["l-1", "4"]])),
      Story.when(tracker, new InvoiceOrder({ invoiceId: "i-1" })),
      Story.rejected(new OrderNotConfirmed()),
      Story.then(tracker),
      // The confirmation arrives after the delivery: the delivery was kept.
      Story.when(tracker, new TrackConfirmation({ lines: priced })),
      Story.then(tracker, tracked),
      Story.when(tracker, new InvoiceOrder({ invoiceId: "i-1" })),
      Story.then(tracker, invoice("i-1", [["l-1", "4", "40.00", "4.00"]], forty)),
      Story.then(journal("i-1"), posted(forty)),
    ),
  )

  // [BIL-INV-1]
  it.effect("a confirmed order with no delivery has nothing to invoice", () =>
    story(
      Story.given(tracker, tracked),
      Story.when(tracker, new InvoiceOrder({ invoiceId: "i-1" })),
      Story.rejected(new NothingToInvoice()),
      Story.then(tracker),
    ),
  )

  // [BIL-INV-1]
  it.effect("a repeated delivery, confirmation, or invoice id records nothing", () =>
    story(
      Story.given(feed, confirmedFeed, completedDelivery("d-1", [["l-1", "4"]])),
      Story.when(feed, new ConfirmFeedOrder({ lines: priced })),
      Story.then(feed),
      Story.when(feed, new CompleteFeedDelivery(delivery("d-1", [["l-1", "4"]]))),
      Story.then(feed),
      Story.given(tracker, tracked, trackedDelivery("d-1", [["l-1", "4"]])),
      Story.when(tracker, new TrackConfirmation({ lines: priced })),
      Story.then(tracker),
      Story.when(tracker, new TrackDelivery(delivery("d-1", [["l-1", "9"]]))),
      Story.then(tracker),
      Story.given(tracker, invoice("i-1", [["l-1", "4", "40.00", "4.00"]], forty)),
      // Production returns the posted invoice for a repeated id; the model records nothing again.
      Story.when(tracker, new InvoiceOrder({ invoiceId: "i-1" })),
      Story.then(tracker),
    ),
  )

  // [BIL-INV-1]
  it.effect("tax is taken per line and rounded half up", () =>
    story(
      Story.given(
        tracker,
        new ConfirmationTracked({ lines: [{ lineId: "l-1", unitPrice: "0.05", taxBps: 1000 }] }),
        trackedDelivery("d-1", [["l-1", "1"]]),
      ),
      Story.when(tracker, new InvoiceOrder({ invoiceId: "i-1" })),
      // 0.05 at 10% is 0.005, which rounds up to 0.01.
      Story.then(
        tracker,
        invoice("i-1", [["l-1", "1", "0.05", "0.01"]], {
          subtotal: "0.05",
          taxTotal: "0.01",
          total: "0.06",
        }),
      ),
      Story.then(journal("i-1"), posted({ subtotal: "0.05", taxTotal: "0.01", total: "0.06" })),
    ),
  )

  // [BIL-INV-1]
  it.effect("the journal of one invoice posts once", () =>
    story(
      Story.given(journal("i-1"), posted(forty)),
      Story.when(
        journal("i-1"),
        new PostInvoiceJournal({ lines: [{ role: "receivable", debit: "1.00", credit: "0" }] }),
      ),
      Story.then(journal("i-1")),
    ),
  )
})
