/**
 * A billing document numbered, taxed, and posted in steps, staged for ADR-0124 phase 5
 * (`BIL-DOC-1`). Production does all three in the transaction that records the document: tax at the
 * document's tax date, then the next number of the gapless series of the legal entity and kind, then
 * the journal at the document date (ADR-0095). On the Effect Cluster host the document, the series,
 * and the journal commit separately, so each becomes a later step. This model states that staging
 * and nothing else; there is no cutover.
 *
 * - **The document records first, then each step follows the one before.** Tax, then the number,
 *   then the journal, then the document is marked posted, each a policy on the previous event.
 * - **A number is allocated only for a taxed document.** A document that never recorded or never
 *   taxed asks for no number, so the series has no hole where a failure was: it stays gapless
 *   without a rollback and without voided numbers.
 * - **Tax uses the tax date on the record,** the document date or, for a credit note, the credited
 *   document's date, so a step that runs after a rate period starts keeps the rate of its date.
 * - **The journal posts at the document date** and is posted once per document.
 * - **Every step is idempotent:** a repeated document id records nothing, the series gives a
 *   document the number it already holds, and a document keeps its first number.
 * - **A recorded document can be unnumbered and unposted for a moment.** Reports see it recorded
 *   before they see its number; the accounting owner and a fiscal reviewer decide whether that is
 *   acceptable for legal documents.
 *
 * Not modelled: the Tax module's rate lookup beyond a two-period stand-in, the matched value of a
 * supplier bill (`BIL-BILL-3`), the open amount, the fiscal calendar (the series restarts each
 * calendar year), and the capability. Test-only: not exported from `mod.ts`.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  formatSignedMinor,
  requireExactMajorToMinor,
} from "../../../../framework/foundation/mod.ts"

const minor = (value: string) => requireExactMajorToMinor(value, 2)
const major = (value: bigint) => formatSignedMinor(value, 2)

// ---------------------------------------------------------------- kinds and stand-ins

export const Kind = Schema.Literals([
  "customer_invoice",
  "customer_credit_note",
  "supplier_bill",
  "supplier_credit_note",
])

export type Kind = typeof Kind.Type

const prefixes: Record<Kind, string> = {
  customer_invoice: "INV/",
  customer_credit_note: "CN/",
  supplier_bill: "BILL/",
  supplier_credit_note: "DN/",
}

/** The standard rate changes on 2026-07-01, so a step that ignored the tax date would show. */
export const rateBps = (taxCode: string, date: string) =>
  taxCode === "exempt" ? 0 : date >= "2026-07-01" ? 1100 : 1000

/** Whole basis points, rounded half up. */
export const taxOf = (net: string, bps: number) =>
  major((minor(net) * BigInt(bps) + 5000n) / 10000n)

const Line = Schema.Struct({ net: Schema.String, taxCode: Schema.String })

const JournalLine = Schema.Struct({
  role: Schema.String,
  debit: Schema.String,
  credit: Schema.String,
})

type JournalLine = typeof JournalLine.Type

const sideLines = (kind: Kind, subtotal: string, taxTotal: string, total: string) => {
  const forward: ReadonlyArray<JournalLine> =
    kind === "customer_invoice" || kind === "customer_credit_note"
      ? [
          { role: "receivable", debit: total, credit: "0" },
          { role: "revenue", debit: "0", credit: subtotal },
          { role: "output_tax", debit: "0", credit: taxTotal },
        ]
      : [
          { role: "expense", debit: subtotal, credit: "0" },
          { role: "input_tax", debit: taxTotal, credit: "0" },
          { role: "payable", debit: "0", credit: total },
        ]

  const reversed = kind === "customer_credit_note" || kind === "supplier_credit_note"

  return forward.flatMap((line) => {
    const oriented = reversed ? { ...line, debit: line.credit, credit: line.debit } : line

    return minor(oriented.debit) > 0n || minor(oriented.credit) > 0n ? [oriented] : []
  })
}

// ---------------------------------------------------------------- the document

export const DocumentId = Schema.String.pipe(Schema.brand("BillingDocumentId"))

export class DocumentRecorded extends Domain.Event("BillingDocumentRecorded", {
  kind: Kind,
  legalEntityId: Schema.String,
  documentDate: Schema.String,
  taxDate: Schema.String,
  lines: Schema.Array(Line),
}) {}

export class DocumentTaxed extends Domain.Event("BillingDocumentTaxed", {
  kind: Kind,
  legalEntityId: Schema.String,
  documentDate: Schema.String,
  subtotal: Schema.String,
  taxTotal: Schema.String,
  total: Schema.String,
}) {}

export class DocumentNumbered extends Domain.Event("BillingDocumentNumbered", {
  number: Schema.String,
  kind: Kind,
  documentDate: Schema.String,
  subtotal: Schema.String,
  taxTotal: Schema.String,
  total: Schema.String,
}) {}

export class DocumentMarkedPosted extends Domain.Event("BillingDocumentMarkedPosted", {
  number: Schema.String,
}) {}

export class RecordDocument extends Domain.Command("RecordBillingDocument", {
  target: DocumentId,
  input: {
    kind: Kind,
    legalEntityId: Schema.String,
    documentDate: Schema.String,
    /** The credited document's date for a credit note; omitted, it is the document date. */
    taxDate: Schema.optionalKey(Schema.String),
    lines: Schema.Array(Line),
  },
  events: [DocumentRecorded],
}) {}

export class ApplyTax extends Domain.Command("ApplyBillingTax", {
  target: DocumentId,
  input: { taxes: Schema.Array(Schema.String) },
  events: [DocumentTaxed],
}) {}

export class AssignNumber extends Domain.Command("AssignBillingNumber", {
  target: DocumentId,
  input: { number: Schema.String },
  events: [DocumentNumbered],
}) {}

export class MarkPosted extends Domain.Command("MarkBillingDocumentPosted", {
  target: DocumentId,
  input: {},
  events: [DocumentMarkedPosted],
}) {}

const Stage = Schema.Literals(["None", "Recorded", "Taxed", "Numbered", "Posted"])

const DocumentState = Schema.Struct({
  stage: Stage,
  kind: Kind,
  legalEntityId: Schema.String,
  documentDate: Schema.String,
  taxDate: Schema.String,
  lines: Schema.Array(Line),
  subtotal: Schema.String,
  taxTotal: Schema.String,
  total: Schema.String,
  number: Schema.String,
})

/** A document moves through its stages once, in order; a step out of order or twice does nothing. */
export class BillingDocument extends Domain.Aggregate("BillingDocument", {
  id: DocumentId,
  state: DocumentState,
  initial: {
    stage: "None",
    kind: "customer_invoice",
    legalEntityId: "",
    documentDate: "",
    taxDate: "",
    lines: [],
    subtotal: "0.00",
    taxTotal: "0.00",
    total: "0.00",
    number: "",
  },
  commands: [RecordDocument, ApplyTax, AssignNumber, MarkPosted],
  decide: {
    RecordBillingDocument: (s, cmd) =>
      s.stage === "None"
        ? [
            new DocumentRecorded({
              kind: cmd.kind,
              legalEntityId: cmd.legalEntityId,
              documentDate: cmd.documentDate,
              taxDate: cmd.taxDate ?? cmd.documentDate,
              lines: cmd.lines,
            }),
          ]
        : [],
    ApplyBillingTax: (s, cmd) => {
      if (s.stage !== "Recorded" || cmd.taxes.length !== s.lines.length) return []

      const subtotal = s.lines.reduce((sum, line) => sum + minor(line.net), 0n)
      const taxTotal = cmd.taxes.reduce((sum, tax) => sum + minor(tax), 0n)

      return [
        new DocumentTaxed({
          kind: s.kind,
          legalEntityId: s.legalEntityId,
          documentDate: s.documentDate,
          subtotal: major(subtotal),
          taxTotal: major(taxTotal),
          total: major(subtotal + taxTotal),
        }),
      ]
    },
    AssignBillingNumber: (s, cmd) =>
      s.stage === "Taxed"
        ? [
            new DocumentNumbered({
              number: cmd.number,
              kind: s.kind,
              documentDate: s.documentDate,
              subtotal: s.subtotal,
              taxTotal: s.taxTotal,
              total: s.total,
            }),
          ]
        : [],
    MarkBillingDocumentPosted: (s) =>
      s.stage === "Numbered" ? [new DocumentMarkedPosted({ number: s.number })] : [],
  },
  evolve: {
    BillingDocumentRecorded: (s, e) => ({
      ...s,
      stage: "Recorded" as const,
      kind: e.kind,
      legalEntityId: e.legalEntityId,
      documentDate: e.documentDate,
      taxDate: e.taxDate,
      lines: e.lines,
    }),
    BillingDocumentTaxed: (s, e) => ({
      ...s,
      stage: "Taxed" as const,
      subtotal: e.subtotal,
      taxTotal: e.taxTotal,
      total: e.total,
    }),
    BillingDocumentNumbered: (s, e) => ({ ...s, stage: "Numbered" as const, number: e.number }),
    BillingDocumentMarkedPosted: (s) => ({ ...s, stage: "Posted" as const }),
  },
}) {}

// ---------------------------------------------------------------- the series

/** `<legal entity>/<kind>/<calendar year>`: a series per legal entity, kind, and year. */
export const SeriesId = Schema.String.pipe(Schema.brand("BillingSeriesId"))

export const seriesId = (legalEntityId: string, kind: Kind, documentDate: string) =>
  SeriesId.make(`${legalEntityId}/${kind}/${documentDate.slice(0, 4)}`)

export class NumberAllocated extends Domain.Event("BillingNumberAllocated", {
  documentId: Schema.String,
  value: Schema.Int,
}) {}

export class AllocateNumber extends Domain.Command("AllocateBillingNumber", {
  target: SeriesId,
  input: { documentId: Schema.String },
  events: [NumberAllocated],
}) {}

/** The series gives a document one number, the next of the series, and remembers it. */
export class BillingSeries extends Domain.Aggregate("BillingSeries", {
  id: SeriesId,
  state: Schema.Struct({
    last: Schema.Int,
    issued: Schema.Record(Schema.String, Schema.Int),
  }),
  initial: { last: 0, issued: {} },
  commands: [AllocateNumber],
  decide: {
    AllocateBillingNumber: (s, cmd) =>
      s.issued[cmd.documentId] === undefined
        ? [new NumberAllocated({ documentId: cmd.documentId, value: s.last + 1 })]
        : [],
  },
  evolve: {
    BillingNumberAllocated: (s, e) => ({
      last: e.value,
      issued: { ...s.issued, [e.documentId]: e.value },
    }),
  },
}) {}

/** `<prefix><year>/<value padded to 5>`, as `formatNumber` of the numbering module. */
export const documentNumber = (kind: Kind, year: string, value: number) =>
  `${prefixes[kind]}${year}/${String(value).padStart(5, "0")}`

// ---------------------------------------------------------------- the journal

export const JournalId = Schema.String.pipe(Schema.brand("BillingJournalId"))

export class JournalPosted extends Domain.Event("BillingJournalPosted", {
  documentId: Schema.String,
  postingDate: Schema.String,
  description: Schema.String,
  lines: Schema.Array(JournalLine),
}) {}

export class PostJournal extends Domain.Command("PostBillingJournal", {
  target: JournalId,
  input: {
    documentId: Schema.String,
    postingDate: Schema.String,
    description: Schema.String,
    lines: Schema.Array(JournalLine),
  },
  events: [JournalPosted],
}) {}

/** One journal per document: a second post for the same document does nothing. */
export class DocumentJournal extends Domain.Aggregate("DocumentJournal", {
  id: JournalId,
  state: Schema.Boolean,
  initial: false,
  commands: [PostJournal],
  decide: {
    PostBillingJournal: (posted, cmd) =>
      posted
        ? []
        : [
            new JournalPosted({
              documentId: cmd.documentId,
              postingDate: cmd.postingDate,
              description: cmd.description,
              lines: cmd.lines,
            }),
          ],
  },
  evolve: {
    BillingJournalPosted: () => true,
  },
}) {}

// ---------------------------------------------------------------- the policies

/** Computes tax at the tax date on the record, line by line. */
export class Taxing extends Domain.Policy("Taxing", {
  from: BillingDocument,
  on: [DocumentRecorded],
}) {}

export const TaxingLive = Taxing.toLayer(
  Effect.gen(function* () {
    const documents = yield* BillingDocument

    return Effect.fn(function* ({ source, event }) {
      yield* documents
        .send(
          DocumentId.make(source.id),
          new ApplyTax({
            taxes: event.lines.map((line) => taxOf(line.net, rateBps(line.taxCode, event.taxDate))),
          }),
        )
        .pipe(Effect.asVoid, Effect.orDie)
    })
  }),
)

/** Asks the series of the document's legal entity, kind, and year for a number, once taxed. */
export class NumberRequest extends Domain.Policy("BillingNumberRequest", {
  from: BillingDocument,
  on: [DocumentTaxed],
}) {}

export const NumberRequestLive = NumberRequest.toLayer(
  Effect.gen(function* () {
    const series = yield* BillingSeries

    return Effect.fn(function* ({ source, event }) {
      yield* series
        .send(
          seriesId(event.legalEntityId, event.kind, event.documentDate),
          new AllocateNumber({ documentId: source.id }),
        )
        .pipe(Effect.asVoid, Effect.orDie)
    })
  }),
)

/** Gives the allocated number to its document. */
export class NumberAssignment extends Domain.Policy("BillingNumberAssignment", {
  from: BillingSeries,
  on: [NumberAllocated],
}) {}

export const NumberAssignmentLive = NumberAssignment.toLayer(
  Effect.gen(function* () {
    const documents = yield* BillingDocument

    return Effect.fn(function* ({ source, event }) {
      const [, kindPart, year = ""] = source.id.split("/")
      const kind = Schema.decodeUnknownSync(Kind)(kindPart)

      yield* documents
        .send(
          DocumentId.make(event.documentId),
          new AssignNumber({ number: documentNumber(kind, year, event.value) }),
        )
        .pipe(Effect.asVoid, Effect.orDie)
    })
  }),
)

/** Posts the journal of a numbered document at the document date. */
export class Journaling extends Domain.Policy("BillingJournaling", {
  from: BillingDocument,
  on: [DocumentNumbered],
}) {}

export const JournalingLive = Journaling.toLayer(
  Effect.gen(function* () {
    const journals = yield* DocumentJournal

    return Effect.fn(function* ({ source, event }) {
      yield* journals
        .send(
          JournalId.make(`document/${source.id}`),
          new PostJournal({
            documentId: source.id,
            postingDate: event.documentDate,
            description: event.number,
            lines: sideLines(event.kind, event.subtotal, event.taxTotal, event.total),
          }),
        )
        .pipe(Effect.asVoid, Effect.orDie)
    })
  }),
)

/** Marks the document posted once its journal is. */
export class PostedMarking extends Domain.Policy("BillingPostedMarking", {
  from: DocumentJournal,
  on: [JournalPosted],
}) {}

export const PostedMarkingLive = PostedMarking.toLayer(
  Effect.gen(function* () {
    const documents = yield* BillingDocument

    return Effect.fn(function* ({ event }) {
      yield* documents
        .send(DocumentId.make(event.documentId), new MarkPosted({}))
        .pipe(Effect.asVoid, Effect.orDie)
    })
  }),
)

export class BillingDocumentNumbering extends Domain.Model("BillingDocumentNumbering", {
  aggregates: [BillingDocument, BillingSeries, DocumentJournal],
  policies: [Taxing, NumberRequest, NumberAssignment, Journaling, PostedMarking],
}) {}

export const BillingDocumentNumberingHandlers = Layer.mergeAll(
  TaxingLive,
  NumberRequestLive,
  NumberAssignmentLive,
  JournalingLive,
  PostedMarkingLive,
)
