/**
 * The delivery pilot as the Effect Cluster pool serves it (ADR-0124, phase 0): variant B of the
 * `SAL-DLV-2` model from `framework/foundation/domain-model/tests/delivery-model.ts`, plus the views
 * a client reads outcomes from, and the Api the deployed service exposes. Nothing in the pilot's
 * rules changes here.
 */
import * as Domain from "@alchemy.run/domain"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { Probe } from "./probe.v1.ts"
import {
  Delivery,
  DeliveryExecutionIssueFirst,
  DeliverOrderIssueFirst,
  JournalForSource,
  Ledger,
  MemoryLedgerStore,
  OrderToCashIssueFirstHandlers,
  SalesOrder,
  StockItem,
} from "../../../../foundation/domain-model/tests/delivery-model.ts"

/** How far a delivery got, for a client to read. */
export class DeliveryStatus extends Domain.View("DeliveryStatus", {
  from: [Delivery],
  key: Delivery,
  state: Schema.Struct({ status: Schema.String, reason: Schema.optional(Schema.String) }),
  initial: { status: "none" },
  evolve: {
    DeliveryRequested: () => ({ status: "requested" }),
    DeliveryCompleted: () => ({ status: "completed" }),
    DeliveryFailed: (_, event) => ({ status: "failed", reason: event.reason }),
  },
}) {}

/** What is on hand of one item in one warehouse. */
export class StockLevel extends Domain.View("StockLevel", {
  from: [StockItem],
  key: StockItem,
  state: Schema.Struct({ onHand: Schema.Int, value: Schema.Int }),
  initial: { onHand: 0, value: 0 },
  evolve: {
    StockReceived: (_, event) => ({ onHand: event.onHandAfter, value: event.valueAfter }),
    StockIssued: (_, event) => ({ onHand: event.onHandAfter, value: event.valueAfter }),
    StockReturned: (_, event) => ({ onHand: event.onHandAfter, value: event.valueAfter }),
  },
}) {}

const moveLines = (
  delivered: Readonly<Record<string, number>>,
  lines: ReadonlyArray<{ readonly orderLineId: string; readonly quantity: number }>,
  sign: 1 | -1,
) => {
  const next = { ...delivered }

  for (const { orderLineId, quantity } of lines) {
    next[orderLineId] = (next[orderLineId] ?? 0) + sign * quantity
  }

  return next
}

/** What has been delivered on each line of an order. */
export class OrderProgress extends Domain.View("OrderProgress", {
  from: [SalesOrder],
  key: SalesOrder,
  state: Schema.Struct({ delivered: Schema.Record(Schema.String, Schema.Int) }),
  initial: { delivered: {} },
  evolve: {
    DeliveryRecorded: (view, event) => ({ delivered: moveLines(view.delivered, event.lines, 1) }),
    DeliveryReversed: (view, event) => ({ delivered: moveLines(view.delivered, event.lines, -1) }),
  },
}) {}

const aggregates = [SalesOrder, StockItem, Delivery, Probe] as const

export class PilotModel extends Domain.Model("PilotModel", {
  aggregates,
  policies: [DeliveryExecutionIssueFirst],
  projections: [Ledger],
  sagas: [DeliverOrderIssueFirst],
  queries: [JournalForSource],
  views: [DeliveryStatus, StockLevel, OrderProgress],
}) {}

export class PilotApi extends Domain.Api("PilotApi", { model: PilotModel }) {}

export const PilotHandlers = OrderToCashIssueFirstHandlers.pipe(Layer.provide(MemoryLedgerStore))
