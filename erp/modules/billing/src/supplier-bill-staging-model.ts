/**
 * Supplier bills and credit notes staged for ADR-0124 phase 4 (`BIL-BILL-3`, `BIL-CREDIT-1`).
 * Production posts the document's journal in the transaction that records it. On the Effect Cluster
 * host the document commits on its own pool, so the journal becomes a later step: the document
 * records first, a policy starts a saga, and the saga posts the journal and, for a credit note,
 * returns the credited quantity to Procurement's matching. This model states that staging and
 * nothing else; there is no cutover.
 *
 * - **A bill's journal follows the bill.** GRNI at the matched value, price variance for the rest of
 *   the subtotal, input tax, and payable for the total, posted once per bill.
 * - **The cap and the application are one commit.** A credit note's quantity cap, its share of the
 *   matched value (`creditShare`), and its application to the bill's open amount happen in the bill
 *   aggregate, so two credits cannot both take the same remaining quantity.
 * - **The reversal and the returned quantity are later steps.** Until they run, the credited
 *   quantity is not billable again: a new bill is refused too early, never too late.
 * - **Repeated ids record nothing,** for the bill, the credit note, the journal, and the quantity.
 *
 * What the production event lacks: `SupplierBillPosted` carries the total and the matched value but
 * not the subtotal or the tax, which the journal needs, so staging adds both to the event. Not
 * modelled: tax calculation, the period check of the journals, a credit note of a credit note,
 * customer credit notes, and who resumes a parked credit note. Test-only: not exported from
 * `mod.ts`.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { Activity } from "effect/workflow"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  formatSignedMinor,
  requireExactMajorToMinor,
} from "../../../../framework/foundation/mod.ts"
import { creditShare } from "./matching.ts"

const minor = (value: string) => requireExactMajorToMinor(value, 2)
const major = (value: bigint) => formatSignedMinor(value, 2)

// ---------------------------------------------------------------- the journal

const JournalLine = Schema.Struct({
  role: Schema.String,
  debit: Schema.String,
  credit: Schema.String,
})

type JournalLine = typeof JournalLine.Type

export const JournalRef = Schema.String.pipe(Schema.brand("BillingJournalRef"))

export class JournalPosted extends Domain.Event("JournalPosted", {
  lines: Schema.Array(JournalLine),
}) {}

export class PostJournal extends Domain.Command("PostJournal", {
  target: JournalRef,
  input: { lines: Schema.Array(JournalLine) },
  events: [JournalPosted],
}) {}

const Unposted = Schema.TaggedStruct("Unposted", {})
const Posted = Schema.TaggedStruct("Posted", {})

/** One journal per reference; a repeated post is a no-op. */
export class BillingJournal extends Domain.Aggregate("BillingJournal", {
  id: JournalRef,
  state: Schema.Union([Unposted, Posted]),
  initial: Unposted.make({}),
  commands: [PostJournal],
  decide: {
    PostJournal: (s, cmd) =>
      Predicate.isTagged(s, "Unposted") ? [new JournalPosted({ lines: cmd.lines })] : [],
  },
  evolve: {
    JournalPosted: () => Posted.make({}),
  },
}) {}

/** The bill's journal: GRNI at the matched value, the rest of the subtotal as price variance. */
export const billLines = (amounts: {
  readonly subtotal: string
  readonly taxTotal: string
  readonly total: string
  readonly matched: string
}): ReadonlyArray<JournalLine> => {
  const variance = minor(amounts.subtotal) - minor(amounts.matched)

  return [
    { role: "goods_received_not_invoiced", debit: amounts.matched, credit: "0" },
    variance >= 0n
      ? { role: "purchase_price_variance", debit: major(variance), credit: "0" }
      : { role: "purchase_price_variance", debit: "0", credit: major(-variance) },
    { role: "input_tax", debit: amounts.taxTotal, credit: "0" },
    { role: "payable", debit: "0", credit: amounts.total },
  ]
}

/** The credit note's journal mirrors the bill's. */
export const creditLines = (amounts: {
  readonly subtotal: string
  readonly taxTotal: string
  readonly total: string
  readonly matched: string
}): ReadonlyArray<JournalLine> => {
  const variance = minor(amounts.subtotal) - minor(amounts.matched)

  return [
    { role: "payable", debit: amounts.total, credit: "0" },
    { role: "goods_received_not_invoiced", debit: "0", credit: amounts.matched },
    variance >= 0n
      ? { role: "purchase_price_variance", debit: "0", credit: major(variance) }
      : { role: "purchase_price_variance", debit: major(-variance), credit: "0" },
    { role: "input_tax", debit: "0", credit: amounts.taxTotal },
  ]
}

// ---------------------------------------------------------------- the bill

export const BillId = Schema.String.pipe(Schema.brand("StagedBillId"))

export class CreditExceedsInvoice extends Domain.Rejection("CreditExceedsInvoice", {
  invoiceLineId: Schema.String,
  available: Schema.String,
}) {}

export class BillNotRecorded extends Domain.Rejection("BillNotRecorded") {}

const BillLine = Schema.Struct({
  id: Schema.String,
  quantity: Schema.String,
  matchedValue: Schema.String,
  /** The purchase order line whose billable quantity a credit returns. */
  purchaseOrderLineId: Schema.String,
})

const Amounts = {
  subtotal: Schema.String,
  taxTotal: Schema.String,
  total: Schema.String,
  matched: Schema.String,
}

export class BillRecorded extends Domain.Event("BillRecorded", {
  ...Amounts,
  lines: Schema.Array(BillLine),
}) {}

const CreditLine = Schema.Struct({ invoiceLineId: Schema.String, quantity: Schema.String })

export class CreditAccepted extends Domain.Event("CreditAccepted", {
  creditId: Schema.String,
  ...Amounts,
  lines: Schema.Array(
    Schema.Struct({
      invoiceLineId: Schema.String,
      purchaseOrderLineId: Schema.String,
      quantity: Schema.String,
      share: Schema.String,
    }),
  ),
  /** The part of the credit applied to the bill's open amount; the rest stays open. */
  applied: Schema.String,
  openAfter: Schema.String,
}) {}

export class RecordBill extends Domain.Command("RecordBill", {
  target: BillId,
  input: { ...Amounts, lines: Schema.Array(BillLine) },
  events: [BillRecorded],
}) {}

export class AcceptCredit extends Domain.Command("AcceptCredit", {
  target: BillId,
  input: { creditId: Schema.String, ...Amounts, lines: Schema.Array(CreditLine) },
  events: [CreditAccepted],
  rejects: [BillNotRecorded, CreditExceedsInvoice],
}) {}

const Unrecorded = Schema.TaggedStruct("Unrecorded", {})

const Recorded = Schema.TaggedStruct("Recorded", {
  lines: Schema.Array(BillLine),
  open: Schema.String,
  /** Credited quantity and returned matched value, by bill line. */
  credited: Schema.Record(Schema.String, Schema.String),
  returned: Schema.Record(Schema.String, Schema.String),
  creditIds: Schema.Array(Schema.String),
})

export class StagedBill extends Domain.Aggregate("StagedBill", {
  id: BillId,
  state: Schema.Union([Unrecorded, Recorded]),
  initial: Unrecorded.make({}),
  commands: [RecordBill, AcceptCredit],
  decide: {
    RecordBill: (s, cmd) =>
      Predicate.isTagged(s, "Unrecorded")
        ? [
            new BillRecorded({
              subtotal: cmd.subtotal,
              taxTotal: cmd.taxTotal,
              total: cmd.total,
              matched: cmd.matched,
              lines: cmd.lines,
            }),
          ]
        : [],
    AcceptCredit: (s, cmd) => {
      if (!Predicate.isTagged(s, "Recorded")) return new BillNotRecorded()

      if (s.creditIds.includes(cmd.creditId)) return []

      const credited = new Map(Object.entries(s.credited).map(([id, q]) => [id, BigInt(q)]))
      const returned = new Map(Object.entries(s.returned).map(([id, v]) => [id, minor(v)]))

      const lines: Array<{
        invoiceLineId: string
        purchaseOrderLineId: string
        quantity: string
        share: string
      }> = []

      for (const request of cmd.lines) {
        const line = s.lines.find((candidate) => candidate.id === request.invoiceLineId)
        const quantity = BigInt(request.quantity)

        const available =
          line === undefined ? 0n : BigInt(line.quantity) - (credited.get(line.id) ?? 0n)

        if (line === undefined || quantity > available) {
          return new CreditExceedsInvoice({
            invoiceLineId: request.invoiceLineId,
            available: String(available),
          })
        }

        const share = creditShare(
          {
            id: line.id,
            productId: null,
            description: "line",
            quantity: line.quantity,
            unitPrice: "0.00",
            netAmount: "0.00",
            taxCodeId: null,
            taxAmount: "0.00",
            sourceLineId: null,
            matchedValue: line.matchedValue,
          },
          quantity,
          credited,
          returned,
        )

        credited.set(line.id, (credited.get(line.id) ?? 0n) + quantity)
        returned.set(line.id, (returned.get(line.id) ?? 0n) + share)

        lines.push({
          invoiceLineId: line.id,
          purchaseOrderLineId: line.purchaseOrderLineId,
          quantity: request.quantity,
          share: major(share),
        })
      }

      const open = minor(s.open)
      const total = minor(cmd.total)
      const applied = total < open ? total : open

      return [
        new CreditAccepted({
          creditId: cmd.creditId,
          subtotal: cmd.subtotal,
          taxTotal: cmd.taxTotal,
          total: cmd.total,
          matched: major(lines.reduce((sum, line) => sum + minor(line.share), 0n)),
          lines,
          applied: major(applied),
          openAfter: major(open - applied),
        }),
      ]
    },
  },
  evolve: {
    BillRecorded: (_, e) =>
      Recorded.make({ lines: e.lines, open: e.total, credited: {}, returned: {}, creditIds: [] }),
    CreditAccepted: (s, e) => {
      if (!Predicate.isTagged(s, "Recorded")) return s

      const credited = { ...s.credited }
      const returned = { ...s.returned }

      for (const line of e.lines) {
        credited[line.invoiceLineId] = String(
          BigInt(credited[line.invoiceLineId] ?? "0") + BigInt(line.quantity),
        )

        returned[line.invoiceLineId] = major(
          minor(returned[line.invoiceLineId] ?? "0") + minor(line.share),
        )
      }

      return Recorded.make({
        lines: s.lines,
        open: e.openAfter,
        credited,
        returned,
        creditIds: [...s.creditIds, e.creditId],
      })
    },
  },
}) {}

// ---------------------------------------------------------------- Procurement's billable quantity

export const PurchaseLineId = Schema.String.pipe(Schema.brand("StagedPurchaseLineId"))

export class BillableRestored extends Domain.Event("BillableRestored", {
  creditId: Schema.String,
  quantity: Schema.String,
}) {}

export class RestoreBillable extends Domain.Command("RestoreBillable", {
  target: PurchaseLineId,
  input: { creditId: Schema.String, quantity: Schema.String },
  events: [BillableRestored],
}) {}

/** The credited quantity that is billable again, per credit note. */
export class PurchaseLineMatching extends Domain.Aggregate("PurchaseLineMatching", {
  id: PurchaseLineId,
  state: Schema.Record(Schema.String, Schema.String),
  initial: {},
  commands: [RestoreBillable],
  decide: {
    RestoreBillable: (s, cmd) =>
      s[cmd.creditId] === undefined
        ? [new BillableRestored({ creditId: cmd.creditId, quantity: cmd.quantity })]
        : [],
  },
  evolve: {
    BillableRestored: (s, e) => ({ ...s, [e.creditId]: e.quantity }),
  },
}) {}

// ---------------------------------------------------------------- the status of a credit note

export const CreditId = Schema.String.pipe(Schema.brand("StagedCreditId"))

export class CreditApplied extends Domain.Event("CreditApplied", {}) {}

export class MarkCreditApplied extends Domain.Command("MarkCreditApplied", {
  target: CreditId,
  input: {},
  events: [CreditApplied],
}) {}

const Applying = Schema.TaggedStruct("Applying", {})
const Applied = Schema.TaggedStruct("Applied", {})

/** A credit note whose journal and returned quantity are still being applied, or done. */
export class CreditApplication extends Domain.Aggregate("CreditApplication", {
  id: CreditId,
  state: Schema.Union([Applying, Applied]),
  initial: Applying.make({}),
  commands: [MarkCreditApplied],
  decide: {
    MarkCreditApplied: (s) => (Predicate.isTagged(s, "Applying") ? [new CreditApplied()] : []),
  },
  evolve: {
    CreditApplied: () => Applied.make({}),
  },
}) {}

// ---------------------------------------------------------------- the sagas

const BillInput = { ...Amounts }

export class PostBillJournal extends Domain.Saga("PostBillJournal", {
  key: BillId,
  input: BillInput,
}) {}

const CreditInput = {
  billId: Schema.String,
  ...Amounts,
  lines: Schema.Array(
    Schema.Struct({ purchaseOrderLineId: Schema.String, quantity: Schema.String }),
  ),
}

export class ReturnCredit extends Domain.Saga("ReturnCredit", {
  key: CreditId,
  input: CreditInput,
}) {}

type BillRun = Schema.Struct<typeof BillInput>["Type"] & { readonly key: typeof BillId.Type }

type CreditRun = Schema.Struct<typeof CreditInput>["Type"] & {
  readonly key: typeof CreditId.Type
}

export const PostBillJournalLive = PostBillJournal.toLayer(
  Effect.gen(function* () {
    const journals = yield* BillingJournal

    return Effect.fn(function* ({ key, subtotal, taxTotal, total, matched }: BillRun) {
      yield* Activity.make({
        name: "journal",
        execute: journals
          .send(
            JournalRef.make(`bill/${key}`),
            new PostJournal({ lines: billLines({ subtotal, taxTotal, total, matched }) }),
          )
          .pipe(Effect.asVoid, Effect.orDie),
      })
    })
  }),
)

export const ReturnCreditLive = ReturnCredit.toLayer(
  Effect.gen(function* () {
    const journals = yield* BillingJournal
    const purchaseLines = yield* PurchaseLineMatching
    const applications = yield* CreditApplication

    return Effect.fn(function* ({ key, subtotal, taxTotal, total, matched, lines }: CreditRun) {
      yield* Activity.make({
        name: "reverse-journal",
        execute: journals
          .send(
            JournalRef.make(`credit/${key}`),
            new PostJournal({ lines: creditLines({ subtotal, taxTotal, total, matched }) }),
          )
          .pipe(Effect.asVoid, Effect.orDie),
      })

      yield* Effect.forEach(
        lines,
        ({ purchaseOrderLineId, quantity }) =>
          Activity.make({
            name: `restore:${purchaseOrderLineId}`,
            execute: purchaseLines
              .send(
                PurchaseLineId.make(purchaseOrderLineId),
                new RestoreBillable({ creditId: key, quantity }),
              )
              .pipe(Effect.asVoid, Effect.orDie),
          }),
        { discard: true },
      )

      yield* Activity.make({
        name: "applied",
        execute: applications
          .send(key, new MarkCreditApplied({}))
          .pipe(Effect.asVoid, Effect.orDie),
      })
    })
  }),
)

/** Starts the bill journal once the bill is recorded. */
export class BillJournalPosting extends Domain.Policy("BillJournalPosting", {
  from: StagedBill,
  on: [BillRecorded],
}) {}

export const BillJournalPostingLive = BillJournalPosting.toLayer(
  Effect.gen(function* () {
    const runs = yield* PostBillJournal

    return Effect.fn(function* ({ source, event }) {
      yield* runs.start(source, {
        subtotal: event.subtotal,
        taxTotal: event.taxTotal,
        total: event.total,
        matched: event.matched,
      })
    })
  }),
)

/** Starts the reversal and the returned quantity once the credit note is accepted. */
export class CreditReturn extends Domain.Policy("CreditReturn", {
  from: StagedBill,
  on: [CreditAccepted],
}) {}

export const CreditReturnLive = CreditReturn.toLayer(
  Effect.gen(function* () {
    const runs = yield* ReturnCredit

    return Effect.fn(function* ({ source, event }) {
      yield* runs.start(CreditId.make(event.creditId), {
        billId: source.id,
        subtotal: event.subtotal,
        taxTotal: event.taxTotal,
        total: event.total,
        matched: event.matched,
        lines: event.lines.map(({ purchaseOrderLineId, quantity }) => ({
          purchaseOrderLineId,
          quantity,
        })),
      })
    })
  }),
)

export class BillingSupplierDocuments extends Domain.Model("BillingSupplierDocuments", {
  aggregates: [StagedBill, BillingJournal, PurchaseLineMatching, CreditApplication],
  policies: [BillJournalPosting, CreditReturn],
  sagas: [PostBillJournal, ReturnCredit],
}) {}

export const BillingSupplierDocumentsHandlers = Layer.mergeAll(
  PostBillJournalLive,
  ReturnCreditLive,
  BillJournalPostingLive,
  CreditReturnLive,
)
