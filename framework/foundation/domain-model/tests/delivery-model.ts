/**
 * Pilot: RITSEI `SAL-DLV-2` ("a delivery issues stockable products in the same transaction") modelled
 * on @alchemy.run/domain. Alchemy commits atomically per aggregate instance only, so the delivery
 * (SalesOrder), each stock issue (StockItem) and the journal (Ledger projection) commit separately,
 * coordinated by a saga with compensations.
 */
import * as Domain from "../mod.ts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { Activity, Workflow } from "effect/workflow"

// ---------------------------------------------------------------- ids and values

export const OrderId = Schema.String.pipe(Schema.brand("OrderId"))
export const DeliveryId = Schema.String.pipe(Schema.brand("DeliveryId"))
/** One item in one warehouse: `<warehouseId>/<itemId>`. */

export const StockItemId = Schema.String.pipe(Schema.brand("StockItemId"))
const Qty = Schema.Int
const Cents = Schema.Int

const DeliveryLine = Schema.Struct({
  orderLineId: Schema.String,
  itemId: Schema.String,
  quantity: Qty,
  stockable: Schema.Boolean,
})

// ---------------------------------------------------------------- SalesOrder

export class OrderNotConfirmed extends Domain.Rejection("OrderNotConfirmed") {}

export class OrderLineNotFound extends Domain.Rejection("OrderLineNotFound", {
  orderLineId: Schema.String,
}) {}

export class DeliveryExceedsOrder extends Domain.Rejection("DeliveryExceedsOrder", {
  orderLineId: Schema.String,
  ordered: Qty,
  requested: Qty,
}) {}

const OrderLine = Schema.Struct({ ordered: Qty, delivered: Qty })

export class OrderConfirmed extends Domain.Event("OrderConfirmed", {
  lines: Schema.Record(Schema.String, Qty),
}) {}

export class ConfirmOrder extends Domain.Command("ConfirmOrder", {
  target: OrderId,
  input: { lines: Schema.Record(Schema.String, Qty) },
  events: [OrderConfirmed],
}) {}

const Moved = Schema.Array(Schema.Struct({ orderLineId: Schema.String, quantity: Qty }))

export class DeliveryRecorded extends Domain.Event("DeliveryRecorded", {
  deliveryId: Schema.String,
  lines: Moved,
}) {}

export class RecordDelivery extends Domain.Command("RecordDelivery", {
  target: OrderId,
  input: { deliveryId: Schema.String, lines: Moved },
  events: [DeliveryRecorded],
  rejects: [OrderNotConfirmed, OrderLineNotFound, DeliveryExceedsOrder],
}) {}

/** Compensation: never refuses. */
export class DeliveryReversed extends Domain.Event("DeliveryReversed", {
  deliveryId: Schema.String,
  lines: Moved,
}) {}

export class ReverseDelivery extends Domain.Command("ReverseDelivery", {
  target: OrderId,
  input: { deliveryId: Schema.String },
  events: [DeliveryReversed],
}) {}

const Unconfirmed = Schema.TaggedStruct("Unconfirmed", {})

const Confirmed = Schema.TaggedStruct("Confirmed", {
  lines: Schema.Record(Schema.String, OrderLine),
  /** Active deliveries, so a retried RecordDelivery or ReverseDelivery is a no-op. */
  deliveries: Schema.Record(Schema.String, Moved),
})

const OrderState = Schema.Union([Unconfirmed, Confirmed])

type OrderState = typeof OrderState.Type

const moveLines = (
  lines: Record<string, typeof OrderLine.Type>,
  moved: typeof Moved.Type,
  sign: 1 | -1,
) => {
  const next = { ...lines }

  for (const { orderLineId, quantity } of moved) {
    const line = next[orderLineId]!
    next[orderLineId] = { ...line, delivered: line.delivered + sign * quantity }
  }

  return next
}

export class SalesOrder extends Domain.Aggregate("SalesOrder", {
  id: OrderId,
  state: OrderState,
  initial: Unconfirmed.make({}),
  commands: [ConfirmOrder, RecordDelivery, ReverseDelivery],
  decide: {
    ConfirmOrder: (order, cmd) =>
      Predicate.isTagged(order, "Confirmed") ? [] : [new OrderConfirmed({ lines: cmd.lines })],
    RecordDelivery: (order, cmd) => {
      if (!Predicate.isTagged(order, "Confirmed")) return new OrderNotConfirmed()

      if (order.deliveries[cmd.deliveryId] !== undefined) return []

      for (const { orderLineId, quantity } of cmd.lines) {
        const line = order.lines[orderLineId]

        if (line === undefined) return new OrderLineNotFound({ orderLineId })

        if (line.delivered + quantity > line.ordered) {
          return new DeliveryExceedsOrder({
            orderLineId,
            ordered: line.ordered,
            requested: line.delivered + quantity,
          })
        }
      }

      return [new DeliveryRecorded({ deliveryId: cmd.deliveryId, lines: cmd.lines })]
    },
    ReverseDelivery: (order, cmd) => {
      const moved = Predicate.isTagged(order, "Confirmed")
        ? order.deliveries[cmd.deliveryId]
        : undefined

      return moved === undefined
        ? []
        : [new DeliveryReversed({ deliveryId: cmd.deliveryId, lines: moved })]
    },
  },
  evolve: {
    OrderConfirmed: (_, e): OrderState =>
      Confirmed.make({
        lines: Object.fromEntries(
          Object.entries(e.lines).map(([id, ordered]) => [id, { ordered, delivered: 0 }]),
        ),
        deliveries: {},
      }),
    DeliveryRecorded: (s, e): OrderState =>
      Predicate.isTagged(s, "Confirmed")
        ? {
            ...s,
            lines: moveLines(s.lines, e.lines, 1),
            deliveries: { ...s.deliveries, [e.deliveryId]: e.lines },
          }
        : s,
    DeliveryReversed: (s, e): OrderState => {
      if (!Predicate.isTagged(s, "Confirmed")) return s
      const { [e.deliveryId]: _, ...rest } = s.deliveries

      return { ...s, lines: moveLines(s.lines, e.lines, -1), deliveries: rest }
    },
  },
}) {}

// ---------------------------------------------------------------- StockItem (moving average)

export class StockUnavailable extends Domain.Rejection("StockUnavailable", {
  available: Qty,
  requested: Qty,
}) {}

const Valued = { quantity: Qty, cost: Cents, onHandAfter: Qty, valueAfter: Cents }

export class StockReceived extends Domain.Event("StockReceived", Valued) {}

export class ReceiveStock extends Domain.Command("ReceiveStock", {
  target: StockItemId,
  input: { quantity: Qty, cost: Cents },
  events: [StockReceived],
}) {}

export class StockIssued extends Domain.Event("StockIssued", {
  sourceId: Schema.String,
  ...Valued,
}) {}

export class IssueStock extends Domain.Command("IssueStock", {
  target: StockItemId,
  input: { sourceId: Schema.String, quantity: Qty },
  events: [StockIssued],
  rejects: [StockUnavailable],
}) {}

/** Compensation: puts an issue back at the cost it left with; never refuses. */
export class StockReturned extends Domain.Event("StockReturned", {
  sourceId: Schema.String,
  ...Valued,
}) {}

export class ReturnIssuedStock extends Domain.Command("ReturnIssuedStock", {
  target: StockItemId,
  input: { sourceId: Schema.String },
  events: [StockReturned],
}) {}

const Issue = Schema.Struct({ quantity: Qty, cost: Cents })

const StockState = Schema.Struct({
  onHand: Qty,
  value: Cents,
  /** Open issues by source, so retries and returns are idempotent. */
  issued: Schema.Record(Schema.String, Issue),
})

/** Moving average, rounded half up; the last units take the remaining value. */
const issueCost = (onHand: number, value: number, quantity: number) =>
  quantity === onHand ? value : Math.floor((2 * value * quantity + onHand) / (2 * onHand))

export class StockItem extends Domain.Aggregate("StockItem", {
  id: StockItemId,
  state: StockState,
  initial: { onHand: 0, value: 0, issued: {} },
  commands: [ReceiveStock, IssueStock, ReturnIssuedStock],
  decide: {
    ReceiveStock: (s, cmd) => [
      new StockReceived({
        quantity: cmd.quantity,
        cost: cmd.cost,
        onHandAfter: s.onHand + cmd.quantity,
        valueAfter: s.value + cmd.cost,
      }),
    ],
    IssueStock: (s, cmd) => {
      if (s.issued[cmd.sourceId] !== undefined) return []

      if (cmd.quantity > s.onHand) {
        return new StockUnavailable({ available: s.onHand, requested: cmd.quantity })
      }

      const cost = issueCost(s.onHand, s.value, cmd.quantity)

      return [
        new StockIssued({
          sourceId: cmd.sourceId,
          quantity: cmd.quantity,
          cost,
          onHandAfter: s.onHand - cmd.quantity,
          valueAfter: s.value - cost,
        }),
      ]
    },
    ReturnIssuedStock: (s, cmd) => {
      const issue = s.issued[cmd.sourceId]

      return issue === undefined
        ? []
        : [
            new StockReturned({
              sourceId: cmd.sourceId,
              quantity: issue.quantity,
              cost: issue.cost,
              onHandAfter: s.onHand + issue.quantity,
              valueAfter: s.value + issue.cost,
            }),
          ]
    },
  },
  evolve: {
    StockReceived: (s, e) => ({ ...s, onHand: e.onHandAfter, value: e.valueAfter }),
    StockIssued: (s, e) => ({
      onHand: e.onHandAfter,
      value: e.valueAfter,
      issued: { ...s.issued, [e.sourceId]: { quantity: e.quantity, cost: e.cost } },
    }),
    StockReturned: (s, e) => {
      const { [e.sourceId]: _, ...issued } = s.issued

      return { onHand: e.onHandAfter, value: e.valueAfter, issued }
    },
  },
}) {}

// ---------------------------------------------------------------- Delivery (the process record)

export class DeliveryRequested extends Domain.Event("DeliveryRequested", {
  orderId: Schema.String,
  warehouseId: Schema.String,
  lines: Schema.Array(DeliveryLine),
}) {}

export class RequestDelivery extends Domain.Command("RequestDelivery", {
  target: DeliveryId,
  input: { orderId: Schema.String, warehouseId: Schema.String, lines: Schema.Array(DeliveryLine) },
  events: [DeliveryRequested],
}) {}

export class DeliveryCompleted extends Domain.Event("DeliveryCompleted", {}) {}

export class CompleteDelivery extends Domain.Command("CompleteDelivery", {
  target: DeliveryId,
  input: {},
  events: [DeliveryCompleted],
}) {}

export class DeliveryFailed extends Domain.Event("DeliveryFailed", { reason: Schema.String }) {}

export class FailDelivery extends Domain.Command("FailDelivery", {
  target: DeliveryId,
  input: { reason: Schema.String },
  events: [DeliveryFailed],
}) {}

const NoDelivery = Schema.TaggedStruct("None", {})
const DeliveryInProgress = Schema.TaggedStruct("Requested", {})
const DeliveryDone = Schema.TaggedStruct("Completed", {})
const DeliveryRefused = Schema.TaggedStruct("Failed", { reason: Schema.String })
const DeliveryState = Schema.Union([NoDelivery, DeliveryInProgress, DeliveryDone, DeliveryRefused])

export class Delivery extends Domain.Aggregate("Delivery", {
  id: DeliveryId,
  state: DeliveryState,
  initial: NoDelivery.make({}),
  commands: [RequestDelivery, CompleteDelivery, FailDelivery],
  decide: {
    RequestDelivery: (s, cmd) =>
      !Predicate.isTagged(s, "None")
        ? []
        : [
            new DeliveryRequested({
              orderId: cmd.orderId,
              warehouseId: cmd.warehouseId,
              lines: cmd.lines,
            }),
          ],
    CompleteDelivery: (s) => (Predicate.isTagged(s, "Requested") ? [new DeliveryCompleted()] : []),
    FailDelivery: (s, cmd) =>
      Predicate.isTagged(s, "Requested") ? [new DeliveryFailed({ reason: cmd.reason })] : [],
  },
  evolve: {
    DeliveryRequested: () => DeliveryInProgress.make({}),
    DeliveryCompleted: () => DeliveryDone.make({}),
    DeliveryFailed: (_, e) => DeliveryRefused.make({ reason: e.reason }),
  },
}) {}

// ---------------------------------------------------------------- Sagas: two step orders

const SagaDefinition = {
  key: DeliveryId,
  input: { orderId: Schema.String, warehouseId: Schema.String, lines: Schema.Array(DeliveryLine) },
  rejects: [OrderNotConfirmed, OrderLineNotFound, DeliveryExceedsOrder, StockUnavailable],
} as const

/** Variant A: record the delivery on the order, then issue stock per line. */
export class DeliverOrder extends Domain.Saga("DeliverOrder", SagaDefinition) {}

/** Variant B: issue stock per line first, record the delivery on the order last. */
export class DeliverOrderIssueFirst extends Domain.Saga("DeliverOrderIssueFirst", SagaDefinition) {}

type Compensate = typeof DeliverOrder.withCompensation

type Run = {
  readonly key: typeof DeliveryId.Type
  readonly orderId: string
  readonly warehouseId: string
  readonly lines: ReadonlyArray<typeof DeliveryLine.Type>
}

const deliverySteps = (order: "record-first" | "issue-first", compensate: Compensate) =>
  Effect.gen(function* () {
    const orders = yield* SalesOrder
    const items = yield* StockItem
    const deliveries = yield* Delivery

    return Effect.fn(function* ({ key, orderId, warehouseId, lines }: Run) {
      const deliveryId = String(key)
      const target = OrderId.make(orderId)

      // Report a failed run on the Delivery record after compensations.
      yield* Workflow.addFinalizer((exit) =>
        Exit.isFailure(exit)
          ? deliveries
              .send(DeliveryId.make(deliveryId), new FailDelivery({ reason: "rejected" }))
              .pipe(Effect.asVoid, Effect.orDie)
          : Effect.void,
      )

      const record = Activity.make({
        name: "record",
        error: Schema.Union([OrderNotConfirmed, OrderLineNotFound, DeliveryExceedsOrder]),
        execute: orders
          .send(
            target,
            new RecordDelivery({
              deliveryId,
              lines: lines.map(({ orderLineId, quantity }) => ({ orderLineId, quantity })),
            }),
          )
          .pipe(Effect.asVoid),
      }).pipe(
        compensate(() =>
          Activity.make({
            name: "reverse",
            execute: orders
              .send(target, new ReverseDelivery({ deliveryId }))
              .pipe(Effect.asVoid, Effect.orDie),
          }),
        ),
      )

      const issues = Effect.forEach(
        lines.filter((line) => line.stockable),
        (line) => {
          const stockItem = StockItemId.make(`${warehouseId}/${line.itemId}`)

          return Activity.make({
            name: `issue:${line.orderLineId}`,
            error: StockUnavailable,
            execute: items
              .send(stockItem, new IssueStock({ sourceId: deliveryId, quantity: line.quantity }))
              .pipe(Effect.asVoid),
          }).pipe(
            compensate(() =>
              Activity.make({
                name: `return:${line.orderLineId}`,
                execute: items
                  .send(stockItem, new ReturnIssuedStock({ sourceId: deliveryId }))
                  .pipe(Effect.asVoid, Effect.orDie),
              }),
            ),
          )
        },
        { discard: true },
      )

      if (order === "record-first") {
        yield* record
        yield* issues
      } else {
        yield* issues
        yield* record
      }

      yield* Activity.make({
        name: "complete",
        execute: deliveries
          .send(DeliveryId.make(deliveryId), new CompleteDelivery({}))
          .pipe(Effect.asVoid, Effect.orDie),
      })
    })
  })

export const DeliverOrderLive = DeliverOrder.toLayer(
  deliverySteps("record-first", DeliverOrder.withCompensation),
)

export const DeliverOrderIssueFirstLive = DeliverOrderIssueFirst.toLayer(
  deliverySteps("issue-first", DeliverOrderIssueFirst.withCompensation),
)

/** Starts variant A once the request is recorded. */
export class DeliveryExecution extends Domain.Policy("DeliveryExecution", {
  from: Delivery,
  on: [DeliveryRequested],
}) {}

export const DeliveryExecutionLive = DeliveryExecution.toLayer(
  Effect.gen(function* () {
    const runs = yield* DeliverOrder

    return Effect.fn(function* ({ source, event }) {
      yield* runs.start(source, {
        orderId: event.orderId,
        warehouseId: event.warehouseId,
        lines: event.lines,
      })
    })
  }),
)

/** Starts variant B once the request is recorded. */
export class DeliveryExecutionIssueFirst extends Domain.Policy("DeliveryExecutionIssueFirst", {
  from: Delivery,
  on: [DeliveryRequested],
}) {}

export const DeliveryExecutionIssueFirstLive = DeliveryExecutionIssueFirst.toLayer(
  Effect.gen(function* () {
    const runs = yield* DeliverOrderIssueFirst

    return Effect.fn(function* ({ source, event }) {
      yield* runs.start(source, {
        orderId: event.orderId,
        warehouseId: event.warehouseId,
        lines: event.lines,
      })
    })
  }),
)

// ---------------------------------------------------------------- Ledger projection and query

export const JournalRow = Schema.Struct({
  id: Schema.String,
  sourceId: Schema.String,
  debit: Schema.Literals(["cost_of_goods_sold", "inventory"]),
  credit: Schema.Literals(["cost_of_goods_sold", "inventory"]),
  amount: Cents,
})

export type JournalRow = typeof JournalRow.Type

export class LedgerStore extends Context.Service<
  LedgerStore,
  {
    readonly record: (rows: ReadonlyArray<JournalRow>) => Effect.Effect<void>
    readonly forSource: (sourceId: string) => Effect.Effect<ReadonlyArray<JournalRow>>
  }
>()("Pilot/LedgerStore") {}

export const MemoryLedgerStore = Layer.sync(LedgerStore, () => {
  const rows = new Map<string, JournalRow>()

  return {
    record: (batch) => Effect.sync(() => batch.forEach((row) => rows.set(row.id, row))),
    forSource: (sourceId) =>
      Effect.sync(() => [...rows.values()].filter((row) => row.sourceId === sourceId)),
  }
})

export class Ledger extends Domain.Projection("Ledger", {
  from: [StockItem],
  key: StockItem,
  on: [StockIssued, StockReturned],
}) {}

export const LedgerLive = Ledger.toLayer(
  Effect.gen(function* () {
    const store = yield* LedgerStore

    return Effect.fn(function* (batch) {
      yield* store.record(
        batch.map(({ event, envelope }) => ({
          id: `${envelope.stream}:${envelope.seq}`,
          sourceId: event.sourceId,
          debit: Predicate.isTagged(event, "StockIssued") ? "cost_of_goods_sold" : "inventory",
          credit: Predicate.isTagged(event, "StockIssued") ? "inventory" : "cost_of_goods_sold",
          amount: event.cost,
        })),
      )
    })
  }),
)

export class JournalForSource extends Domain.Query("JournalForSource", {
  input: { sourceId: Schema.String },
  success: Schema.Array(JournalRow),
  waitsFor: [Ledger],
}) {}

export const JournalForSourceLive = JournalForSource.toLayer(
  Effect.gen(function* () {
    const store = yield* LedgerStore

    return Effect.fn(function* ({ sourceId }) {
      return yield* store.forSource(sourceId)
    })
  }),
)

// ---------------------------------------------------------------- Models (one per variant)

export class OrderToCash extends Domain.Model("OrderToCash", {
  aggregates: [SalesOrder, StockItem, Delivery],
  policies: [DeliveryExecution],
  projections: [Ledger],
  sagas: [DeliverOrder],
  queries: [JournalForSource],
}) {}

export const OrderToCashHandlers = Layer.mergeAll(
  DeliverOrderLive,
  DeliveryExecutionLive,
  LedgerLive,
  JournalForSourceLive,
)

export class OrderToCashIssueFirst extends Domain.Model("OrderToCashIssueFirst", {
  aggregates: [SalesOrder, StockItem, Delivery],
  policies: [DeliveryExecutionIssueFirst],
  projections: [Ledger],
  sagas: [DeliverOrderIssueFirst],
  queries: [JournalForSource],
}) {}

export const OrderToCashIssueFirstHandlers = Layer.mergeAll(
  DeliverOrderIssueFirstLive,
  DeliveryExecutionIssueFirstLive,
  LedgerLive,
  JournalForSourceLive,
)
