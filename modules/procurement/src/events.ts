import * as Schema from "effect/Schema"

import { FinancialMajorAmount } from "../../../foundation/mod.ts"
import { defineEventCatalogEntry } from "../../catalog/mod.ts"

const Uuid = Schema.String.check(Schema.isUUID())

export const PurchaseOrderConfirmedEventPayload = Schema.Struct({
  purchaseOrderId: Uuid,
  supplierAccountId: Uuid,
  total: FinancialMajorAmount,
})

export const ProcurementPurchaseOrderConfirmedEvent = defineEventCatalogEntry({
  kind: "DomainEvent",
  id: "procurement.purchase_order.confirmed",
  version: 1,
  owningDomain: "procurement",
  title: "Purchase order confirmed",
  description: "A Procurement-owned purchase order entered its confirmed state.",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  payloadSchema: PurchaseOrderConfirmedEventPayload,
  scope: ["tenant"],
  aggregateType: "procurement.purchase_order",
  correlationFields: ["purchaseOrderId"],
  filterableFields: ["purchaseOrderId", "supplierAccountId"],
  occurredAtSemantics: "owner_commit_time",
  deliveryExpectation: "at_least_once",
  sensitivity: "business_internal_minimized",
})
