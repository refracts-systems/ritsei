import { DatabaseFailure } from "../../../../framework/foundation/mod.ts"
import { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import { defineActionCatalogEntry } from "../../../../framework/modules/module/mod.ts"
import { EventIdempotencyConflict } from "../../../../framework/modules/messaging/mod.ts"
import { ProcurementCapabilities } from "./capabilities.ts"
import { ConfirmPurchaseOrderInput, PurchaseOrder } from "./contract.ts"
import {
  PurchaseOrderConfirmationIdempotencyConflict,
  PurchaseOrderInvalidState,
  PurchaseOrderNotFound,
} from "./errors.ts"
import { ProcurementPurchaseOrderConfirmedEvent } from "./events.ts"

export const ProcurementConfirmPurchaseOrderAction = defineActionCatalogEntry({
  kind: "DomainAction",
  id: "procurement.purchase_order.confirm",
  version: 1,
  owningDomain: "procurement",
  title: "Confirm purchase order",
  description: "Commit a Procurement-owned purchase order confirmation.",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  inputSchema: ConfirmPurchaseOrderInput,
  outputSchema: PurchaseOrder,
  errorSchemas: [
    AuthorizationDenied,
    DatabaseFailure,
    EventIdempotencyConflict,
    PurchaseOrderConfirmationIdempotencyConflict,
    PurchaseOrderInvalidState,
    PurchaseOrderNotFound,
  ],
  requiredCapability: ProcurementCapabilities.purchaseOrderConfirm,
  scope: ["tenant"],
  idempotency: "required",
  transactionSemantics: "local_atomic",
  timeoutPolicy: { timeoutMs: 30_000 },
  retryPolicy: { maxAttempts: 3 },
  preconditions: ["authorized", "idempotency_key_stable", "purchase_order_draft"],
  effects: ["purchase_order_confirmed"],
  compensation: { kind: "none", recovery: "manual" },
})

export const ProcurementTypedActionCatalog = [ProcurementConfirmPurchaseOrderAction] as const
export const ProcurementTypedEventCatalog = [ProcurementPurchaseOrderConfirmedEvent] as const
