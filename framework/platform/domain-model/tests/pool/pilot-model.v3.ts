/** The third model: the second one with the warehouse view's version bumped, which asks the host to rebuild it. */
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
import { Probe } from "./probe.v2.ts"
import { ProbeNotes } from "./probe-notes.ts"
import { warehouseMovements } from "./warehouse-movements.ts"

export class WarehouseMovements extends warehouseMovements(1) {}

export class PilotModelV3 extends Domain.Model("PilotModel", {
  aggregates: [SalesOrder, StockItem, Delivery, Probe],
  policies: [DeliveryExecutionIssueFirst],
  projections: [Ledger],
  sagas: [DeliverOrderIssueFirst],
  queries: [JournalForSource],
  views: [DeliveryStatus, StockLevel, OrderProgress, WarehouseMovements, ProbeNotes],
}) {}

export class PilotApiV3 extends Domain.Api("PilotApi", { model: PilotModelV3 }) {}
