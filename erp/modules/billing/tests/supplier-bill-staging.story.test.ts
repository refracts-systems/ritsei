import { assert, describe, it } from "@effect/vitest"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  AcceptCredit,
  BillableRestored,
  BillId,
  BillingJournal,
  BillingSupplierDocuments,
  BillingSupplierDocumentsHandlers,
  BillNotRecorded,
  BillRecorded,
  CreditAccepted,
  CreditApplication,
  CreditApplied,
  CreditExceedsInvoice,
  CreditId,
  JournalPosted,
  JournalRef,
  PostJournal,
  PurchaseLineId,
  PurchaseLineMatching,
  RecordBill,
  RestoreBillable,
  StagedBill,
} from "../src/supplier-bill-staging-model.ts"

const { Story } = Domain

const story = Story.make(BillingSupplierDocuments, { layer: BillingSupplierDocumentsHandlers })

const bill = (id: string) => StagedBill.ref(BillId.make(id))
const journal = (ref: string) => BillingJournal.ref(JournalRef.make(ref))
const purchaseLine = (id: string) => PurchaseLineMatching.ref(PurchaseLineId.make(id))
const application = (id: string) => CreditApplication.ref(CreditId.make(id))

// Two lines: 10 units matched at 100.00 and 5 units matched at 50.00.
const lines = [
  { id: "l-1", quantity: "10", matchedValue: "100.00", purchaseOrderLineId: "p-1" },
  { id: "l-2", quantity: "5", matchedValue: "50.00", purchaseOrderLineId: "p-2" },
]

const amounts = { subtotal: "160.00", taxTotal: "16.00", total: "176.00", matched: "150.00" }

const recorded = new BillRecorded({ ...amounts, lines })

const credit = (
  creditId: string,
  total: { subtotal: string; taxTotal: string; total: string },
  items: ReadonlyArray<readonly [string, string]>,
) =>
  new AcceptCredit({
    creditId,
    ...total,
    matched: "0.00",
    lines: items.map(([invoiceLineId, quantity]) => ({ invoiceLineId, quantity })),
  })

const accepted = (
  creditId: string,
  total: { subtotal: string; taxTotal: string; total: string },
  matched: string,
  items: ReadonlyArray<readonly [string, string, string, string]>,
  applied: string,
  openAfter: string,
) =>
  new CreditAccepted({
    creditId,
    ...total,
    matched,
    lines: items.map(([invoiceLineId, purchaseOrderLineId, quantity, share]) => ({
      invoiceLineId,
      purchaseOrderLineId,
      quantity,
      share,
    })),
    applied,
    openAfter,
  })

const forty = { subtotal: "44.00", taxTotal: "4.40", total: "48.40" }

describe("supplier bills and credit notes staged (BIL-BILL-3, BIL-CREDIT-1)", () => {
  it("the model is well defined", () =>
    assert.deepStrictEqual(Domain.verify(BillingSupplierDocuments), []))

  // [BIL-BILL-3]
  it.effect("a bill posts GRNI at the matched value and the rest of the subtotal as variance", () =>
    story(
      Story.when(bill("b-1"), new RecordBill({ ...amounts, lines })),
      Story.then(bill("b-1"), recorded),
      Story.then(
        journal("bill/b-1"),
        new JournalPosted({
          lines: [
            { role: "goods_received_not_invoiced", debit: "150.00", credit: "0" },
            { role: "purchase_price_variance", debit: "10.00", credit: "0" },
            { role: "input_tax", debit: "16.00", credit: "0" },
            { role: "payable", debit: "0", credit: "176.00" },
          ],
        }),
      ),
    ),
  )

  // [BIL-BILL-3]
  it.effect("a bill priced below the matched value credits the variance", () =>
    story(
      Story.when(
        bill("b-1"),
        new RecordBill({
          subtotal: "140.00",
          taxTotal: "14.00",
          total: "154.00",
          matched: "150.00",
          lines,
        }),
      ),
      Story.then(
        bill("b-1"),
        new BillRecorded({
          subtotal: "140.00",
          taxTotal: "14.00",
          total: "154.00",
          matched: "150.00",
          lines,
        }),
      ),
      Story.then(
        journal("bill/b-1"),
        new JournalPosted({
          lines: [
            { role: "goods_received_not_invoiced", debit: "150.00", credit: "0" },
            { role: "purchase_price_variance", debit: "0", credit: "10.00" },
            { role: "input_tax", debit: "14.00", credit: "0" },
            { role: "payable", debit: "0", credit: "154.00" },
          ],
        }),
      ),
    ),
  )

  // [BIL-BILL-3]
  it.effect("a repeated bill and a repeated journal post once", () =>
    story(
      Story.given(bill("b-1"), recorded),
      Story.when(bill("b-1"), new RecordBill({ ...amounts, subtotal: "1.00", lines })),
      Story.then(bill("b-1")),
      Story.given(journal("bill/b-1"), new JournalPosted({ lines: [] })),
      Story.when(journal("bill/b-1"), new PostJournal({ lines: [] })),
      Story.then(journal("bill/b-1")),
    ),
  )

  // [BIL-CREDIT-1]
  it.effect(
    "a credit note reverses the journal, applies to the open amount, and returns quantity",
    () =>
      story(
        Story.given(bill("b-1"), recorded),
        Story.when(bill("b-1"), credit("c-1", forty, [["l-1", "4"]])),
        Story.then(
          bill("b-1"),
          accepted("c-1", forty, "40.00", [["l-1", "p-1", "4", "40.00"]], "48.40", "127.60"),
        ),
        Story.then(
          journal("credit/c-1"),
          new JournalPosted({
            lines: [
              { role: "payable", debit: "48.40", credit: "0" },
              { role: "goods_received_not_invoiced", debit: "0", credit: "40.00" },
              { role: "purchase_price_variance", debit: "0", credit: "4.00" },
              { role: "input_tax", debit: "0", credit: "4.40" },
            ],
          }),
        ),
        Story.then(purchaseLine("p-1"), new BillableRestored({ creditId: "c-1", quantity: "4" })),
        Story.then(application("c-1"), new CreditApplied()),
      ),
  )

  // [BIL-CREDIT-1]
  it.effect("credits never exceed what is left of a line, across credit notes", () =>
    story(
      Story.given(bill("b-1"), recorded),
      Story.when(bill("b-1"), credit("c-1", forty, [["l-1", "11"]])),
      Story.rejected(new CreditExceedsInvoice({ invoiceLineId: "l-1", available: "10" })),
      Story.then(bill("b-1")),
      Story.given(
        bill("b-1"),
        accepted("c-0", forty, "70.00", [["l-1", "p-1", "7", "70.00"]], "48.40", "127.60"),
      ),
      Story.when(bill("b-1"), credit("c-1", forty, [["l-1", "4"]])),
      Story.rejected(new CreditExceedsInvoice({ invoiceLineId: "l-1", available: "3" })),
      Story.when(bill("b-1"), credit("c-2", forty, [["l-9", "1"]])),
      Story.rejected(new CreditExceedsInvoice({ invoiceLineId: "l-9", available: "0" })),
    ),
  )

  // [BIL-CREDIT-1]
  it.effect("the last units take what is left of the matched value, so none is stranded", () =>
    story(
      Story.given(
        bill("b-1"),
        new BillRecorded({
          ...amounts,
          lines: [{ id: "l-1", quantity: "3", matchedValue: "100.00", purchaseOrderLineId: "p-1" }],
        }),
        accepted("c-0", forty, "66.67", [["l-1", "p-1", "2", "66.67"]], "48.40", "127.60"),
      ),
      Story.when(bill("b-1"), credit("c-1", forty, [["l-1", "1"]])),
      Story.then(
        bill("b-1"),
        accepted("c-1", forty, "33.33", [["l-1", "p-1", "1", "33.33"]], "48.40", "79.20"),
      ),
      Story.then(
        journal("credit/c-1"),
        new JournalPosted({
          lines: [
            { role: "payable", debit: "48.40", credit: "0" },
            { role: "goods_received_not_invoiced", debit: "0", credit: "33.33" },
            { role: "purchase_price_variance", debit: "0", credit: "10.67" },
            { role: "input_tax", debit: "0", credit: "4.40" },
          ],
        }),
      ),
      Story.then(purchaseLine("p-1"), new BillableRestored({ creditId: "c-1", quantity: "1" })),
      Story.then(application("c-1"), new CreditApplied()),
    ),
  )

  // [BIL-CREDIT-1]
  it.effect("a credit above the open amount applies the open amount and leaves the rest", () =>
    story(
      Story.given(bill("b-1"), new BillRecorded({ ...amounts, total: "20.00", lines })),
      Story.when(bill("b-1"), credit("c-1", forty, [["l-1", "4"]])),
      Story.then(
        bill("b-1"),
        accepted("c-1", forty, "40.00", [["l-1", "p-1", "4", "40.00"]], "20.00", "0.00"),
      ),
      Story.then(
        journal("credit/c-1"),
        new JournalPosted({
          lines: [
            { role: "payable", debit: "48.40", credit: "0" },
            { role: "goods_received_not_invoiced", debit: "0", credit: "40.00" },
            { role: "purchase_price_variance", debit: "0", credit: "4.00" },
            { role: "input_tax", debit: "0", credit: "4.40" },
          ],
        }),
      ),
      Story.then(purchaseLine("p-1"), new BillableRestored({ creditId: "c-1", quantity: "4" })),
      Story.then(application("c-1"), new CreditApplied()),
    ),
  )

  // [BIL-CREDIT-1]
  it.effect("a repeated credit note id changes nothing", () =>
    story(
      Story.given(
        bill("b-1"),
        recorded,
        accepted("c-1", forty, "40.00", [["l-1", "p-1", "4", "40.00"]], "48.40", "127.60"),
      ),
      Story.when(bill("b-1"), credit("c-1", forty, [["l-1", "9"]])),
      Story.then(bill("b-1")),
      Story.given(purchaseLine("p-1"), new BillableRestored({ creditId: "c-1", quantity: "4" })),
      Story.when(purchaseLine("p-1"), new RestoreBillable({ creditId: "c-1", quantity: "4" })),
      Story.then(purchaseLine("p-1")),
    ),
  )

  // [BIL-CREDIT-1]
  it.effect("a credit note for a bill that is not recorded yet is refused", () =>
    story(
      Story.when(bill("b-1"), credit("c-1", forty, [["l-1", "4"]])),
      Story.rejected(new BillNotRecorded()),
      Story.then(bill("b-1")),
    ),
  )
})
