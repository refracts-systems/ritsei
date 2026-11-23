/**
 * Receiving goods staged for ADR-0124 phase 4 (`PRC-RCPT-1`, `PRC-VRCPT-1`). Production records the
 * receipt, receives the stock and posts the GRNI journal in one transaction. On the Effect Cluster
 * host those are three aggregates and three commits, so the facts are kept and the steps are
 * staged. This model states that staging and nothing else; there is no cutover.
 *
 * - **The cap lives on one aggregate.** `OrderReceiving` holds what each line ordered and what was
 *   received, so `PurchaseReceiptQuantityExceeded` is decided where the tally is, and a repeated
 *   receipt id is a no-op. It is opened by policies from the order's `PurchaseOrderDrafted` (the
 *   lines) and `PurchaseOrderConfirmed`; a receipt before then is refused with `ReceivingNotOpen`,
 *   the new lag state of the phase.
 * - **Cancellation and receiving share that aggregate.** Production blocks cancelling an order that
 *   has a receipt. Staged, the cancel service sends `CloseReceiving` first and sends
 *   `CancelPurchaseOrder` only if it succeeded, so a receipt that is still being applied blocks
 *   the cancellation and a cancelled order cannot be received. Closing before the receiving is
 *   open is refused, so a draft cannot be closed and then never opened. Assumes the events of one
 *   order reach the policies in order.
 * - **A receipt cannot be refused after it is recorded.** The goods arrived. A refused stock or
 *   journal step parks the receipt for a person; nothing is reversed and nothing is retried
 *   forever. Stock received before the refusal stays received.
 * - **Not modelled here:** the `GR/` number (a sequence aggregate, deliverable 5), fractional
 *   quantities (integers only), and who resumes a parked receipt.
 *
 * Test-only: not exported from `mod.ts`.
 */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { Activity, Workflow } from "effect/workflow"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import { requireExactMajorToMinor } from "../../../../framework/foundation/mod.ts"
import {
  PurchaseOrder,
  PurchaseOrderConfirmed,
  PurchaseOrderDrafted,
  PurchaseOrderHasReceipts,
  PurchaseOrderId,
} from "./domain-model.ts"

// ---------------------------------------------------------------- the receiving of an order

export class ReceivingNotOpen extends Domain.Rejection("ReceivingNotOpen") {}

export class ReceiptQuantityExceeded extends Domain.Rejection("ReceiptQuantityExceeded", {
  itemId: Schema.String,
}) {}

const OrderedLine = Schema.Struct({
  itemId: Schema.String,
  quantity: Schema.String,
  unitPrice: Schema.String,
})

const ReceivedLine = Schema.Struct({ itemId: Schema.String, quantity: Schema.String })

/** The line as the saga needs it: what arrived, at the order's price. */
const ReceiptLine = Schema.Struct({
  itemId: Schema.String,
  quantity: Schema.String,
  unitPrice: Schema.String,
})

export class ReceivingPrepared extends Domain.Event("ReceivingPrepared", {
  lines: Schema.Array(OrderedLine),
}) {}

export class ReceivingOpened extends Domain.Event("ReceivingOpened", {}) {}

export class ReceiptRecorded extends Domain.Event("ReceiptRecorded", {
  receiptId: Schema.String,
  warehouseId: Schema.String,
  period: Schema.String,
  lines: Schema.Array(ReceiptLine),
}) {}

export class ReceivingClosed extends Domain.Event("ReceivingClosed", {}) {}

export class PrepareReceiving extends Domain.Command("PrepareReceiving", {
  target: PurchaseOrderId,
  input: { lines: Schema.Array(OrderedLine) },
  events: [ReceivingPrepared],
}) {}

export class OpenReceiving extends Domain.Command("OpenReceiving", {
  target: PurchaseOrderId,
  input: {},
  events: [ReceivingOpened],
}) {}

export class RecordReceipt extends Domain.Command("RecordReceipt", {
  target: PurchaseOrderId,
  input: {
    receiptId: Schema.String,
    warehouseId: Schema.String,
    period: Schema.String,
    lines: Schema.Array(ReceivedLine),
  },
  events: [ReceiptRecorded],
  rejects: [ReceivingNotOpen, ReceiptQuantityExceeded],
}) {}

export class CloseReceiving extends Domain.Command("CloseReceiving", {
  target: PurchaseOrderId,
  input: {},
  events: [ReceivingClosed],
  rejects: [ReceivingNotOpen, PurchaseOrderHasReceipts],
}) {}

const Unprepared = Schema.TaggedStruct("Unprepared", {})
const Awaiting = Schema.TaggedStruct("Awaiting", { lines: Schema.Array(OrderedLine) })

const Receiving = Schema.TaggedStruct("Receiving", {
  lines: Schema.Array(OrderedLine),
  received: Schema.Array(ReceivedLine),
  receiptIds: Schema.Array(Schema.String),
})

const Closed = Schema.TaggedStruct("Closed", {})

const sum = (
  lines: ReadonlyArray<{ readonly itemId: string; readonly quantity: string }>,
  id: string,
) => lines.reduce((total, line) => (line.itemId === id ? total + BigInt(line.quantity) : total), 0n)

export class OrderReceiving extends Domain.Aggregate("OrderReceiving", {
  id: PurchaseOrderId,
  state: Schema.Union([Unprepared, Awaiting, Receiving, Closed]),
  initial: Unprepared.make({}),
  commands: [PrepareReceiving, OpenReceiving, RecordReceipt, CloseReceiving],
  decide: {
    PrepareReceiving: (s, cmd) =>
      Predicate.isTagged(s, "Unprepared") ? [new ReceivingPrepared({ lines: cmd.lines })] : [],
    OpenReceiving: (s) => (Predicate.isTagged(s, "Awaiting") ? [new ReceivingOpened()] : []),
    RecordReceipt: (s, cmd) => {
      if (!Predicate.isTagged(s, "Receiving")) return new ReceivingNotOpen()

      if (s.receiptIds.includes(cmd.receiptId)) return []

      const priced = []

      for (const line of cmd.lines) {
        const ordered = s.lines.find((candidate) => candidate.itemId === line.itemId)
        const remaining = sum(s.lines, line.itemId) - sum(s.received, line.itemId)

        if (ordered === undefined || BigInt(line.quantity) > remaining) {
          return new ReceiptQuantityExceeded({ itemId: line.itemId })
        }

        priced.push({ ...line, unitPrice: ordered.unitPrice })
      }

      return [
        new ReceiptRecorded({
          receiptId: cmd.receiptId,
          warehouseId: cmd.warehouseId,
          period: cmd.period,
          lines: priced,
        }),
      ]
    },
    CloseReceiving: (s) => {
      if (Predicate.isTagged(s, "Closed")) return []

      if (!Predicate.isTagged(s, "Receiving")) return new ReceivingNotOpen()

      return s.receiptIds.length > 0 ? new PurchaseOrderHasReceipts() : [new ReceivingClosed()]
    },
  },
  evolve: {
    ReceivingPrepared: (_, e) => Awaiting.make({ lines: e.lines }),
    ReceivingOpened: (s) =>
      Predicate.isTagged(s, "Awaiting")
        ? Receiving.make({ lines: s.lines, received: [], receiptIds: [] })
        : s,
    ReceiptRecorded: (s, e) =>
      Predicate.isTagged(s, "Receiving")
        ? Receiving.make({
            lines: s.lines,
            received: [
              ...s.received,
              ...e.lines.map(({ itemId, quantity }) => ({ itemId, quantity })),
            ],
            receiptIds: [...s.receiptIds, e.receiptId],
          })
        : s,
    ReceivingClosed: () => Closed.make({}),
  },
}) {}

// ---------------------------------------------------------------- the stock of an item

/** `<warehouse>/<item>`. */
export const StockId = Schema.String.pipe(Schema.brand("ReceiptStockId"))

export class StockItemInactive extends Domain.Rejection("ReceiptStockItemInactive", {
  itemId: Schema.String,
}) {}

export class StockReceived extends Domain.Event("ReceiptStockReceived", {
  receiptId: Schema.String,
  quantity: Schema.String,
}) {}

export class StockItemDeactivated extends Domain.Event("ReceiptStockItemDeactivated", {}) {}

export class ReceiveStock extends Domain.Command("ReceiveReceiptStock", {
  target: StockId,
  input: { receiptId: Schema.String, itemId: Schema.String, quantity: Schema.String },
  events: [StockReceived],
  rejects: [StockItemInactive],
}) {}

export class DeactivateStockItem extends Domain.Command("DeactivateReceiptStockItem", {
  target: StockId,
  input: {},
  events: [StockItemDeactivated],
}) {}

const ActiveStock = Schema.TaggedStruct("ActiveStock", { receiptIds: Schema.Array(Schema.String) })
const InactiveStock = Schema.TaggedStruct("InactiveStock", {})

export class ReceiptStock extends Domain.Aggregate("ReceiptStock", {
  id: StockId,
  state: Schema.Union([ActiveStock, InactiveStock]),
  initial: ActiveStock.make({ receiptIds: [] }),
  commands: [ReceiveStock, DeactivateStockItem],
  decide: {
    ReceiveReceiptStock: (s, cmd) => {
      if (!Predicate.isTagged(s, "ActiveStock"))
        return new StockItemInactive({ itemId: cmd.itemId })

      return s.receiptIds.includes(cmd.receiptId)
        ? []
        : [new StockReceived({ receiptId: cmd.receiptId, quantity: cmd.quantity })]
    },
    DeactivateReceiptStockItem: (s) =>
      Predicate.isTagged(s, "ActiveStock") ? [new StockItemDeactivated()] : [],
  },
  evolve: {
    ReceiptStockReceived: (s, e) =>
      Predicate.isTagged(s, "ActiveStock")
        ? ActiveStock.make({ receiptIds: [...s.receiptIds, e.receiptId] })
        : s,
    ReceiptStockItemDeactivated: () => InactiveStock.make({}),
  },
}) {}

// ---------------------------------------------------------------- the GRNI journal of a period

export const PeriodId = Schema.String.pipe(Schema.brand("ReceiptPeriodId"))

export class PeriodClosed extends Domain.Rejection("ReceiptPeriodClosed") {}

export class GrniJournalPosted extends Domain.Event("GrniJournalPosted", {
  reference: Schema.String,
  amountMinor: Schema.String,
}) {}

export class PeriodWasClosed extends Domain.Event("ReceiptPeriodWasClosed", {}) {}

export class PostGrniJournal extends Domain.Command("PostGrniJournal", {
  target: PeriodId,
  input: { reference: Schema.String, amountMinor: Schema.String },
  events: [GrniJournalPosted],
  rejects: [PeriodClosed],
}) {}

export class ClosePeriod extends Domain.Command("CloseReceiptPeriod", {
  target: PeriodId,
  input: {},
  events: [PeriodWasClosed],
}) {}

const OpenPeriod = Schema.TaggedStruct("OpenPeriod", { references: Schema.Array(Schema.String) })
const ClosedPeriod = Schema.TaggedStruct("ClosedPeriod", {})

export class ReceiptLedger extends Domain.Aggregate("ReceiptLedger", {
  id: PeriodId,
  state: Schema.Union([OpenPeriod, ClosedPeriod]),
  initial: OpenPeriod.make({ references: [] }),
  commands: [PostGrniJournal, ClosePeriod],
  decide: {
    PostGrniJournal: (s, cmd) => {
      if (!Predicate.isTagged(s, "OpenPeriod")) return new PeriodClosed()

      return s.references.includes(cmd.reference)
        ? []
        : [new GrniJournalPosted({ reference: cmd.reference, amountMinor: cmd.amountMinor })]
    },
    CloseReceiptPeriod: (s) => (Predicate.isTagged(s, "OpenPeriod") ? [new PeriodWasClosed()] : []),
  },
  evolve: {
    GrniJournalPosted: (s, e) =>
      Predicate.isTagged(s, "OpenPeriod")
        ? OpenPeriod.make({ references: [...s.references, e.reference] })
        : s,
    ReceiptPeriodWasClosed: () => ClosedPeriod.make({}),
  },
}) {}

// ---------------------------------------------------------------- the status of a receipt

export const ReceiptId = Schema.String.pipe(Schema.brand("ReceiptId"))

export class ReceiptApplied extends Domain.Event("ReceiptApplied", {}) {}

/** The receipt stays recorded and a person decides what happens next. */
export class ReceiptParked extends Domain.Event("ReceiptParked", { reason: Schema.String }) {}

export class MarkReceiptApplied extends Domain.Command("MarkReceiptApplied", {
  target: ReceiptId,
  input: {},
  events: [ReceiptApplied],
}) {}

export class ParkReceipt extends Domain.Command("ParkReceipt", {
  target: ReceiptId,
  input: { reason: Schema.String },
  events: [ReceiptParked],
}) {}

const Applying = Schema.TaggedStruct("Applying", {})
const Applied = Schema.TaggedStruct("Applied", {})
const Parked = Schema.TaggedStruct("Parked", { reason: Schema.String })

export class ReceiptStatus extends Domain.Aggregate("ReceiptStatus", {
  id: ReceiptId,
  state: Schema.Union([Applying, Applied, Parked]),
  initial: Applying.make({}),
  commands: [MarkReceiptApplied, ParkReceipt],
  decide: {
    MarkReceiptApplied: (s) => (Predicate.isTagged(s, "Applying") ? [new ReceiptApplied()] : []),
    ParkReceipt: (s, cmd) =>
      Predicate.isTagged(s, "Applying") ? [new ReceiptParked({ reason: cmd.reason })] : [],
  },
  evolve: {
    ReceiptApplied: () => Applied.make({}),
    ReceiptParked: (_, e) => Parked.make({ reason: e.reason }),
  },
}) {}

// ---------------------------------------------------------------- the saga

const ApplyInput = {
  receiptId: Schema.String,
  warehouseId: Schema.String,
  period: Schema.String,
  lines: Schema.Array(ReceiptLine),
}

type Run = Schema.Struct<typeof ApplyInput>["Type"] & { readonly key: typeof ReceiptId.Type }

export class ApplyReceipt extends Domain.Saga("ApplyReceipt", {
  key: ReceiptId,
  input: ApplyInput,
  rejects: [StockItemInactive, PeriodClosed],
}) {}

const valueMinor = (lines: Run["lines"]) =>
  lines.reduce(
    (total, line) => total + BigInt(line.quantity) * requireExactMajorToMinor(line.unitPrice, 2),
    0n,
  )

export const ApplyReceiptLive = ApplyReceipt.toLayer(
  Effect.gen(function* () {
    const stocks = yield* ReceiptStock
    const ledgers = yield* ReceiptLedger
    const statuses = yield* ReceiptStatus

    return Effect.fn(function* ({ key, receiptId, warehouseId, period, lines }: Run) {
      // A refused step parks the receipt. Nothing is compensated: the goods arrived.
      yield* Workflow.addFinalizer((exit) =>
        Exit.isFailure(exit)
          ? statuses
              .send(key, new ParkReceipt({ reason: "a later step was refused" }))
              .pipe(Effect.asVoid, Effect.orDie)
          : Effect.void,
      )

      yield* Effect.forEach(
        lines,
        ({ itemId, quantity }) =>
          Activity.make({
            name: `stock:${itemId}`,
            error: StockItemInactive,
            execute: stocks
              .send(
                StockId.make(`${warehouseId}/${itemId}`),
                new ReceiveStock({ receiptId, itemId, quantity }),
              )
              .pipe(Effect.asVoid),
          }),
        { discard: true },
      )

      yield* Activity.make({
        name: "journal",
        error: PeriodClosed,
        execute: ledgers
          .send(
            PeriodId.make(period),
            new PostGrniJournal({
              reference: `receipt:${receiptId}`,
              amountMinor: String(valueMinor(lines)),
            }),
          )
          .pipe(Effect.asVoid),
      })

      yield* Activity.make({
        name: "applied",
        execute: statuses.send(key, new MarkReceiptApplied({})).pipe(Effect.asVoid, Effect.orDie),
      })
    })
  }),
)

// ---------------------------------------------------------------- the policies

export class ReceivingPreparation extends Domain.Policy("ReceivingPreparation", {
  from: PurchaseOrder,
  on: [PurchaseOrderDrafted],
}) {}

export const ReceivingPreparationLive = ReceivingPreparation.toLayer(
  Effect.gen(function* () {
    const receivings = yield* OrderReceiving

    return Effect.fn(function* ({ source, event }) {
      yield* receivings
        .send(source.id, new PrepareReceiving({ lines: event.lines }))
        .pipe(Effect.asVoid, Effect.orDie)
    })
  }),
)

export class ReceivingOpening extends Domain.Policy("ReceivingOpening", {
  from: PurchaseOrder,
  on: [PurchaseOrderConfirmed],
}) {}

export const ReceivingOpeningLive = ReceivingOpening.toLayer(
  Effect.gen(function* () {
    const receivings = yield* OrderReceiving

    return Effect.fn(function* ({ source }) {
      yield* receivings.send(source.id, new OpenReceiving({})).pipe(Effect.asVoid, Effect.orDie)
    })
  }),
)

export class ReceiptApplication extends Domain.Policy("ReceiptApplication", {
  from: OrderReceiving,
  on: [ReceiptRecorded],
}) {}

export const ReceiptApplicationLive = ReceiptApplication.toLayer(
  Effect.gen(function* () {
    const runs = yield* ApplyReceipt

    return Effect.fn(function* ({ event }) {
      yield* runs.start(ReceiptId.make(event.receiptId), {
        receiptId: event.receiptId,
        warehouseId: event.warehouseId,
        period: event.period,
        lines: event.lines,
      })
    })
  }),
)

export class ProcurementReceiving extends Domain.Model("ProcurementReceiving", {
  aggregates: [PurchaseOrder, OrderReceiving, ReceiptStock, ReceiptLedger, ReceiptStatus],
  policies: [ReceivingPreparation, ReceivingOpening, ReceiptApplication],
  sagas: [ApplyReceipt],
}) {}

export const ProcurementReceivingHandlers = Layer.mergeAll(
  ApplyReceiptLive,
  ReceivingPreparationLive,
  ReceivingOpeningLive,
  ReceiptApplicationLive,
)
