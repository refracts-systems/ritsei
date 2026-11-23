/**
 * A receipt with withholding staged for ADR-0124 phase 4 (`SET-WHT-1`). Production records the
 * payment, posts its journal, and allocates it to documents in one command. On the Effect Cluster
 * host the receipt and each document are separate aggregates that commit on their own pools, so
 * the same facts become steps: the receipt records first with the allocations it intends, then a
 * saga posts the journal and allocates document by document. This model states that staging and
 * nothing else; there is no cutover.
 *
 * - **The check stays in the command.** The withheld amount must be below the amount and covered
 *   by the intended allocations, and the allocations may not exceed the amount; a refused receipt
 *   records nothing.
 * - **The journal follows the receipt.** The bank takes the cash (amount less withholding), the
 *   claim account the withheld part, and receivables are credited with the whole amount: the
 *   production `paymentLines` for a receipt, once per receipt.
 * - **Unapplied cash is a state.** A document that cannot take its allocation (it is already
 *   settled) parks the receipt. The journal and the allocations made before it stay, and the receipt
 *   shows the part not yet allocated until someone allocates it, as `allocatePayment` does today.
 *   Nothing is reversed: the cash did arrive.
 *
 * Not modelled: the cash account choice, certificate numbers, outgoing payments, allocation dates,
 * and who resumes a parked receipt. Test-only: not exported from `mod.ts`.
 */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { Activity, Workflow } from "effect/workflow"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  formatSignedMinor,
  requireExactMajorToMinor,
} from "../../../../framework/foundation/mod.ts"

const minor = (value: string) => requireExactMajorToMinor(value, 2)
const major = (value: bigint) => formatSignedMinor(value, 2)

// ---------------------------------------------------------------- the journal

const JournalLine = Schema.Struct({
  account: Schema.String,
  debit: Schema.String,
  credit: Schema.String,
})

export const ReceiptId = Schema.String.pipe(Schema.brand("WithholdingReceiptId"))

export class ReceiptJournalPosted extends Domain.Event("ReceiptJournalPosted", {
  lines: Schema.Array(JournalLine),
}) {}

export class PostReceiptJournal extends Domain.Command("PostReceiptJournal", {
  target: ReceiptId,
  input: { lines: Schema.Array(JournalLine) },
  events: [ReceiptJournalPosted],
}) {}

const Unposted = Schema.TaggedStruct("Unposted", {})
const Posted = Schema.TaggedStruct("Posted", {})

/** One journal per receipt, keyed by it; a repeated post is a no-op. */
export class ReceiptJournal extends Domain.Aggregate("ReceiptJournal", {
  id: ReceiptId,
  state: Schema.Union([Unposted, Posted]),
  initial: Unposted.make({}),
  commands: [PostReceiptJournal],
  decide: {
    PostReceiptJournal: (s, cmd) =>
      Predicate.isTagged(s, "Unposted") ? [new ReceiptJournalPosted({ lines: cmd.lines })] : [],
  },
  evolve: {
    ReceiptJournalPosted: () => Posted.make({}),
  },
}) {}

/** Cash to the bank, the withheld part to the claim account, the whole amount from receivables. */
export const receiptLines = (amount: string, withheld: string) => [
  { account: "bank", debit: major(minor(amount) - minor(withheld)), credit: "0" },
  ...(minor(withheld) === 0n ? [] : [{ account: "claim", debit: withheld, credit: "0" }]),
  { account: "receivable", debit: "0", credit: amount },
]

// ---------------------------------------------------------------- the document

export const InvoiceId = Schema.String.pipe(Schema.brand("WithholdingInvoiceId"))

export class AllocationExceedsOpen extends Domain.Rejection("AllocationExceedsOpen", {
  invoiceId: Schema.String,
  open: Schema.String,
}) {}

export class InvoiceOpened extends Domain.Event("InvoiceOpened", { open: Schema.String }) {}

export class AllocationApplied extends Domain.Event("AllocationApplied", {
  receiptId: Schema.String,
  amount: Schema.String,
  openAfter: Schema.String,
}) {}

export class OpenInvoice extends Domain.Command("OpenInvoice", {
  target: InvoiceId,
  input: { open: Schema.String },
  events: [InvoiceOpened],
}) {}

export class AllocateToInvoice extends Domain.Command("AllocateToInvoice", {
  target: InvoiceId,
  input: { invoiceId: Schema.String, receiptId: Schema.String, amount: Schema.String },
  events: [AllocationApplied],
  rejects: [AllocationExceedsOpen],
}) {}

const Document = Schema.Struct({
  open: Schema.String,
  /** The receipts that allocated here, so a repeat is recognised. */
  receipts: Schema.Array(Schema.String),
})

export class SettledInvoice extends Domain.Aggregate("SettledInvoice", {
  id: InvoiceId,
  state: Document,
  initial: { open: "0.00", receipts: [] },
  commands: [OpenInvoice, AllocateToInvoice],
  decide: {
    OpenInvoice: (s, cmd) =>
      s.open === "0.00" && s.receipts.length === 0 ? [new InvoiceOpened({ open: cmd.open })] : [],
    AllocateToInvoice: (s, cmd) => {
      if (s.receipts.includes(cmd.receiptId)) return []

      const open = minor(s.open)
      const amount = minor(cmd.amount)

      if (amount > open)
        return new AllocationExceedsOpen({ invoiceId: cmd.invoiceId, open: s.open })

      return [
        new AllocationApplied({
          receiptId: cmd.receiptId,
          amount: cmd.amount,
          openAfter: major(open - amount),
        }),
      ]
    },
  },
  evolve: {
    InvoiceOpened: (s, e) => ({ ...s, open: e.open }),
    AllocationApplied: (s, e) => ({ open: e.openAfter, receipts: [...s.receipts, e.receiptId] }),
  },
}) {}

// ---------------------------------------------------------------- the receipt

export class InvalidWithholding extends Domain.Rejection("InvalidWithholding", {
  reason: Schema.Literals(["not_below_payment", "not_allocated", "exceeds_payment"]),
}) {}

const Allocation = Schema.Struct({ invoiceId: Schema.String, amount: Schema.String })

export class ReceiptRecorded extends Domain.Event("WithholdingReceiptRecorded", {
  amount: Schema.String,
  withheld: Schema.String,
  allocations: Schema.Array(Allocation),
}) {}

export class AllocationNoted extends Domain.Event("AllocationNoted", {
  invoiceId: Schema.String,
  amount: Schema.String,
}) {}

/** The receipt stopped short of its allocations; the cash is in and a person allocates the rest. */
export class ReceiptParked extends Domain.Event("WithholdingReceiptParked", {
  reason: Schema.String,
}) {}

export class RecordReceipt extends Domain.Command("RecordWithholdingReceipt", {
  target: ReceiptId,
  input: {
    amount: Schema.String,
    withheld: Schema.String,
    allocations: Schema.Array(Allocation),
  },
  events: [ReceiptRecorded],
  rejects: [InvalidWithholding],
}) {}

export class NoteAllocation extends Domain.Command("NoteAllocation", {
  target: ReceiptId,
  input: { invoiceId: Schema.String, amount: Schema.String },
  events: [AllocationNoted],
}) {}

export class ParkReceipt extends Domain.Command("ParkWithholdingReceipt", {
  target: ReceiptId,
  input: { reason: Schema.String },
  events: [ReceiptParked],
}) {}

const Unrecorded = Schema.TaggedStruct("Unrecorded", {})

const Recorded = Schema.TaggedStruct("Recorded", {
  amount: Schema.String,
  allocated: Schema.String,
  parked: Schema.Boolean,
  noted: Schema.Array(Schema.String),
})

export class WithholdingReceipt extends Domain.Aggregate("WithholdingReceipt", {
  id: ReceiptId,
  state: Schema.Union([Unrecorded, Recorded]),
  initial: Unrecorded.make({}),
  commands: [RecordReceipt, NoteAllocation, ParkReceipt],
  decide: {
    RecordWithholdingReceipt: (s, cmd) => {
      if (!Predicate.isTagged(s, "Unrecorded")) return []

      const amount = minor(cmd.amount)
      const withheld = minor(cmd.withheld)
      const allocated = cmd.allocations.reduce((sum, part) => sum + minor(part.amount), 0n)

      if (withheld >= amount) return new InvalidWithholding({ reason: "not_below_payment" })

      if (withheld > allocated) return new InvalidWithholding({ reason: "not_allocated" })

      if (allocated > amount) return new InvalidWithholding({ reason: "exceeds_payment" })

      return [
        new ReceiptRecorded({
          amount: cmd.amount,
          withheld: cmd.withheld,
          allocations: cmd.allocations,
        }),
      ]
    },
    NoteAllocation: (s, cmd) =>
      Predicate.isTagged(s, "Recorded") && !s.noted.includes(cmd.invoiceId)
        ? [new AllocationNoted({ invoiceId: cmd.invoiceId, amount: cmd.amount })]
        : [],
    ParkWithholdingReceipt: (s, cmd) =>
      Predicate.isTagged(s, "Recorded") && !s.parked
        ? [new ReceiptParked({ reason: cmd.reason })]
        : [],
  },
  evolve: {
    WithholdingReceiptRecorded: (_, e) =>
      Recorded.make({ amount: e.amount, allocated: "0.00", parked: false, noted: [] }),
    AllocationNoted: (s, e) =>
      Predicate.isTagged(s, "Recorded")
        ? Recorded.make({
            ...s,
            allocated: major(minor(s.allocated) + minor(e.amount)),
            noted: [...s.noted, e.invoiceId],
          })
        : s,
    WithholdingReceiptParked: (s) =>
      Predicate.isTagged(s, "Recorded") ? Recorded.make({ ...s, parked: true }) : s,
  },
}) {}

// ---------------------------------------------------------------- the saga

const ApplyInput = {
  amount: Schema.String,
  withheld: Schema.String,
  allocations: Schema.Array(Allocation),
}

type Run = Schema.Struct<typeof ApplyInput>["Type"] & { readonly key: typeof ReceiptId.Type }

export class ApplyReceipt extends Domain.Saga("ApplyWithholdingReceipt", {
  key: ReceiptId,
  input: ApplyInput,
  rejects: [AllocationExceedsOpen],
}) {}

export const ApplyReceiptLive = ApplyReceipt.toLayer(
  Effect.gen(function* () {
    const journals = yield* ReceiptJournal
    const invoices = yield* SettledInvoice
    const receipts = yield* WithholdingReceipt

    return Effect.fn(function* ({ key, amount, withheld, allocations }: Run) {
      yield* Workflow.addFinalizer((exit) =>
        Exit.isFailure(exit)
          ? receipts
              .send(key, new ParkReceipt({ reason: "a document could not take its allocation" }))
              .pipe(Effect.asVoid, Effect.orDie)
          : Effect.void,
      )

      yield* Activity.make({
        name: "journal",
        execute: journals
          .send(key, new PostReceiptJournal({ lines: receiptLines(amount, withheld) }))
          .pipe(Effect.asVoid, Effect.orDie),
      })

      // Allocations in the order given. A refused one stops the run; earlier ones stay.
      yield* Effect.forEach(
        allocations,
        ({ invoiceId, amount: part }) =>
          Activity.make({
            name: `allocate:${invoiceId}`,
            error: AllocationExceedsOpen,
            execute: invoices
              .send(
                InvoiceId.make(invoiceId),
                new AllocateToInvoice({ invoiceId, receiptId: key, amount: part }),
              )
              .pipe(Effect.asVoid),
          }).pipe(
            Effect.andThen(
              Activity.make({
                name: `note:${invoiceId}`,
                execute: receipts
                  .send(key, new NoteAllocation({ invoiceId, amount: part }))
                  .pipe(Effect.asVoid, Effect.orDie),
              }),
            ),
          ),
        { discard: true },
      )
    })
  }),
)

/** Starts the staging once the receipt is recorded. */
export class ReceiptApplication extends Domain.Policy("ReceiptApplication", {
  from: WithholdingReceipt,
  on: [ReceiptRecorded],
}) {}

export const ReceiptApplicationLive = ReceiptApplication.toLayer(
  Effect.gen(function* () {
    const runs = yield* ApplyReceipt

    return Effect.fn(function* ({ source, event }) {
      yield* runs.start(source, {
        amount: event.amount,
        withheld: event.withheld,
        allocations: event.allocations,
      })
    })
  }),
)

export class SettlementWithholding extends Domain.Model("SettlementWithholding", {
  aggregates: [WithholdingReceipt, ReceiptJournal, SettledInvoice],
  policies: [ReceiptApplication],
  sagas: [ApplyReceipt],
}) {}

export const SettlementWithholdingHandlers = Layer.mergeAll(
  ApplyReceiptLive,
  ReceiptApplicationLive,
)
