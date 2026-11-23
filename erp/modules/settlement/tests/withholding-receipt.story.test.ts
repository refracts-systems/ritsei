import { assert, describe, it } from "@effect/vitest"
import * as Data from "effect/Data"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  AllocateToInvoice,
  AllocationApplied,
  AllocationExceedsOpen,
  AllocationNoted,
  ApplyReceipt,
  InvalidWithholding,
  InvoiceId,
  InvoiceOpened,
  PostReceiptJournal,
  ReceiptId,
  ReceiptJournal,
  ReceiptJournalPosted,
  ReceiptParked,
  ReceiptRecorded,
  RecordReceipt,
  SettledInvoice,
  SettlementWithholding,
  SettlementWithholdingHandlers,
  WithholdingReceipt,
} from "../src/withholding-receipt-model.ts"

const { Story } = Domain

type Outcome = Data.TaggedEnum<{
  Completed: { readonly result: undefined }
  Rejected: { readonly rejection: AllocationExceedsOpen }
}>

const Outcome = Data.taggedEnum<Outcome>()

const story = Story.make(SettlementWithholding, { layer: SettlementWithholdingHandlers })

const receipt = (id: string) => WithholdingReceipt.ref(ReceiptId.make(id))
const journal = (id: string) => ReceiptJournal.ref(ReceiptId.make(id))
const invoice = (id: string) => SettledInvoice.ref(InvoiceId.make(id))

const split = [
  { invoiceId: "i-1", amount: "60.00" },
  { invoiceId: "i-2", amount: "40.00" },
]

const record = (amount: string, withheld: string, allocations = split) =>
  new RecordReceipt({ amount, withheld, allocations })

const recorded = (amount: string, withheld: string, allocations = split) =>
  new ReceiptRecorded({ amount, withheld, allocations })

const completed = Outcome.Completed({ result: undefined })

describe("a receipt with withholding staged as a saga (SET-WHT-1)", () => {
  it("the model is well defined", () =>
    assert.deepStrictEqual(Domain.verify(SettlementWithholding), []))

  // [SET-WHT-1]
  it.effect("records the receipt, posts cash, claim and receivable, and allocates", () =>
    story(
      Story.given(invoice("i-1"), new InvoiceOpened({ open: "60.00" })),
      Story.given(invoice("i-2"), new InvoiceOpened({ open: "40.00" })),
      Story.when(receipt("r-1"), record("100.00", "2.20")),
      Story.then(receipt("r-1"), recorded("100.00", "2.20")),
      // The worked receipt of production: 97.80 cash, 2.20 withheld, 100.00 receivable.
      Story.then(
        journal("r-1"),
        new ReceiptJournalPosted({
          lines: [
            { account: "bank", debit: "97.80", credit: "0" },
            { account: "claim", debit: "2.20", credit: "0" },
            { account: "receivable", debit: "0", credit: "100.00" },
          ],
        }),
      ),
      Story.then(
        invoice("i-1"),
        new AllocationApplied({ receiptId: "r-1", amount: "60.00", openAfter: "0.00" }),
      ),
      Story.then(receipt("r-1"), new AllocationNoted({ invoiceId: "i-1", amount: "60.00" })),
      Story.then(
        invoice("i-2"),
        new AllocationApplied({ receiptId: "r-1", amount: "40.00", openAfter: "0.00" }),
      ),
      Story.then(receipt("r-1"), new AllocationNoted({ invoiceId: "i-2", amount: "40.00" })),
      Story.saga(ApplyReceipt, receipt("r-1"), completed),
    ),
  )

  // [SET-WHT-1]
  it.effect("a receipt without withholding posts no claim line", () =>
    story(
      Story.given(invoice("i-1"), new InvoiceOpened({ open: "60.00" })),
      Story.when(receipt("r-1"), record("50.00", "0.00", [{ invoiceId: "i-1", amount: "50.00" }])),
      Story.then(
        receipt("r-1"),
        recorded("50.00", "0.00", [{ invoiceId: "i-1", amount: "50.00" }]),
      ),
      Story.then(
        journal("r-1"),
        new ReceiptJournalPosted({
          lines: [
            { account: "bank", debit: "50.00", credit: "0" },
            { account: "receivable", debit: "0", credit: "50.00" },
          ],
        }),
      ),
      Story.then(
        invoice("i-1"),
        new AllocationApplied({ receiptId: "r-1", amount: "50.00", openAfter: "10.00" }),
      ),
      Story.then(receipt("r-1"), new AllocationNoted({ invoiceId: "i-1", amount: "50.00" })),
    ),
  )

  // [SET-WHT-1]
  it.effect("refuses a withholding that is not below the amount, not allocated, or over it", () =>
    story(
      Story.when(receipt("r-1"), record("100.00", "100.00")),
      Story.rejected(new InvalidWithholding({ reason: "not_below_payment" })),
      Story.then(receipt("r-1")),
      Story.when(receipt("r-1"), record("100.00", "2.20", [{ invoiceId: "i-1", amount: "2.19" }])),
      Story.rejected(new InvalidWithholding({ reason: "not_allocated" })),
      Story.then(receipt("r-1")),
      Story.when(
        receipt("r-1"),
        record("100.00", "2.20", [{ invoiceId: "i-1", amount: "100.01" }]),
      ),
      Story.rejected(new InvalidWithholding({ reason: "exceeds_payment" })),
      Story.then(journal("r-1")),
    ),
  )

  // [SET-WHT-1]
  it.effect("a withholding exactly covered by the allocations is accepted", () =>
    story(
      Story.given(invoice("i-1"), new InvoiceOpened({ open: "5.00" })),
      Story.when(receipt("r-1"), record("100.00", "2.20", [{ invoiceId: "i-1", amount: "2.20" }])),
      Story.then(
        receipt("r-1"),
        recorded("100.00", "2.20", [{ invoiceId: "i-1", amount: "2.20" }]),
      ),
      Story.then(
        journal("r-1"),
        new ReceiptJournalPosted({
          lines: [
            { account: "bank", debit: "97.80", credit: "0" },
            { account: "claim", debit: "2.20", credit: "0" },
            { account: "receivable", debit: "0", credit: "100.00" },
          ],
        }),
      ),
      Story.then(
        invoice("i-1"),
        new AllocationApplied({ receiptId: "r-1", amount: "2.20", openAfter: "2.80" }),
      ),
      Story.then(receipt("r-1"), new AllocationNoted({ invoiceId: "i-1", amount: "2.20" })),
    ),
  )

  // [SET-WHT-1]
  it.effect("a document that cannot take its allocation parks the receipt as unapplied cash", () =>
    story(
      Story.given(invoice("i-1"), new InvoiceOpened({ open: "60.00" })),
      Story.given(invoice("i-2"), new InvoiceOpened({ open: "30.00" })),
      Story.when(receipt("r-1"), record("100.00", "2.20")),
      Story.then(receipt("r-1"), recorded("100.00", "2.20")),
      // The cash arrived: the journal stays, and so does the first allocation.
      Story.then(
        journal("r-1"),
        new ReceiptJournalPosted({
          lines: [
            { account: "bank", debit: "97.80", credit: "0" },
            { account: "claim", debit: "2.20", credit: "0" },
            { account: "receivable", debit: "0", credit: "100.00" },
          ],
        }),
      ),
      Story.then(
        invoice("i-1"),
        new AllocationApplied({ receiptId: "r-1", amount: "60.00", openAfter: "0.00" }),
      ),
      Story.then(receipt("r-1"), new AllocationNoted({ invoiceId: "i-1", amount: "60.00" })),
      Story.then(invoice("i-2")),
      Story.then(
        receipt("r-1"),
        new ReceiptParked({ reason: "a document could not take its allocation" }),
      ),
      Story.saga(
        ApplyReceipt,
        receipt("r-1"),
        Outcome.Rejected({
          rejection: new AllocationExceedsOpen({ invoiceId: "i-2", open: "30.00" }),
        }),
      ),
    ),
  )

  // [SET-WHT-1]
  it.effect("a document takes up to its open amount and not one cent more", () =>
    story(
      Story.given(invoice("i-1"), new InvoiceOpened({ open: "40.00" })),
      Story.when(
        invoice("i-1"),
        new AllocateToInvoice({ invoiceId: "i-1", receiptId: "r-1", amount: "40.01" }),
      ),
      Story.rejected(new AllocationExceedsOpen({ invoiceId: "i-1", open: "40.00" })),
      Story.then(invoice("i-1")),
      Story.when(
        invoice("i-1"),
        new AllocateToInvoice({ invoiceId: "i-1", receiptId: "r-1", amount: "40.00" }),
      ),
      Story.then(
        invoice("i-1"),
        new AllocationApplied({ receiptId: "r-1", amount: "40.00", openAfter: "0.00" }),
      ),
    ),
  )

  // [SET-WHT-1]
  it.effect("a repeated receipt, allocation or journal changes nothing", () =>
    story(
      Story.given(receipt("r-1"), recorded("100.00", "2.20")),
      Story.when(receipt("r-1"), record("999.00", "1.00")),
      Story.then(receipt("r-1")),
      Story.given(invoice("i-1"), new InvoiceOpened({ open: "60.00" })),
      Story.given(
        invoice("i-1"),
        new AllocationApplied({ receiptId: "r-1", amount: "60.00", openAfter: "0.00" }),
      ),
      Story.when(
        invoice("i-1"),
        new AllocateToInvoice({ invoiceId: "i-1", receiptId: "r-1", amount: "60.00" }),
      ),
      Story.then(invoice("i-1")),
      Story.given(journal("r-1"), new ReceiptJournalPosted({ lines: [] })),
      Story.when(journal("r-1"), new PostReceiptJournal({ lines: [] })),
      Story.then(journal("r-1")),
    ),
  )
})
