import { assert, describe, it } from "@effect/vitest"
import * as Data from "effect/Data"
import * as Layer from "effect/Layer"

import * as Domain from "../mod.ts"

import {
  Delivery,
  DeliveryCompleted,
  DeliveryExceedsOrder,
  DeliveryFailed,
  DeliveryRecorded,
  DeliveryRequested,
  DeliveryReversed,
  DeliverOrder,
  DeliverOrderIssueFirst,
  JournalForSource,
  type JournalRow,
  MemoryLedgerStore,
  OrderConfirmed,
  type OrderLineNotFound,
  type OrderNotConfirmed,
  OrderToCash,
  OrderToCashHandlers,
  OrderToCashIssueFirst,
  OrderToCashIssueFirstHandlers,
  RequestDelivery,
  SalesOrder,
  StockIssued,
  StockItem,
  StockReceived,
  StockReturned,
  StockUnavailable,
} from "./delivery-model.ts"

const { Story } = Domain

// The status a saga run is expected to reach.
type Outcome = Data.TaggedEnum<{
  Completed: { readonly result: undefined }
  Rejected: {
    readonly rejection:
      | OrderNotConfirmed
      | OrderLineNotFound
      | DeliveryExceedsOrder
      | StockUnavailable
  }
}>

const Outcome = Data.taggedEnum<Outcome>()

const recordFirst = Story.make(OrderToCash, {
  layer: OrderToCashHandlers.pipe(Layer.provide(MemoryLedgerStore)),
})

const issueFirst = Story.make(OrderToCashIssueFirst, {
  layer: OrderToCashIssueFirstHandlers.pipe(Layer.provide(MemoryLedgerStore)),
})

const order = SalesOrder.ref("o-1")
const itemA = StockItem.ref("w-1/A")
const itemB = StockItem.ref("w-1/B")
const d1 = Delivery.ref("d-1")
const d2 = Delivery.ref("d-2")

const confirmed = new OrderConfirmed({ lines: { L1: 5, L2: 2, L3: 4 } })
const tenOfA = new StockReceived({ quantity: 10, cost: 1000, onHandAfter: 10, valueAfter: 1000 })
const oneOfB = new StockReceived({ quantity: 1, cost: 70, onHandAfter: 1, valueAfter: 70 })

const lineA = (quantity: number) => ({ orderLineId: "L1", itemId: "A", quantity, stockable: true })
const service = { orderLineId: "L2", itemId: "S", quantity: 1, stockable: false }
const lineB = (quantity: number) => ({ orderLineId: "L3", itemId: "B", quantity, stockable: true })

const request = (lines: ReadonlyArray<ReturnType<typeof lineA> | typeof service>) =>
  new RequestDelivery({ orderId: "o-1", warehouseId: "w-1", lines })

const requested = (lines: ReadonlyArray<ReturnType<typeof lineA> | typeof service>) =>
  new DeliveryRequested({ orderId: "o-1", warehouseId: "w-1", lines })

const moved = (...pairs: ReadonlyArray<readonly [string, number]>) =>
  pairs.map(([orderLineId, quantity]) => ({ orderLineId, quantity }))

const issued = (quantity: number, cost: number, onHandAfter: number, valueAfter: number) =>
  new StockIssued({ sourceId: "d-1", quantity, cost, onHandAfter, valueAfter })

const cogs = (amount: number) =>
  ({ debit: "cost_of_goods_sold", credit: "inventory", amount }) as const

const reversal = (amount: number) =>
  ({ debit: "inventory", credit: "cost_of_goods_sold", amount }) as const

// Journal rows the Ledger projection wrote for the delivery, in order.
const journal =
  (...expected: ReadonlyArray<{ debit: string; credit: string; amount: number }>) =>
  (rows: ReadonlyArray<JournalRow>) =>
    assert.deepStrictEqual(
      rows.map(({ debit, credit, amount }) => ({ debit, credit, amount })),
      expected,
    )

describe("SAL-DLV-2 on Alchemy, variant A: record the delivery, then issue stock", () => {
  it("the model is well defined", () => assert.deepStrictEqual(Domain.verify(OrderToCash), []))

  it.effect("[SAL-DLV-2] a delivery issues its stockable lines; services move no stock", () =>
    recordFirst(
      Story.given(order, confirmed),
      Story.given(itemA, tenOfA),
      Story.when(d1, request([lineA(3), service])),
      Story.then(d1, requested([lineA(3), service]), new DeliveryCompleted()),
      Story.then(
        order,
        new DeliveryRecorded({ deliveryId: "d-1", lines: moved(["L1", 3], ["L2", 1]) }),
      ),
      Story.then(itemA, issued(3, 300, 7, 700)),
      Story.saga(DeliverOrder, d1, Outcome.Completed({ result: undefined })),
      Story.query(JournalForSource, { sourceId: "d-1" }, journal(cogs(300))),
    ),
  )

  it.effect("[SAL-DLV-1] a delivery beyond the order is refused before any stock moves", () =>
    recordFirst(
      Story.given(order, confirmed),
      Story.given(itemA, tenOfA),
      Story.when(d1, request([lineA(6)])),
      Story.then(d1, requested([lineA(6)]), new DeliveryFailed({ reason: "rejected" })),
      Story.then(order),
      Story.then(itemA),
      Story.saga(
        DeliverOrder,
        d1,
        Outcome.Rejected({
          rejection: new DeliveryExceedsOrder({ orderLineId: "L1", ordered: 5, requested: 6 }),
        }),
      ),
    ),
  )

  it.effect("[SAL-DLV-1] deliveries never exceed the order cumulatively", () =>
    recordFirst(
      Story.given(order, confirmed),
      Story.given(itemA, tenOfA),
      Story.when(d1, request([lineA(5)])),
      Story.then(d1, requested([lineA(5)]), new DeliveryCompleted()),
      Story.then(order, new DeliveryRecorded({ deliveryId: "d-1", lines: moved(["L1", 5]) })),
      Story.then(itemA, issued(5, 500, 5, 500)),
      Story.when(d2, request([lineA(1)])),
      Story.then(d2, requested([lineA(1)]), new DeliveryFailed({ reason: "rejected" })),
      Story.then(order),
      Story.then(itemA),
      Story.saga(
        DeliverOrder,
        d2,
        Outcome.Rejected({
          rejection: new DeliveryExceedsOrder({ orderLineId: "L1", ordered: 5, requested: 6 }),
        }),
      ),
    ),
  )

  // PostgreSQL rolls this back as if nothing happened. Here every step already committed.
  it.effect("[SAL-DLV-2] a failed issue reverses the delivery and returns the issued stock", () =>
    recordFirst(
      Story.given(order, confirmed),
      Story.given(itemA, tenOfA),
      Story.given(itemB, oneOfB),
      Story.when(d1, request([lineA(3), lineB(2)])),
      Story.then(d1, requested([lineA(3), lineB(2)]), new DeliveryFailed({ reason: "rejected" })),
      Story.then(
        order,
        new DeliveryRecorded({ deliveryId: "d-1", lines: moved(["L1", 3], ["L3", 2]) }),
        new DeliveryReversed({ deliveryId: "d-1", lines: moved(["L1", 3], ["L3", 2]) }),
      ),
      Story.then(
        itemA,
        issued(3, 300, 7, 700),
        new StockReturned({
          sourceId: "d-1",
          quantity: 3,
          cost: 300,
          onHandAfter: 10,
          valueAfter: 1000,
        }),
      ),
      Story.then(itemB),
      Story.saga(
        DeliverOrder,
        d1,
        Outcome.Rejected({ rejection: new StockUnavailable({ available: 1, requested: 2 }) }),
      ),
      Story.query(JournalForSource, { sourceId: "d-1" }, journal(cogs(300), reversal(300))),
    ),
  )

  it.effect("[SAL-DLV-2] a retried delivery request records nothing new", () =>
    recordFirst(
      Story.given(order, confirmed),
      Story.given(itemA, tenOfA),
      Story.when(d1, request([lineA(2)])),
      Story.then(d1, requested([lineA(2)]), new DeliveryCompleted()),
      Story.then(order, new DeliveryRecorded({ deliveryId: "d-1", lines: moved(["L1", 2]) })),
      Story.then(itemA, issued(2, 200, 8, 800)),
      Story.saga(DeliverOrder, d1, Outcome.Completed({ result: undefined })),
      Story.when(d1, request([lineA(2)])),
      Story.then(d1),
      Story.then(order),
      Story.then(itemA),
    ),
  )
})

describe("SAL-DLV-2 on Alchemy, variant B: issue stock, then record the delivery", () => {
  it("the model is well defined", () =>
    assert.deepStrictEqual(Domain.verify(OrderToCashIssueFirst), []))

  it.effect("[SAL-DLV-2] a failed issue never touches the order", () =>
    issueFirst(
      Story.given(order, confirmed),
      Story.given(itemA, tenOfA),
      Story.given(itemB, oneOfB),
      Story.when(d1, request([lineA(3), lineB(2)])),
      Story.then(d1, requested([lineA(3), lineB(2)]), new DeliveryFailed({ reason: "rejected" })),
      Story.then(order),
      Story.then(
        itemA,
        issued(3, 300, 7, 700),
        new StockReturned({
          sourceId: "d-1",
          quantity: 3,
          cost: 300,
          onHandAfter: 10,
          valueAfter: 1000,
        }),
      ),
      Story.then(itemB),
      Story.saga(
        DeliverOrderIssueFirst,
        d1,
        Outcome.Rejected({ rejection: new StockUnavailable({ available: 1, requested: 2 }) }),
      ),
      Story.query(JournalForSource, { sourceId: "d-1" }, journal(cogs(300), reversal(300))),
    ),
  )

  // The trade-off: the order check now comes last, so an over-delivery moves stock and returns it.
  it.effect("[SAL-DLV-1] an over-delivery issues stock and returns it before the refusal", () =>
    issueFirst(
      Story.given(order, confirmed),
      Story.given(itemA, tenOfA),
      Story.when(d1, request([lineA(6)])),
      Story.then(d1, requested([lineA(6)]), new DeliveryFailed({ reason: "rejected" })),
      Story.then(order),
      Story.then(
        itemA,
        issued(6, 600, 4, 400),
        new StockReturned({
          sourceId: "d-1",
          quantity: 6,
          cost: 600,
          onHandAfter: 10,
          valueAfter: 1000,
        }),
      ),
      Story.saga(
        DeliverOrderIssueFirst,
        d1,
        Outcome.Rejected({
          rejection: new DeliveryExceedsOrder({ orderLineId: "L1", ordered: 5, requested: 6 }),
        }),
      ),
      Story.query(JournalForSource, { sourceId: "d-1" }, journal(cogs(600), reversal(600))),
    ),
  )
})
