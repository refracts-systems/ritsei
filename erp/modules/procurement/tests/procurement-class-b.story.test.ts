import { describe, it } from "@effect/vitest"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  CancelPurchaseOrder,
  ConfirmPurchaseOrder,
  Procurement,
  PurchaseOrder,
  PurchaseOrderCancelled,
  PurchaseOrderConfirmationIdempotencyConflict,
  PurchaseOrderConfirmed,
  PurchaseOrderDrafted,
  PurchaseOrderInvalidState,
  purchaseOrderInstanceId,
} from "../src/domain-model.ts"

const { Story } = Domain

const story = Story.make(Procurement)

const tenant = "t-1"
const order = PurchaseOrder.ref(purchaseOrderInstanceId(tenant, "po-1"))
const otherOrder = PurchaseOrder.ref(purchaseOrderInstanceId(tenant, "po-2"))

const widgets = {
  itemId: "00000000-0000-4000-8000-0000000000a1",
  quantity: "100",
  unitPrice: "6.00",
}

const drafted = new PurchaseOrderDrafted({
  supplierAccountId: "sa-1",
  lines: [widgets],
  total: "600.00",
})

// The story clock starts here, and confirmation stamps the order with it.
const at = "2026-01-01T00:00:00.000Z"

const confirmedBy = (idempotencyKey: string) =>
  new PurchaseOrderConfirmed({ idempotencyKey, confirmedAt: at })

const confirm = (idempotencyKey: string) =>
  new ConfirmPurchaseOrder({ idempotencyKey, approvalRequired: false, approval: null })

const cancel = new CancelPurchaseOrder({ hasReceipts: false })

describe("PRC-PO-3 on Alchemy: confirmation is idempotent and publishes one event", () => {
  // [PRC-PO-3]
  it.effect("the same key twice records one event and another key conflicts", () =>
    story(
      Story.given(order, drafted),
      Story.when(order, confirm("k-1")),
      Story.then(order, confirmedBy("k-1")),
      Story.when(order, confirm("k-1")),
      Story.then(order),
      Story.when(order, confirm("k-2")),
      Story.rejected(new PurchaseOrderConfirmationIdempotencyConflict()),
      Story.then(order),
    ),
  )

  // [PRC-PO-3]
  it.effect(
    "retry contract: the key answers only while the order is confirmed, then InvalidState",
    () =>
      story(
        Story.given(order, drafted, confirmedBy("k-1"), new PurchaseOrderCancelled()),
        Story.when(order, confirm("k-1")),
        Story.rejected(new PurchaseOrderInvalidState({ status: "cancelled" })),
        Story.when(order, confirm("k-9")),
        Story.rejected(new PurchaseOrderInvalidState({ status: "cancelled" })),
        Story.then(order),
      ),
  )

  // [PRC-PO-3]
  it.effect(
    "retry contract: Alchemy's receipt for a repeated command id would answer that retry with success",
    () =>
      story(
        Story.given(order, drafted),
        Story.when(order, confirm("k-1"), { commandId: "req-1" }),
        Story.then(order, confirmedBy("k-1")),
        Story.when(order, cancel),
        Story.then(order, new PurchaseOrderCancelled()),
        // Accepted from the receipt without running `decide`; the decider alone refuses. The
        // service must not map a confirmation key to a command id (see SAL-ORDER-2).
        Story.when(order, confirm("k-1"), { commandId: "req-1" }),
        Story.then(order),
        Story.when(order, confirm("k-1")),
        Story.rejected(new PurchaseOrderInvalidState({ status: "cancelled" })),
      ),
  )

  // [PRC-PO-3]
  it.effect("gap: a key another order already used is not visible to this instance", () =>
    story(
      Story.given(order, drafted, confirmedBy("k-1")),
      Story.given(otherOrder, drafted),
      // PostgreSQL refuses this with the `purchase_orders_tenant_confirmation_idempotency_key`
      // constraint. One instance cannot see another (phase 2, deliverable 4).
      Story.when(otherOrder, confirm("k-1")),
      Story.then(otherOrder, confirmedBy("k-1")),
    ),
  )
})
