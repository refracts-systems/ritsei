/**
 * The second model of the pool test: the first model's views, the probe event with its optional
 * field, and two views added after the first deploy. Both read events recorded before they existed, which
 * the host has to rebuild from the stored history.
 */
import * as Domain from "@alchemy.run/domain"

import {
  Delivery,
  DeliveryExecutionIssueFirst,
  DeliverOrderIssueFirst,
  JournalForSource,
  Ledger,
  SalesOrder,
  StockItem,
} from "../../../../foundation/domain-model/tests/delivery-model.ts"
import { DeliveryStatus, OrderProgress, StockLevel } from "./pilot-model.ts"
import { warehouseMovements } from "./warehouse-movements.ts"
import { ProbeNotes } from "./probe-notes.ts"
import { Probe } from "./probe.v2.ts"

export class WarehouseMovements extends warehouseMovements(0) {}

export class PilotModelV2 extends Domain.Model("PilotModel", {
  aggregates: [SalesOrder, StockItem, Delivery, Probe],
  policies: [DeliveryExecutionIssueFirst],
  projections: [Ledger],
  sagas: [DeliverOrderIssueFirst],
  queries: [JournalForSource],
  views: [DeliveryStatus, StockLevel, OrderProgress, WarehouseMovements, ProbeNotes],
}) {}

export class PilotApiV2 extends Domain.Api("PilotApi", { model: PilotModelV2 }) {}
