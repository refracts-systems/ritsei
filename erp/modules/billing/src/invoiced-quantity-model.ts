/**
 * Customer invoices staged for ADR-0124 phase 5 (`BIL-INV-1`). Production locks the sales order,
 * reads each line's delivered quantity from Sales and the quantity already on customer invoices
 * from Billing's own tables, and posts the invoice and its journal in one transaction, so of two
 * simultaneous invoices for the same deliveries only one posts. On the Effect Cluster host Sales
 * and Billing commit separately and there is no cross-aggregate lock, so Billing owns a tracker per
 * sales order that is fed by Sales' events and decides the invoice itself. This model states that
 * staging and nothing else; there is no cutover.
 *
 * - **The tracker is an aggregate, not a projection.** It holds delivered and invoiced quantity per
 *   line, so the decision "delivered less invoiced" and the record of the invoice are one commit.
 *   Two invoices for the same deliveries serialize on the tracker: the second finds nothing left.
 * - **Billing sees only completed deliveries.** The tracker is fed by the event that Sales emits
 *   when a delivery is recorded, so a delivery that Sales refused or rolled back never becomes
 *   invoiceable. That holds only while Sales emits it after the stock issue succeeds (`SAL-DLV-2`,
 *   step order of variant A); this model takes the event as given and does not prove that.
 * - **A delivery is invoiceable only after the tracker has it.** Between Sales recording a delivery
 *   and the policy feeding the tracker, an invoice finds nothing and fails with `NothingToInvoice`,
 *   exactly as for a delivery that does not exist. Too early, never too late.
 * - **The tracker may learn of a delivery before the confirmation.** Both are fed by independent
 *   policies, so the tracker accepts them in either order; the invoice needs both.
 * - **Repeated ids record nothing,** for a delivery, an invoice, and a journal.
 * - **The journal follows the invoice:** receivable for the total, revenue for the subtotal, output
 *   tax for the tax. Until it posts, the invoice is recorded without its journal.
 *
 * Stand-ins: tax is a whole number of basis points per line, rounded half up per line, in place of
 * the Tax module at the document's tax date. Not modelled: the gapless `INV/` number (`BIL-DOC-1`),
 * the invoice date and its period, credit notes against the invoice, the capability, and product
 * descriptions. Test-only: not exported from `mod.ts`.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  formatSignedMinor,
  requireExactMajorToMinor,
} from "../../../../framework/foundation/mod.ts"

const minor = (value: string) => requireExactMajorToMinor(value, 2)
const major = (value: bigint) => formatSignedMinor(value, 2)

// ---------------------------------------------------------------- what Sales emits

export const SalesOrderId = Schema.String.pipe(Schema.brand("FeedOrderId"))

const PricedLine = Schema.Struct({
  lineId: Schema.String,
  unitPrice: Schema.String,
  taxBps: Schema.Int,
})

const DeliveredLine = Schema.Struct({ lineId: Schema.String, quantity: Schema.String })

export class OrderWasConfirmed extends Domain.Event("FeedOrderConfirmed", {
  lines: Schema.Array(PricedLine),
}) {}

export class DeliveryWasCompleted extends Domain.Event("FeedDeliveryCompleted", {
  deliveryId: Schema.String,
  lines: Schema.Array(DeliveredLine),
}) {}

export class ConfirmFeedOrder extends Domain.Command("ConfirmFeedOrder", {
  target: SalesOrderId,
  input: { lines: Schema.Array(PricedLine) },
  events: [OrderWasConfirmed],
}) {}

export class CompleteFeedDelivery extends Domain.Command("CompleteFeedDelivery", {
  target: SalesOrderId,
  input: { deliveryId: Schema.String, lines: Schema.Array(DeliveredLine) },
  events: [DeliveryWasCompleted],
}) {}

/** The Sales side as far as Billing sees it: a confirmation once, a delivery once per id. */
export class FeedOrder extends Domain.Aggregate("FeedOrder", {
  id: SalesOrderId,
  state: Schema.Struct({ confirmed: Schema.Boolean, deliveries: Schema.Array(Schema.String) }),
  initial: { confirmed: false, deliveries: [] },
  commands: [ConfirmFeedOrder, CompleteFeedDelivery],
  decide: {
    ConfirmFeedOrder: (s, cmd) =>
      s.confirmed ? [] : [new OrderWasConfirmed({ lines: cmd.lines })],
    CompleteFeedDelivery: (s, cmd) =>
      s.deliveries.includes(cmd.deliveryId)
        ? []
        : [new DeliveryWasCompleted({ deliveryId: cmd.deliveryId, lines: cmd.lines })],
  },
  evolve: {
    FeedOrderConfirmed: (s) => ({ ...s, confirmed: true }),
    FeedDeliveryCompleted: (s, e) => ({ ...s, deliveries: [...s.deliveries, e.deliveryId] }),
  },
}) {}

// ---------------------------------------------------------------- the tracker

export const TrackedOrderId = Schema.String.pipe(Schema.brand("TrackedOrderId"))

export class OrderNotConfirmed extends Domain.Rejection("OrderNotConfirmed") {}

export class NothingToInvoice extends Domain.Rejection("NothingToInvoice") {}

const InvoicedLine = Schema.Struct({
  lineId: Schema.String,
  quantity: Schema.String,
  net: Schema.String,
  tax: Schema.String,
})

export class ConfirmationTracked extends Domain.Event("ConfirmationTracked", {
  lines: Schema.Array(PricedLine),
}) {}

export class DeliveryTracked extends Domain.Event("DeliveryTracked", {
  deliveryId: Schema.String,
  lines: Schema.Array(DeliveredLine),
}) {}

export class InvoiceRecorded extends Domain.Event("InvoiceRecorded", {
  invoiceId: Schema.String,
  lines: Schema.Array(InvoicedLine),
  subtotal: Schema.String,
  taxTotal: Schema.String,
  total: Schema.String,
}) {}

export class TrackConfirmation extends Domain.Command("TrackConfirmation", {
  target: TrackedOrderId,
  input: { lines: Schema.Array(PricedLine) },
  events: [ConfirmationTracked],
}) {}

export class TrackDelivery extends Domain.Command("TrackDelivery", {
  target: TrackedOrderId,
  input: { deliveryId: Schema.String, lines: Schema.Array(DeliveredLine) },
  events: [DeliveryTracked],
}) {}

export class InvoiceOrder extends Domain.Command("InvoiceOrder", {
  target: TrackedOrderId,
  input: { invoiceId: Schema.String },
  events: [InvoiceRecorded],
  rejects: [OrderNotConfirmed, NothingToInvoice],
}) {}

const Tracked = Schema.Struct({
  confirmed: Schema.Boolean,
  prices: Schema.Record(
    Schema.String,
    Schema.Struct({ unitPrice: Schema.String, taxBps: Schema.Int }),
  ),
  delivered: Schema.Record(Schema.String, Schema.String),
  invoiced: Schema.Record(Schema.String, Schema.String),
  deliveries: Schema.Array(Schema.String),
  invoices: Schema.Array(Schema.String),
})

const quantityOf = (record: Readonly<Record<string, string>>, lineId: string) =>
  BigInt(record[lineId] ?? "0")

/** Tax on a net amount at whole basis points, rounded half up. */
const taxOf = (net: bigint, bps: number) => (net * BigInt(bps) + 5000n) / 10000n

/** Delivered and invoiced quantity per sales order line, and the invoices that moved the second. */
export class InvoicedOrder extends Domain.Aggregate("InvoicedOrder", {
  id: TrackedOrderId,
  state: Tracked,
  initial: {
    confirmed: false,
    prices: {},
    delivered: {},
    invoiced: {},
    deliveries: [],
    invoices: [],
  },
  commands: [TrackConfirmation, TrackDelivery, InvoiceOrder],
  decide: {
    TrackConfirmation: (s, cmd) =>
      s.confirmed ? [] : [new ConfirmationTracked({ lines: cmd.lines })],
    TrackDelivery: (s, cmd) =>
      s.deliveries.includes(cmd.deliveryId)
        ? []
        : [new DeliveryTracked({ deliveryId: cmd.deliveryId, lines: cmd.lines })],
    InvoiceOrder: (s, cmd) => {
      if (s.invoices.includes(cmd.invoiceId)) return []

      if (!s.confirmed) return new OrderNotConfirmed()

      const lines = Object.entries(s.prices).flatMap(([lineId, price]) => {
        const quantity = quantityOf(s.delivered, lineId) - quantityOf(s.invoiced, lineId)

        if (quantity <= 0n) return []

        const net = quantity * minor(price.unitPrice)

        return [
          {
            lineId,
            quantity: String(quantity),
            net: major(net),
            tax: major(taxOf(net, price.taxBps)),
            netMinor: net,
            taxMinor: taxOf(net, price.taxBps),
          },
        ]
      })

      if (lines.length === 0) return new NothingToInvoice()

      const subtotal = lines.reduce((sum, line) => sum + line.netMinor, 0n)
      const taxTotal = lines.reduce((sum, line) => sum + line.taxMinor, 0n)

      return [
        new InvoiceRecorded({
          invoiceId: cmd.invoiceId,
          lines: lines.map(({ lineId, quantity, net, tax }) => ({ lineId, quantity, net, tax })),
          subtotal: major(subtotal),
          taxTotal: major(taxTotal),
          total: major(subtotal + taxTotal),
        }),
      ]
    },
  },
  evolve: {
    ConfirmationTracked: (s, e) => ({
      ...s,
      confirmed: true,
      prices: Object.fromEntries(
        e.lines.map((line) => [line.lineId, { unitPrice: line.unitPrice, taxBps: line.taxBps }]),
      ),
    }),
    DeliveryTracked: (s, e) => {
      const delivered = { ...s.delivered }

      for (const line of e.lines) {
        delivered[line.lineId] = String(quantityOf(delivered, line.lineId) + BigInt(line.quantity))
      }

      return { ...s, delivered, deliveries: [...s.deliveries, e.deliveryId] }
    },
    InvoiceRecorded: (s, e) => {
      const invoiced = { ...s.invoiced }

      for (const line of e.lines) {
        invoiced[line.lineId] = String(quantityOf(invoiced, line.lineId) + BigInt(line.quantity))
      }

      return { ...s, invoiced, invoices: [...s.invoices, e.invoiceId] }
    },
  },
}) {}

// ---------------------------------------------------------------- the journal

const JournalLine = Schema.Struct({
  role: Schema.String,
  debit: Schema.String,
  credit: Schema.String,
})

export const InvoiceJournalId = Schema.String.pipe(Schema.brand("InvoiceJournalId"))

export class InvoiceJournalPosted extends Domain.Event("InvoiceJournalPosted", {
  lines: Schema.Array(JournalLine),
}) {}

export class PostInvoiceJournal extends Domain.Command("PostInvoiceJournal", {
  target: InvoiceJournalId,
  input: { lines: Schema.Array(JournalLine) },
  events: [InvoiceJournalPosted],
}) {}

const Unposted = Schema.TaggedStruct("Unposted", {})
const Posted = Schema.TaggedStruct("Posted", {})

/** One journal per invoice; a repeated post is a no-op. */
export class InvoiceJournal extends Domain.Aggregate("InvoiceJournal", {
  id: InvoiceJournalId,
  state: Schema.Union([Unposted, Posted]),
  initial: Unposted.make({}),
  commands: [PostInvoiceJournal],
  decide: {
    PostInvoiceJournal: (s, cmd) =>
      Predicate.isTagged(s, "Unposted") ? [new InvoiceJournalPosted({ lines: cmd.lines })] : [],
  },
  evolve: {
    InvoiceJournalPosted: () => Posted.make({}),
  },
}) {}

/** Receivable for the total, revenue for the subtotal, output tax for the tax. */
export const invoiceLines = (amounts: {
  readonly subtotal: string
  readonly taxTotal: string
  readonly total: string
}): ReadonlyArray<typeof JournalLine.Type> => [
  { role: "receivable", debit: amounts.total, credit: "0" },
  { role: "revenue", debit: "0", credit: amounts.subtotal },
  { role: "output_tax", debit: "0", credit: amounts.taxTotal },
]

// ---------------------------------------------------------------- the policies

/** Feeds the tracker the confirmation Sales recorded. */
export class ConfirmationTracking extends Domain.Policy("ConfirmationTracking", {
  from: FeedOrder,
  on: [OrderWasConfirmed],
}) {}

export const ConfirmationTrackingLive = ConfirmationTracking.toLayer(
  Effect.gen(function* () {
    const orders = yield* InvoicedOrder

    return Effect.fn(function* ({ source, event }) {
      yield* orders
        .send(TrackedOrderId.make(source.id), new TrackConfirmation({ lines: event.lines }))
        .pipe(Effect.asVoid, Effect.orDie)
    })
  }),
)

/** Feeds the tracker every delivery Sales completed, and none it refused. */
export class DeliveryTracking extends Domain.Policy("DeliveryTracking", {
  from: FeedOrder,
  on: [DeliveryWasCompleted],
}) {}

export const DeliveryTrackingLive = DeliveryTracking.toLayer(
  Effect.gen(function* () {
    const orders = yield* InvoicedOrder

    return Effect.fn(function* ({ source, event }) {
      yield* orders
        .send(
          TrackedOrderId.make(source.id),
          new TrackDelivery({ deliveryId: event.deliveryId, lines: event.lines }),
        )
        .pipe(Effect.asVoid, Effect.orDie)
    })
  }),
)

/** Posts the journal of each recorded invoice. */
export class InvoiceJournaling extends Domain.Policy("InvoiceJournaling", {
  from: InvoicedOrder,
  on: [InvoiceRecorded],
}) {}

export const InvoiceJournalingLive = InvoiceJournaling.toLayer(
  Effect.gen(function* () {
    const journals = yield* InvoiceJournal

    return Effect.fn(function* ({ event }) {
      yield* journals
        .send(
          InvoiceJournalId.make(`invoice/${event.invoiceId}`),
          new PostInvoiceJournal({ lines: invoiceLines(event) }),
        )
        .pipe(Effect.asVoid, Effect.orDie)
    })
  }),
)

export class BillingInvoicing extends Domain.Model("BillingInvoicing", {
  aggregates: [FeedOrder, InvoicedOrder, InvoiceJournal],
  policies: [ConfirmationTracking, DeliveryTracking, InvoiceJournaling],
}) {}

export const BillingInvoicingHandlers = Layer.mergeAll(
  ConfirmationTrackingLive,
  DeliveryTrackingLive,
  InvoiceJournalingLive,
)
