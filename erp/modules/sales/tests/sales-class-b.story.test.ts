import { assert, describe, it } from "@effect/vitest"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  CancelledOrder,
  CancelOrder,
  ConfirmedOrder,
  ConfirmOrder,
  OrderCancelled,
  OrderConfirmed,
  OrderCreated,
  Sales,
  SalesOrder,
  SalesOrderConfirmationIdempotencyConflict,
  SalesOrderInvalidState,
} from "../src/domain-model.ts"

const { Story } = Domain

const story = Story.make(Sales)

const order = SalesOrder.ref("o-1")
const otherOrder = SalesOrder.ref("o-2")

const lines = [
  { itemId: "00000000-0000-4000-8000-000000000041", quantity: "2", unitPrice: "10.50" },
]

const body = { customerId: "c-1", quotationId: null, lines, total: "21.00" }
const created = new OrderCreated(body)
const confirmed = (key: string) => new OrderConfirmed({ idempotencyKey: key })
const confirm = (key: string) => new ConfirmOrder({ idempotencyKey: key })

describe("SAL-ORDER-2 on Alchemy: confirmation is idempotent and publishes one event", () => {
  // [SAL-ORDER-2]
  it.effect("the same key twice records one event and another key conflicts", () =>
    story(
      Story.given(order, created),
      Story.when(order, confirm("k-1")),
      Story.then(order, confirmed("k-1")),
      Story.when(order, confirm("k-1")),
      Story.then(order),
      Story.when(order, confirm("k-2")),
      Story.rejected(new SalesOrderConfirmationIdempotencyConflict()),
      Story.then(order),
    ),
  )

  // [SAL-ORDER-2]
  it.effect("a refused confirmation records nothing and leaves the state as it was", () =>
    story(
      Story.given(order, created, confirmed("k-1")),
      Story.when(order, confirm("k-2")),
      Story.rejected(new SalesOrderConfirmationIdempotencyConflict()),
      Story.then(order),
      Story.state(order, (state) =>
        assert.deepStrictEqual(
          state,
          ConfirmedOrder.make({ ...body, confirmationIdempotencyKey: "k-1" }),
        ),
      ),
    ),
  )

  // [SAL-ORDER-2]
  it.effect(
    "retry contract: the key answers only while the order is confirmed, then InvalidState",
    () =>
      story(
        Story.given(order, created, confirmed("k-1"), new OrderCancelled()),
        Story.when(order, confirm("k-1")),
        Story.rejected(new SalesOrderInvalidState({ status: "cancelled" })),
        Story.when(order, confirm("k-9")),
        Story.rejected(new SalesOrderInvalidState({ status: "cancelled" })),
        Story.then(order),
        Story.state(order, (state) =>
          assert.deepStrictEqual(
            state,
            CancelledOrder.make({ ...body, confirmationIdempotencyKey: "k-1" }),
          ),
        ),
      ),
  )

  // [SAL-ORDER-2]
  it.effect(
    "retry contract: Alchemy's receipt for a repeated command id would answer that retry with success",
    () =>
      story(
        Story.given(order, created),
        Story.when(order, confirm("k-1"), { commandId: "req-1" }),
        Story.then(order, confirmed("k-1")),
        Story.when(order, new CancelOrder({})),
        Story.then(order, new OrderCancelled()),
        // The same command id returns the first receipt without running `decide`: it is accepted
        // and records nothing, where the decider alone refuses with InvalidState (previous story).
        // So the service must not map a confirmation key to a command id; the key stays in the
        // aggregate state and `decideConfirmation` answers, as in production today.
        Story.when(order, confirm("k-1"), { commandId: "req-1" }),
        Story.then(order),
        Story.when(order, confirm("k-1")),
        Story.rejected(new SalesOrderInvalidState({ status: "cancelled" })),
      ),
  )

  // [SAL-ORDER-2]
  it.effect(
    "gap: a key another order already used is not visible to this instance, so it is accepted",
    () =>
      story(
        Story.given(order, created, confirmed("k-1")),
        Story.given(otherOrder, created),
        // Production refuses this with SalesOrderConfirmationIdempotencyConflict (tenant-wide
        // key). One aggregate instance cannot see another; closing the gap needs a claim kept
        // outside the order, which is atomic across two aggregates (phase 2, deliverable 4).
        Story.when(otherOrder, confirm("k-1")),
        Story.then(otherOrder, confirmed("k-1")),
      ),
  )
})
