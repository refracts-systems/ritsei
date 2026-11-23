/**
 * The return to a supplier staged for ADR-0124 phase 5 (`PRC-RET-1`). Production records the return,
 * numbers it, and issues the stock at the order line's price against goods received not invoiced in
 * one transaction, so a stock issue that fails (the stock was consumed) leaves no return. On the
 * Effect Cluster host the order, each stock position and the journal commit separately, so the
 * return is recorded first and a saga issues the stock and posts the journal. This model states
 * that staging and nothing else; there is no cutover, and whether the rule moves or stays on its
 * PostgreSQL transaction is the owner's decision.
 *
 * - **The cap is one commit with the record.** The order aggregate holds the received and returned
 *   quantity of each line, so two returns cannot both take the same remainder, and a repeated return
 *   id records nothing.
 * - **Stock leaves at the order price, not at moving average.** The position takes the stated value
 *   (`issueCost`, which restates Inventory's `costIssue`), the last units take what is left, and an issue beyond the
 *   valued quantity or value is refused (`StockValuationUnavailable`).
 * - **A refused issue cancels the return.** The issues made before it are restored, then the order
 *   cancels the return, which frees the returned quantity, and the status shows it cancelled. The
 *   return was visible as recorded for a moment; its id is spent, so the caller returns again under
 *   a new id.
 * - **One journal per return,** debiting GRNI and crediting inventory for the value the positions
 *   gave up, posted only after every position issued.
 *
 * Not modelled: the `RET/` number (it follows the `DO/` sequence pattern of phase 4), the receipt
 * and matching reads, the return date, and the period check of the journal. Test-only: not exported
 * from `mod.ts`.
 */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { Activity, Workflow } from "effect/workflow"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"

// ---------------------------------------------------------------- the stock position

/**
 * What an issue at a stated value takes out of valued stock: the stated value, or what is left when
 * it takes every unit, and nothing when the stock holds fewer units or less value. This restates
 * `costIssue` of Inventory (INV-VAL-3), which is not a public export; the stories pin the same
 * outcomes.
 */
const issueCost = (
  quantity: bigint,
  stated: bigint,
  held: { readonly quantity: bigint; readonly value: bigint },
) => {
  if (held.quantity < quantity) return undefined

  const cost = quantity === held.quantity ? held.value : stated

  return cost > held.value ? undefined : cost
}

/** `<warehouse>/<item>`. */
export const PositionId = Schema.String.pipe(Schema.brand("ReturnPositionId"))

export class StockValuationUnavailable extends Domain.Rejection("ReturnStockValuationUnavailable", {
  itemId: Schema.String,
}) {}

export class StockIn extends Domain.Event("ReturnStockIn", {
  sourceId: Schema.String,
  quantity: Schema.String,
  value: Schema.String,
  onHandAfter: Schema.String,
  valueAfter: Schema.String,
}) {}

export class StockOut extends Domain.Event("ReturnStockOut", {
  returnId: Schema.String,
  quantity: Schema.String,
  value: Schema.String,
  onHandAfter: Schema.String,
  valueAfter: Schema.String,
}) {}

export class StockRestored extends Domain.Event("ReturnStockRestored", {
  returnId: Schema.String,
  onHandAfter: Schema.String,
  valueAfter: Schema.String,
}) {}

export class ReceiveStock extends Domain.Command("ReceiveReturnStock", {
  target: PositionId,
  input: { sourceId: Schema.String, quantity: Schema.String, value: Schema.String },
  events: [StockIn],
}) {}

export class IssueForReturn extends Domain.Command("IssueForReturn", {
  target: PositionId,
  input: {
    returnId: Schema.String,
    itemId: Schema.String,
    quantity: Schema.String,
    /** The order price of the quantity, in minor units. */
    value: Schema.String,
  },
  events: [StockOut],
  rejects: [StockValuationUnavailable],
}) {}

export class RestoreIssue extends Domain.Command("RestoreReturnIssue", {
  target: PositionId,
  input: { returnId: Schema.String },
  events: [StockRestored],
}) {}

const Position = Schema.Struct({
  quantity: Schema.String,
  value: Schema.String,
  sources: Schema.Array(Schema.String),
  issued: Schema.Record(
    Schema.String,
    Schema.Struct({ quantity: Schema.String, value: Schema.String }),
  ),
})

export class ReturnStock extends Domain.Aggregate("ReturnStock", {
  id: PositionId,
  state: Position,
  initial: { quantity: "0", value: "0", sources: [], issued: {} },
  commands: [ReceiveStock, IssueForReturn, RestoreIssue],
  decide: {
    ReceiveReturnStock: (s, cmd) =>
      s.sources.includes(cmd.sourceId)
        ? []
        : [
            new StockIn({
              sourceId: cmd.sourceId,
              quantity: cmd.quantity,
              value: cmd.value,
              onHandAfter: String(BigInt(s.quantity) + BigInt(cmd.quantity)),
              valueAfter: String(BigInt(s.value) + BigInt(cmd.value)),
            }),
          ],
    IssueForReturn: (s, cmd) => {
      if (s.issued[cmd.returnId] !== undefined) return []

      const quantity = BigInt(cmd.quantity)

      const cost = issueCost(quantity, BigInt(cmd.value), {
        quantity: BigInt(s.quantity),
        value: BigInt(s.value),
      })

      if (cost === undefined) return new StockValuationUnavailable({ itemId: cmd.itemId })

      return [
        new StockOut({
          returnId: cmd.returnId,
          quantity: cmd.quantity,
          value: String(cost),
          onHandAfter: String(BigInt(s.quantity) - quantity),
          valueAfter: String(BigInt(s.value) - cost),
        }),
      ]
    },
    RestoreReturnIssue: (s, cmd) => {
      const taken = s.issued[cmd.returnId]

      return taken === undefined
        ? []
        : [
            new StockRestored({
              returnId: cmd.returnId,
              onHandAfter: String(BigInt(s.quantity) + BigInt(taken.quantity)),
              valueAfter: String(BigInt(s.value) + BigInt(taken.value)),
            }),
          ]
    },
  },
  evolve: {
    ReturnStockIn: (s, e) => ({
      ...s,
      quantity: e.onHandAfter,
      value: e.valueAfter,
      sources: [...s.sources, e.sourceId],
    }),
    ReturnStockOut: (s, e) => ({
      ...s,
      quantity: e.onHandAfter,
      value: e.valueAfter,
      issued: { ...s.issued, [e.returnId]: { quantity: e.quantity, value: e.value } },
    }),
    ReturnStockRestored: (s, e) => ({
      ...s,
      quantity: e.onHandAfter,
      value: e.valueAfter,
      issued: Object.fromEntries(Object.entries(s.issued).filter(([id]) => id !== e.returnId)),
    }),
  },
}) {}

// ---------------------------------------------------------------- the journal

export const ReturnId = Schema.String.pipe(Schema.brand("StagedReturnId"))

export class ReturnJournalPosted extends Domain.Event("ReturnJournalPosted", {
  amountMinor: Schema.String,
}) {}

export class PostReturnJournal extends Domain.Command("PostReturnJournal", {
  target: ReturnId,
  input: { amountMinor: Schema.String },
  events: [ReturnJournalPosted],
}) {}

const Unposted = Schema.TaggedStruct("Unposted", {})
const Posted = Schema.TaggedStruct("Posted", {})

/** Debits goods received not invoiced and credits inventory, once per return. */
export class ReturnJournal extends Domain.Aggregate("ReturnJournal", {
  id: ReturnId,
  state: Schema.Union([Unposted, Posted]),
  initial: Unposted.make({}),
  commands: [PostReturnJournal],
  decide: {
    PostReturnJournal: (s, cmd) =>
      Predicate.isTagged(s, "Unposted")
        ? [new ReturnJournalPosted({ amountMinor: cmd.amountMinor })]
        : [],
  },
  evolve: {
    ReturnJournalPosted: () => Posted.make({}),
  },
}) {}

// ---------------------------------------------------------------- the order

export const PurchaseOrderId = Schema.String.pipe(Schema.brand("ReturnablePurchaseOrderId"))

export class PurchaseReturnExceedsReceipt extends Domain.Rejection("PurchaseReturnExceedsReceipt", {
  purchaseOrderLineId: Schema.String,
  available: Schema.String,
}) {}

const OrderLine = Schema.Struct({
  purchaseOrderLineId: Schema.String,
  itemId: Schema.String,
  /** The order price per unit, in minor units. */
  unitPrice: Schema.String,
  received: Schema.String,
})

const ReturnLine = Schema.Struct({
  purchaseOrderLineId: Schema.String,
  itemId: Schema.String,
  quantity: Schema.String,
  /** Quantity times the order price, in minor units. */
  value: Schema.String,
})

export class OrderReceived extends Domain.Event("ReturnableOrderReceived", {
  lines: Schema.Array(OrderLine),
}) {}

export class ReturnRecorded extends Domain.Event("ReturnRecorded", {
  returnId: Schema.String,
  warehouseId: Schema.String,
  lines: Schema.Array(ReturnLine),
}) {}

export class ReturnCancelled extends Domain.Event("ReturnCancelled", {
  returnId: Schema.String,
}) {}

export class NoteReceived extends Domain.Command("NoteOrderReceived", {
  target: PurchaseOrderId,
  input: { lines: Schema.Array(OrderLine) },
  events: [OrderReceived],
}) {}

export class RecordReturn extends Domain.Command("RecordSupplierReturn", {
  target: PurchaseOrderId,
  input: {
    returnId: Schema.String,
    warehouseId: Schema.String,
    lines: Schema.Array(
      Schema.Struct({ purchaseOrderLineId: Schema.String, quantity: Schema.String }),
    ),
  },
  events: [ReturnRecorded],
  rejects: [PurchaseReturnExceedsReceipt],
}) {}

export class CancelReturn extends Domain.Command("CancelSupplierReturn", {
  target: PurchaseOrderId,
  input: { returnId: Schema.String },
  events: [ReturnCancelled],
}) {}

const Order = Schema.Struct({
  lines: Schema.Record(Schema.String, OrderLine),
  /** Returned quantity by line, and what each open return took. */
  returned: Schema.Record(Schema.String, Schema.String),
  returns: Schema.Record(Schema.String, Schema.Array(ReturnLine)),
  cancelled: Schema.Array(Schema.String),
})

export class ReturnableOrder extends Domain.Aggregate("ReturnableOrder", {
  id: PurchaseOrderId,
  state: Order,
  initial: { lines: {}, returned: {}, returns: {}, cancelled: [] },
  commands: [NoteReceived, RecordReturn, CancelReturn],
  decide: {
    NoteOrderReceived: (s, cmd) =>
      Object.keys(s.lines).length === 0 ? [new OrderReceived({ lines: cmd.lines })] : [],
    RecordSupplierReturn: (s, cmd) => {
      // A repeated return id, recorded or cancelled, records nothing.
      if (s.returns[cmd.returnId] !== undefined || s.cancelled.includes(cmd.returnId)) return []

      const lines: Array<typeof ReturnLine.Type> = []

      for (const requested of cmd.lines) {
        const line = s.lines[requested.purchaseOrderLineId]

        const available =
          line === undefined
            ? 0n
            : BigInt(line.received) - BigInt(s.returned[requested.purchaseOrderLineId] ?? "0")

        if (BigInt(requested.quantity) > available) {
          return new PurchaseReturnExceedsReceipt({
            purchaseOrderLineId: requested.purchaseOrderLineId,
            available: String(available),
          })
        }

        lines.push({
          purchaseOrderLineId: requested.purchaseOrderLineId,
          itemId: line!.itemId,
          quantity: requested.quantity,
          value: String(BigInt(line!.unitPrice) * BigInt(requested.quantity)),
        })
      }

      return [new ReturnRecorded({ returnId: cmd.returnId, warehouseId: cmd.warehouseId, lines })]
    },
    CancelSupplierReturn: (s, cmd) =>
      s.returns[cmd.returnId] === undefined
        ? []
        : [new ReturnCancelled({ returnId: cmd.returnId })],
  },
  evolve: {
    ReturnableOrderReceived: (s, e) => ({
      ...s,
      lines: Object.fromEntries(e.lines.map((line) => [line.purchaseOrderLineId, line])),
    }),
    ReturnRecorded: (s, e) => {
      const returned = { ...s.returned }

      for (const line of e.lines) {
        returned[line.purchaseOrderLineId] = String(
          BigInt(returned[line.purchaseOrderLineId] ?? "0") + BigInt(line.quantity),
        )
      }

      return { ...s, returned, returns: { ...s.returns, [e.returnId]: e.lines } }
    },
    ReturnCancelled: (s, e) => {
      const returned = { ...s.returned }

      for (const line of s.returns[e.returnId] ?? []) {
        returned[line.purchaseOrderLineId] = String(
          BigInt(returned[line.purchaseOrderLineId] ?? "0") - BigInt(line.quantity),
        )
      }

      return {
        ...s,
        returned,
        returns: Object.fromEntries(Object.entries(s.returns).filter(([id]) => id !== e.returnId)),
        cancelled: [...s.cancelled, e.returnId],
      }
    },
  },
}) {}

// ---------------------------------------------------------------- the status of a return

export class ReturnApplied extends Domain.Event("ReturnApplied", {}) {}

/** The return was cancelled after it was recorded: a later step was refused. */
export class ReturnFailed extends Domain.Event("ReturnFailed", { reason: Schema.String }) {}

export class MarkReturnApplied extends Domain.Command("MarkReturnApplied", {
  target: ReturnId,
  input: {},
  events: [ReturnApplied],
}) {}

export class FailReturn extends Domain.Command("FailReturn", {
  target: ReturnId,
  input: { reason: Schema.String },
  events: [ReturnFailed],
}) {}

const Applying = Schema.TaggedStruct("Applying", {})
const Applied = Schema.TaggedStruct("Applied", {})
const Failed = Schema.TaggedStruct("Failed", { reason: Schema.String })

export class ReturnStatus extends Domain.Aggregate("ReturnStatus", {
  id: ReturnId,
  state: Schema.Union([Applying, Applied, Failed]),
  initial: Applying.make({}),
  commands: [MarkReturnApplied, FailReturn],
  decide: {
    MarkReturnApplied: (s) => (Predicate.isTagged(s, "Applying") ? [new ReturnApplied()] : []),
    FailReturn: (s, cmd) =>
      Predicate.isTagged(s, "Applying") ? [new ReturnFailed({ reason: cmd.reason })] : [],
  },
  evolve: {
    ReturnApplied: () => Applied.make({}),
    ReturnFailed: (_, e) => Failed.make({ reason: e.reason }),
  },
}) {}

// ---------------------------------------------------------------- the saga

const ApplyInput = {
  orderId: Schema.String,
  warehouseId: Schema.String,
  lines: Schema.Array(ReturnLine),
}

type Run = Schema.Struct<typeof ApplyInput>["Type"] & { readonly key: typeof ReturnId.Type }

export class ApplyReturn extends Domain.Saga("ApplyReturn", {
  key: ReturnId,
  input: ApplyInput,
  rejects: [StockValuationUnavailable],
}) {}

const Issued = Schema.Struct({ taken: Schema.Boolean, value: Schema.String })

export const ApplyReturnLive = ApplyReturn.toLayer(
  Effect.gen(function* () {
    const orders = yield* ReturnableOrder
    const positions = yield* ReturnStock
    const journals = yield* ReturnJournal
    const statuses = yield* ReturnStatus

    return Effect.fn(function* ({ key, orderId, warehouseId, lines }: Run) {
      // Runs after the restorations: the order frees the returned quantity and the status shows it.
      yield* Workflow.addFinalizer((exit) =>
        Exit.isFailure(exit)
          ? orders
              .send(PurchaseOrderId.make(orderId), new CancelReturn({ returnId: key }))
              .pipe(
                Effect.andThen(
                  statuses.send(key, new FailReturn({ reason: "the stock could not be issued" })),
                ),
                Effect.asVoid,
                Effect.orDie,
              )
          : Effect.void,
      )

      const ordered = lines.toSorted((left, right) => left.itemId.localeCompare(right.itemId))

      const issued = yield* Effect.forEach(ordered, ({ itemId, quantity, value }) => {
        const target = PositionId.make(`${warehouseId}/${itemId}`)

        return Activity.make({
          name: `issue:${itemId}`,
          success: Issued,
          error: StockValuationUnavailable,
          execute: positions
            .send(target, new IssueForReturn({ returnId: key, itemId, quantity, value }))
            .pipe(
              Effect.map((receipt) => {
                const outs = receipt.events.flatMap((event) =>
                  Predicate.isTagged(event, "ReturnStockOut") ? [event.value] : [],
                )

                return { taken: outs.length > 0, value: outs[0] ?? "0" }
              }),
            ),
        }).pipe(
          ApplyReturn.withCompensation((result) =>
            result.taken
              ? Activity.make({
                  name: `restore:${itemId}`,
                  execute: positions
                    .send(target, new RestoreIssue({ returnId: key }))
                    .pipe(Effect.asVoid, Effect.orDie),
                })
              : Effect.void,
          ),
        )
      })

      const total = issued.reduce((sum, line) => sum + BigInt(line.value), 0n)

      if (total > 0n) {
        yield* Activity.make({
          name: "journal",
          execute: journals
            .send(key, new PostReturnJournal({ amountMinor: String(total) }))
            .pipe(Effect.asVoid, Effect.orDie),
        })
      }

      yield* Activity.make({
        name: "applied",
        execute: statuses.send(key, new MarkReturnApplied({})).pipe(Effect.asVoid, Effect.orDie),
      })
    })
  }),
)

/** Starts the staging once the return is recorded. */
export class ReturnApplication extends Domain.Policy("ReturnApplication", {
  from: ReturnableOrder,
  on: [ReturnRecorded],
}) {}

export const ReturnApplicationLive = ReturnApplication.toLayer(
  Effect.gen(function* () {
    const runs = yield* ApplyReturn

    return Effect.fn(function* ({ source, event }) {
      yield* runs.start(ReturnId.make(event.returnId), {
        orderId: source.id,
        warehouseId: event.warehouseId,
        lines: event.lines,
      })
    })
  }),
)

export class ProcurementReturns extends Domain.Model("ProcurementReturns", {
  aggregates: [ReturnableOrder, ReturnStock, ReturnJournal, ReturnStatus],
  policies: [ReturnApplication],
  sagas: [ApplyReturn],
}) {}

export const ProcurementReturnsHandlers = Layer.mergeAll(ApplyReturnLive, ReturnApplicationLive)
