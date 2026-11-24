/**
 * Supplier bills staged for ADR-0124 phase 5 (`BIL-BILL-1`). Production locks the confirmed purchase
 * order and, per line, bills the received quantity less returned less net billed (billed on supplier
 * bills less credited on supplier credit notes), reading received and returned from Procurement's
 * matching view and billed from its own tables, so two simultaneous bills cannot both take the same
 * receipt. On the Effect Cluster host Procurement and Billing commit separately, so Billing owns a
 * tracker per purchase order that is fed by Procurement's events and decides the bill itself. This
 * model states that staging and nothing else; there is no cutover.
 *
 * - **The tracker is an aggregate, not a projection.** It holds received, returned, billed, and
 *   credited quantity per line, so "billable" and the record of the bill are one commit and two
 *   bills for the same receipt serialize on it: the second sees what the first took.
 * - **Billable is received less returned less billed plus credited,** per line, exactly the
 *   production arithmetic. A return after a bill can leave it negative; the line then bills nothing.
 * - **A receipt or return is billable-relevant only once the tracker has it.** Between Procurement
 *   recording a receipt and the policy feeding the tracker, a bill for it is refused as exceeding
 *   the receipt. Too early, never too late. A return that has not arrived yet is the dangerous
 *   direction: a bill can still take quantity that is about to be returned, which production's
 *   single transaction does not allow. The owner must accept that lag or keep the rule.
 * - **Excess needs a covering approval** (`BIL-BILL-2`): a bill beyond billable records only with an
 *   approved variance of at least the excess valued at the bill's price, and then matches only the
 *   billable part. Who approves is the approval service's; here the amount is a command input.
 * - **A line not on the order, or an order not confirmed, is refused.** The tracker accepts the
 *   confirmation, receipts, and returns in any order, because independent policies feed it.
 * - **Repeated ids record nothing,** for a receipt, a return, a credit, and a bill.
 *
 * Not modelled: the journal and the credit note's own staging (`supplier-bill-staging-model.ts`),
 * which feeds the credited quantity back as `TrackCredit` here; the approval's requester and
 * approver; tax; the bill date; the capability. Test-only: not exported from `mod.ts`.
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

// ---------------------------------------------------------------- what Procurement emits

export const PurchaseOrderId = Schema.String.pipe(Schema.brand("FeedPurchaseOrderId"))

const OrderedLine = Schema.Struct({ lineId: Schema.String, unitPrice: Schema.String })
const QuantityLine = Schema.Struct({ lineId: Schema.String, quantity: Schema.String })

export class PurchaseWasConfirmed extends Domain.Event("FeedPurchaseConfirmed", {
  lines: Schema.Array(OrderedLine),
}) {}

export class ReceiptWasRecorded extends Domain.Event("FeedReceiptRecorded", {
  receiptId: Schema.String,
  lines: Schema.Array(QuantityLine),
}) {}

export class ReturnWasRecorded extends Domain.Event("FeedReturnRecorded", {
  returnId: Schema.String,
  lines: Schema.Array(QuantityLine),
}) {}

export class ConfirmFeedPurchase extends Domain.Command("ConfirmFeedPurchase", {
  target: PurchaseOrderId,
  input: { lines: Schema.Array(OrderedLine) },
  events: [PurchaseWasConfirmed],
}) {}

export class RecordFeedReceipt extends Domain.Command("RecordFeedReceipt", {
  target: PurchaseOrderId,
  input: { receiptId: Schema.String, lines: Schema.Array(QuantityLine) },
  events: [ReceiptWasRecorded],
}) {}

export class RecordFeedReturn extends Domain.Command("RecordFeedReturn", {
  target: PurchaseOrderId,
  input: { returnId: Schema.String, lines: Schema.Array(QuantityLine) },
  events: [ReturnWasRecorded],
}) {}

/** The Procurement side as far as Billing sees it: each fact once per id. */
export class FeedPurchase extends Domain.Aggregate("FeedPurchase", {
  id: PurchaseOrderId,
  state: Schema.Struct({ confirmed: Schema.Boolean, ids: Schema.Array(Schema.String) }),
  initial: { confirmed: false, ids: [] },
  commands: [ConfirmFeedPurchase, RecordFeedReceipt, RecordFeedReturn],
  decide: {
    ConfirmFeedPurchase: (s, cmd) =>
      s.confirmed ? [] : [new PurchaseWasConfirmed({ lines: cmd.lines })],
    RecordFeedReceipt: (s, cmd) =>
      s.ids.includes(cmd.receiptId)
        ? []
        : [new ReceiptWasRecorded({ receiptId: cmd.receiptId, lines: cmd.lines })],
    RecordFeedReturn: (s, cmd) =>
      s.ids.includes(cmd.returnId)
        ? []
        : [new ReturnWasRecorded({ returnId: cmd.returnId, lines: cmd.lines })],
  },
  evolve: {
    FeedPurchaseConfirmed: (s) => ({ ...s, confirmed: true }),
    FeedReceiptRecorded: (s, e) => ({ ...s, ids: [...s.ids, e.receiptId] }),
    FeedReturnRecorded: (s, e) => ({ ...s, ids: [...s.ids, e.returnId] }),
  },
}) {}

// ---------------------------------------------------------------- the tracker

export const TrackedPurchaseId = Schema.String.pipe(Schema.brand("TrackedPurchaseId"))

export class PurchaseOrderNotConfirmed extends Domain.Rejection("PurchaseOrderNotConfirmed") {}

export class BillExceedsReceipt extends Domain.Rejection("BillExceedsReceipt", {
  lineId: Schema.String,
  billable: Schema.String,
  requested: Schema.String,
}) {}

const BilledLine = Schema.Struct({
  lineId: Schema.String,
  quantity: Schema.String,
  matched: Schema.String,
  matchedValue: Schema.String,
})

const RequestedLine = Schema.Struct({
  lineId: Schema.String,
  quantity: Schema.String,
  unitPrice: Schema.String,
})

export class PurchaseConfirmationTracked extends Domain.Event("PurchaseConfirmationTracked", {
  lines: Schema.Array(OrderedLine),
}) {}

export class ReceiptTracked extends Domain.Event("ReceiptTracked", {
  receiptId: Schema.String,
  lines: Schema.Array(QuantityLine),
}) {}

export class ReturnTracked extends Domain.Event("ReturnTracked", {
  returnId: Schema.String,
  lines: Schema.Array(QuantityLine),
}) {}

export class CreditTracked extends Domain.Event("CreditTracked", {
  creditId: Schema.String,
  lines: Schema.Array(QuantityLine),
}) {}

export class BillRecorded extends Domain.Event("PurchaseBillRecorded", {
  billId: Schema.String,
  lines: Schema.Array(BilledLine),
}) {}

export class TrackPurchaseConfirmation extends Domain.Command("TrackPurchaseConfirmation", {
  target: TrackedPurchaseId,
  input: { lines: Schema.Array(OrderedLine) },
  events: [PurchaseConfirmationTracked],
}) {}

export class TrackReceipt extends Domain.Command("TrackReceipt", {
  target: TrackedPurchaseId,
  input: { receiptId: Schema.String, lines: Schema.Array(QuantityLine) },
  events: [ReceiptTracked],
}) {}

export class TrackReturn extends Domain.Command("TrackReturn", {
  target: TrackedPurchaseId,
  input: { returnId: Schema.String, lines: Schema.Array(QuantityLine) },
  events: [ReturnTracked],
}) {}

export class TrackCredit extends Domain.Command("TrackCredit", {
  target: TrackedPurchaseId,
  input: { creditId: Schema.String, lines: Schema.Array(QuantityLine) },
  events: [CreditTracked],
}) {}

export class BillOrder extends Domain.Command("BillOrder", {
  target: TrackedPurchaseId,
  input: {
    billId: Schema.String,
    lines: Schema.Array(RequestedLine),
    /** The amount of an approved variance for this bill, or none. */
    approvedVariance: Schema.NullOr(Schema.String),
  },
  events: [BillRecorded],
  rejects: [PurchaseOrderNotConfirmed, BillExceedsReceipt],
}) {}

const Quantities = Schema.Record(Schema.String, Schema.String)

const Tracked = Schema.Struct({
  confirmed: Schema.Boolean,
  prices: Schema.Record(Schema.String, Schema.String),
  received: Quantities,
  returned: Quantities,
  billed: Quantities,
  credited: Quantities,
  ids: Schema.Array(Schema.String),
})

type Tracked = typeof Tracked.Type

const quantityOf = (record: Readonly<Record<string, string>>, lineId: string) =>
  BigInt(record[lineId] ?? "0")

const added = (
  record: Readonly<Record<string, string>>,
  lines: ReadonlyArray<{ readonly lineId: string; readonly quantity: string }>,
) => {
  const next = { ...record }

  for (const line of lines) {
    next[line.lineId] = String(quantityOf(next, line.lineId) + BigInt(line.quantity))
  }

  return next
}

/** Received less returned less net billed, the production arithmetic of `matchBill`. */
const billableOf = (s: Tracked, lineId: string) =>
  quantityOf(s.received, lineId) -
  quantityOf(s.returned, lineId) -
  (quantityOf(s.billed, lineId) - quantityOf(s.credited, lineId))

/** Received, returned, billed, and credited quantity per purchase order line. */
export class BilledOrder extends Domain.Aggregate("BilledOrder", {
  id: TrackedPurchaseId,
  state: Tracked,
  initial: {
    confirmed: false,
    prices: {},
    received: {},
    returned: {},
    billed: {},
    credited: {},
    ids: [],
  },
  commands: [TrackPurchaseConfirmation, TrackReceipt, TrackReturn, TrackCredit, BillOrder],
  decide: {
    TrackPurchaseConfirmation: (s, cmd) =>
      s.confirmed ? [] : [new PurchaseConfirmationTracked({ lines: cmd.lines })],
    TrackReceipt: (s, cmd) =>
      s.ids.includes(cmd.receiptId)
        ? []
        : [new ReceiptTracked({ receiptId: cmd.receiptId, lines: cmd.lines })],
    TrackReturn: (s, cmd) =>
      s.ids.includes(cmd.returnId)
        ? []
        : [new ReturnTracked({ returnId: cmd.returnId, lines: cmd.lines })],
    TrackCredit: (s, cmd) =>
      s.ids.includes(cmd.creditId)
        ? []
        : [new CreditTracked({ creditId: cmd.creditId, lines: cmd.lines })],
    BillOrder: (s, cmd) => {
      if (s.ids.includes(cmd.billId)) return []

      if (!s.confirmed) return new PurchaseOrderNotConfirmed()

      const lines: Array<typeof BilledLine.Type> = []
      let excess = 0n
      let first: BillExceedsReceipt | undefined

      for (const requested of cmd.lines) {
        const price = s.prices[requested.lineId]

        if (price === undefined) {
          return new BillExceedsReceipt({
            lineId: requested.lineId,
            billable: "0",
            requested: "0",
          })
        }

        const billable = billableOf(s, requested.lineId)
        const quantity = BigInt(requested.quantity)
        const matched = quantity < billable ? quantity : billable > 0n ? billable : 0n

        if (quantity > matched) {
          excess += (quantity - matched) * minor(requested.unitPrice)
          first ??= new BillExceedsReceipt({
            lineId: requested.lineId,
            billable: String(billable),
            requested: String(quantity),
          })
        }

        lines.push({
          lineId: requested.lineId,
          quantity: requested.quantity,
          matched: String(matched),
          matchedValue: major(matched * minor(price)),
        })
      }

      const covered = cmd.approvedVariance !== null && minor(cmd.approvedVariance) >= excess

      if (first !== undefined && !covered) return first

      return [new BillRecorded({ billId: cmd.billId, lines })]
    },
  },
  evolve: {
    PurchaseConfirmationTracked: (s, e) => ({
      ...s,
      confirmed: true,
      prices: Object.fromEntries(e.lines.map((line) => [line.lineId, line.unitPrice])),
    }),
    ReceiptTracked: (s, e) => ({
      ...s,
      received: added(s.received, e.lines),
      ids: [...s.ids, e.receiptId],
    }),
    ReturnTracked: (s, e) => ({
      ...s,
      returned: added(s.returned, e.lines),
      ids: [...s.ids, e.returnId],
    }),
    CreditTracked: (s, e) => ({
      ...s,
      credited: added(s.credited, e.lines),
      ids: [...s.ids, e.creditId],
    }),
    PurchaseBillRecorded: (s, e) => ({
      ...s,
      billed: added(
        s.billed,
        e.lines.map((line) => ({ lineId: line.lineId, quantity: line.quantity })),
      ),
      ids: [...s.ids, e.billId],
    }),
  },
}) {}

// ---------------------------------------------------------------- the policies

/** Feeds the tracker the confirmation Procurement recorded. */
export class PurchaseConfirmationTracking extends Domain.Policy("PurchaseConfirmationTracking", {
  from: FeedPurchase,
  on: [PurchaseWasConfirmed],
}) {}

export const PurchaseConfirmationTrackingLive = PurchaseConfirmationTracking.toLayer(
  Effect.gen(function* () {
    const orders = yield* BilledOrder

    return Effect.fn(function* ({ source, event }) {
      yield* orders
        .send(
          TrackedPurchaseId.make(source.id),
          new TrackPurchaseConfirmation({ lines: event.lines }),
        )
        .pipe(Effect.asVoid, Effect.orDie)
    })
  }),
)

/** Feeds the tracker each receipt. */
export class ReceiptTracking extends Domain.Policy("ReceiptTracking", {
  from: FeedPurchase,
  on: [ReceiptWasRecorded],
}) {}

export const ReceiptTrackingLive = ReceiptTracking.toLayer(
  Effect.gen(function* () {
    const orders = yield* BilledOrder

    return Effect.fn(function* ({ source, event }) {
      yield* orders
        .send(
          TrackedPurchaseId.make(source.id),
          new TrackReceipt({ receiptId: event.receiptId, lines: event.lines }),
        )
        .pipe(Effect.asVoid, Effect.orDie)
    })
  }),
)

/** Feeds the tracker each return. */
export class ReturnTracking extends Domain.Policy("ReturnTracking", {
  from: FeedPurchase,
  on: [ReturnWasRecorded],
}) {}

export const ReturnTrackingLive = ReturnTracking.toLayer(
  Effect.gen(function* () {
    const orders = yield* BilledOrder

    return Effect.fn(function* ({ source, event }) {
      yield* orders
        .send(
          TrackedPurchaseId.make(source.id),
          new TrackReturn({ returnId: event.returnId, lines: event.lines }),
        )
        .pipe(Effect.asVoid, Effect.orDie)
    })
  }),
)

export class BillingBilling extends Domain.Model("BillingBilling", {
  aggregates: [FeedPurchase, BilledOrder],
  policies: [PurchaseConfirmationTracking, ReceiptTracking, ReturnTracking],
}) {}

export const BillingBillingHandlers = Layer.mergeAll(
  PurchaseConfirmationTrackingLive,
  ReceiptTrackingLive,
  ReturnTrackingLive,
)
