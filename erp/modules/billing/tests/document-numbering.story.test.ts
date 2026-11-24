import { assert, describe, it } from "@effect/vitest"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  ApplyTax,
  AssignNumber,
  AllocateNumber,
  BillingDocument,
  BillingDocumentNumbering,
  BillingDocumentNumberingHandlers,
  BillingSeries,
  DocumentId,
  DocumentJournal,
  DocumentMarkedPosted,
  DocumentNumbered,
  DocumentRecorded,
  DocumentTaxed,
  JournalId,
  JournalPosted,
  MarkPosted,
  NumberAllocated,
  PostJournal,
  RecordDocument,
  seriesId,
  type Kind,
} from "../src/document-numbering-model.ts"

const { Story } = Domain

const story = Story.make(BillingDocumentNumbering, { layer: BillingDocumentNumberingHandlers })

const document = (id: string) => BillingDocument.ref(DocumentId.make(id))
const journal = (id: string) => DocumentJournal.ref(JournalId.make(`document/${id}`))

const series = (entity: string, kind: Kind, date: string) =>
  BillingSeries.ref(seriesId(entity, kind, date))

type Line = { net: string; taxCode: string }

const standard = (net: string): Line => ({ net, taxCode: "standard" })
const exempt = (net: string): Line => ({ net, taxCode: "exempt" })

type Plan = {
  id: string
  kind: Kind
  entity: string
  date: string
  taxDate?: string
  lines: ReadonlyArray<Line>
  value: number
  number: string
  subtotal: string
  taxTotal: string
  total: string
  journal: ReadonlyArray<readonly [string, string, string]>
}

const recordCommand = (plan: Plan) => {
  const base = {
    kind: plan.kind,
    legalEntityId: plan.entity,
    documentDate: plan.date,
    lines: plan.lines,
  }

  return plan.taxDate === undefined
    ? new RecordDocument(base)
    : new RecordDocument({ ...base, taxDate: plan.taxDate })
}

/** Records a document and states every step that follows it, in the order they commit. */
const recordAndFollow = (plan: Plan) => [
  Story.when(document(plan.id), recordCommand(plan)),
  Story.then(
    document(plan.id),
    new DocumentRecorded({
      kind: plan.kind,
      legalEntityId: plan.entity,
      documentDate: plan.date,
      taxDate: plan.taxDate ?? plan.date,
      lines: plan.lines,
    }),
    new DocumentTaxed({
      kind: plan.kind,
      legalEntityId: plan.entity,
      documentDate: plan.date,
      subtotal: plan.subtotal,
      taxTotal: plan.taxTotal,
      total: plan.total,
    }),
    new DocumentNumbered({
      number: plan.number,
      kind: plan.kind,
      documentDate: plan.date,
      subtotal: plan.subtotal,
      taxTotal: plan.taxTotal,
      total: plan.total,
    }),
    new DocumentMarkedPosted({ number: plan.number }),
  ),
  Story.then(
    series(plan.entity, plan.kind, plan.date),
    new NumberAllocated({ documentId: plan.id, value: plan.value }),
  ),
  Story.then(
    journal(plan.id),
    new JournalPosted({
      documentId: plan.id,
      postingDate: plan.date,
      description: plan.number,
      lines: plan.journal.map(([role, debit, credit]) => ({ role, debit, credit })),
    }),
  ),
]

const invoice = (id: string, value: number, overrides: Partial<Plan> = {}): Plan => ({
  id,
  kind: "customer_invoice",
  entity: "le-1",
  date: "2026-03-10",
  lines: [standard("100.00"), exempt("50.00")],
  value,
  number: `INV/2026/0000${value}`,
  subtotal: "150.00",
  taxTotal: "10.00",
  total: "160.00",
  journal: [
    ["receivable", "160.00", "0"],
    ["revenue", "0", "150.00"],
    ["output_tax", "0", "10.00"],
  ],
  ...overrides,
})

const recordedInvoice = new DocumentRecorded({
  kind: "customer_invoice",
  legalEntityId: "le-1",
  documentDate: "2026-03-10",
  taxDate: "2026-03-10",
  lines: [standard("100.00"), exempt("50.00")],
})

const taxedInvoice = new DocumentTaxed({
  kind: "customer_invoice",
  legalEntityId: "le-1",
  documentDate: "2026-03-10",
  subtotal: "150.00",
  taxTotal: "10.00",
  total: "160.00",
})

const numberedInvoice = (number: string) =>
  new DocumentNumbered({
    number,
    kind: "customer_invoice",
    documentDate: "2026-03-10",
    subtotal: "150.00",
    taxTotal: "10.00",
    total: "160.00",
  })

describe("billing documents numbered, taxed, and posted in steps (BIL-DOC-1)", () => {
  it("the model is well defined", () =>
    assert.deepStrictEqual(Domain.verify(BillingDocumentNumbering), []))

  // [BIL-DOC-1]
  it.effect("a recorded invoice is taxed, numbered, journaled, and marked posted", () =>
    story(...recordAndFollow(invoice("d-1", 1))),
  )

  // [BIL-DOC-1]
  it.effect(
    "tax uses the rate of the document date, and a credit note that of the credited one",
    () =>
      story(
        // Dated after the rate change, an invoice is taxed at 11%.
        ...recordAndFollow(
          invoice("d-1", 1, {
            date: "2026-08-15",
            lines: [standard("100.00")],
            number: "INV/2026/00001",
            subtotal: "100.00",
            taxTotal: "11.00",
            total: "111.00",
            journal: [
              ["receivable", "111.00", "0"],
              ["revenue", "0", "100.00"],
              ["output_tax", "0", "11.00"],
            ],
          }),
        ),
        // A credit note dated after it takes the tax date of the invoice it credits: 10%.
        ...recordAndFollow(
          invoice("d-2", 1, {
            kind: "customer_credit_note",
            date: "2026-08-15",
            taxDate: "2026-03-10",
            lines: [standard("100.00")],
            number: "CN/2026/00001",
            subtotal: "100.00",
            taxTotal: "10.00",
            total: "110.00",
            journal: [
              ["receivable", "0", "110.00"],
              ["revenue", "100.00", "0"],
              ["output_tax", "10.00", "0"],
            ],
          }),
        ),
      ),
  )

  // [BIL-DOC-1]
  it.effect("supplier bills and credit notes post on the payable side, at their own numbers", () =>
    story(
      ...recordAndFollow(
        invoice("b-1", 1, {
          kind: "supplier_bill",
          date: "2026-08-15",
          lines: [standard("100.00")],
          number: "BILL/2026/00001",
          subtotal: "100.00",
          taxTotal: "11.00",
          total: "111.00",
          journal: [
            ["expense", "100.00", "0"],
            ["input_tax", "11.00", "0"],
            ["payable", "0", "111.00"],
          ],
        }),
      ),
      ...recordAndFollow(
        invoice("n-1", 1, {
          kind: "supplier_credit_note",
          date: "2026-08-15",
          taxDate: "2026-08-15",
          lines: [standard("100.00")],
          number: "DN/2026/00001",
          subtotal: "100.00",
          taxTotal: "11.00",
          total: "111.00",
          journal: [
            ["expense", "0", "100.00"],
            ["input_tax", "0", "11.00"],
            ["payable", "111.00", "0"],
          ],
        }),
      ),
    ),
  )

  // [BIL-DOC-1]
  it.effect("tax is taken per line and rounded half up", () =>
    story(
      ...recordAndFollow(
        invoice("d-1", 1, {
          lines: [standard("0.05"), standard("0.05")],
          subtotal: "0.10",
          taxTotal: "0.02",
          total: "0.12",
          journal: [
            ["receivable", "0.12", "0"],
            ["revenue", "0", "0.10"],
            ["output_tax", "0", "0.02"],
          ],
        }),
      ),
    ),
  )

  // [BIL-DOC-1]
  it.effect("each series is per legal entity, kind, and year, and counts one by one", () =>
    story(
      ...recordAndFollow(invoice("d-1", 1)),
      ...recordAndFollow(invoice("d-2", 2)),
      // Another legal entity, another kind, and the next year each start at 1.
      ...recordAndFollow(invoice("d-3", 1, { entity: "le-2" })),
      ...recordAndFollow(
        invoice("d-4", 1, {
          kind: "customer_credit_note",
          number: "CN/2026/00001",
          journal: [
            ["receivable", "0", "160.00"],
            ["revenue", "150.00", "0"],
            ["output_tax", "10.00", "0"],
          ],
        }),
      ),
      // After the rate change the standard line is taxed at 11%.
      ...recordAndFollow(
        invoice("d-5", 1, {
          date: "2027-01-05",
          number: "INV/2027/00001",
          taxTotal: "11.00",
          total: "161.00",
          journal: [
            ["receivable", "161.00", "0"],
            ["revenue", "0", "150.00"],
            ["output_tax", "0", "11.00"],
          ],
        }),
      ),
    ),
  )

  // [BIL-DOC-1]
  it.effect(
    "a repeated document id records nothing, takes no number, and posts no second journal",
    () =>
      story(
        Story.given(
          document("d-1"),
          recordedInvoice,
          taxedInvoice,
          numberedInvoice("INV/2026/00001"),
          new DocumentMarkedPosted({ number: "INV/2026/00001" }),
        ),
        Story.given(
          series("le-1", "customer_invoice", "2026-03-10"),
          new NumberAllocated({ documentId: "d-1", value: 1 }),
        ),
        Story.given(
          journal("d-1"),
          new JournalPosted({
            documentId: "d-1",
            postingDate: "2026-03-10",
            description: "INV/2026/00001",
            lines: [],
          }),
        ),
        Story.when(
          document("d-1"),
          new RecordDocument({
            kind: "customer_invoice",
            legalEntityId: "le-1",
            documentDate: "2026-03-10",
            lines: [standard("999.00")],
          }),
        ),
        Story.then(document("d-1")),
        Story.when(
          series("le-1", "customer_invoice", "2026-03-10"),
          new AllocateNumber({ documentId: "d-1" }),
        ),
        Story.then(series("le-1", "customer_invoice", "2026-03-10")),
        Story.when(
          journal("d-1"),
          new PostJournal({
            documentId: "d-1",
            postingDate: "2026-04-01",
            description: "x",
            lines: [],
          }),
        ),
        Story.then(journal("d-1")),
      ),
  )

  // [BIL-DOC-1]
  it.effect("a document keeps its first number, and takes none before it is taxed", () =>
    story(
      Story.given(document("d-1"), recordedInvoice),
      // Recorded but not taxed: a number offered now is refused, and a mark of posted too.
      Story.when(document("d-1"), new AssignNumber({ number: "INV/2026/00007" })),
      Story.then(document("d-1")),
      Story.when(document("d-1"), new MarkPosted({})),
      Story.then(document("d-1")),
      Story.given(document("d-1"), taxedInvoice),
      // Taxed but not numbered: it cannot be marked posted.
      Story.when(document("d-1"), new MarkPosted({})),
      Story.then(document("d-1")),
      Story.given(document("d-1"), numberedInvoice("INV/2026/00001")),
      Story.when(document("d-1"), new AssignNumber({ number: "INV/2026/00009" })),
      Story.then(document("d-1")),
    ),
  )

  // [BIL-DOC-1]
  it.effect(
    "an unrecorded document takes no number, and a tax step that does not fit is refused",
    () =>
      story(
        // Nothing recorded: tax, number, and posting do nothing, and the series stays untouched.
        Story.when(document("d-1"), new ApplyTax({ taxes: ["10.00"] })),
        Story.then(document("d-1")),
        Story.then(series("le-1", "customer_invoice", "2026-03-10")),
        Story.given(document("d-2"), recordedInvoice),
        // Two lines but one tax: not applied, so the document stays untaxed and unnumbered.
        Story.when(document("d-2"), new ApplyTax({ taxes: ["10.00"] })),
        Story.then(document("d-2")),
        Story.then(series("le-1", "customer_invoice", "2026-03-10")),
        // No lines and no taxes still takes no tax step before the document is recorded.
        Story.when(document("d-3"), new ApplyTax({ taxes: [] })),
        Story.then(document("d-3")),
        // A taxed document is not taxed again.
        Story.given(document("d-4"), recordedInvoice, taxedInvoice),
        Story.when(document("d-4"), new ApplyTax({ taxes: ["10.00", "0.00"] })),
        Story.then(document("d-4")),
      ),
  )

  // [BIL-DOC-1]
  it.effect("an exempt invoice posts no tax line", () =>
    story(
      ...recordAndFollow(
        invoice("d-1", 1, {
          lines: [exempt("50.00")],
          subtotal: "50.00",
          taxTotal: "0.00",
          total: "50.00",
          journal: [
            ["receivable", "50.00", "0"],
            ["revenue", "0", "50.00"],
          ],
        }),
      ),
    ),
  )
})
