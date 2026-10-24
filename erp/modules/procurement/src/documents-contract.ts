import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  CalendarDate,
  type DatabaseFailure,
  FinancialMajorAmount,
  Uuid,
  PositiveQuantity,
  NonNegativeQuantity,
} from "../../../../framework/foundation/mod.ts"
import type { ApprovalRequest } from "../../../../framework/modules/approvals/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import type { EventIdempotencyConflict } from "../../../../framework/modules/messaging/mod.ts"
import type { PostEntryFailure } from "../../accounting/mod.ts"
import type {
  InventoryReferenceNotFound,
  StockUnavailable,
  StockValuationUnavailable,
  ValuedStockMovement,
} from "../../inventory/mod.ts"
import type { PartyRelationshipNotFound } from "../../party/mod.ts"
import type { ProductNotFound } from "../../product/mod.ts"
import type * as ProcurementErrors from "./errors.ts"

const Quantity = PositiveQuantity
const ScopedInput = { principal: Principal, tenantId: Uuid }

const uniqueLines = <T extends { readonly purchaseOrderLineId: string }>(lines: ReadonlyArray<T>) =>
  new Set(lines.map((line) => line.purchaseOrderLineId)).size === lines.length

const DocumentLines = Schema.Array(Schema.Struct({ purchaseOrderLineId: Uuid, quantity: Quantity }))
  .check(Schema.isMinLength(1))
  .check(Schema.makeFilter(uniqueLines, { expected: "each order line appears once" }))

export const PurchaseApprovalSubject = "procurement.purchase_order"

export const SupplierPrice = Schema.Struct({
  supplierAccountId: Uuid,
  productId: Uuid,
  unitPrice: FinancialMajorAmount,
})

export const ListSupplierPricesInput = Schema.Struct({ ...ScopedInput, supplierAccountId: Uuid })

export const PricedPurchaseOrder = Schema.Struct({
  purchaseOrderId: Uuid,
  total: FinancialMajorAmount,
  /** The approval request when the total exceeds the purchase order approval threshold. */
  approval: Schema.NullOr(Schema.Unknown),
})

export type PricedPurchaseOrder = {
  readonly purchaseOrderId: string
  readonly total: string
  readonly approval: ApprovalRequest | null
}

export const MatchingLine = Schema.Struct({
  purchaseOrderLineId: Uuid,
  productId: Uuid,
  ordered: Quantity,
  received: NonNegativeQuantity,
  returned: NonNegativeQuantity,
  unitPrice: FinancialMajorAmount,
  taxCodeId: Schema.NullOr(Uuid),
})

export const PurchaseMatching = Schema.Struct({
  purchaseOrderId: Uuid,
  supplierAccountId: Uuid,
  partyId: Uuid,
  legalEntityId: Uuid,
  status: Schema.Literals(["draft", "confirmed", "cancelled"]),
  lines: Schema.Array(MatchingLine),
})

export type PurchaseMatching = Schema.Schema.Type<typeof PurchaseMatching>

export const PurchaseStockDocument = Schema.Struct({
  id: Uuid,
  purchaseOrderId: Uuid,
  number: Schema.String,
  stock: Schema.Unknown,
})

export type PurchaseStockDocument = {
  readonly id: string
  readonly purchaseOrderId: string
  readonly number: string
  readonly stock: ValuedStockMovement
}

export const SetSupplierPriceInput = Schema.Struct({
  ...ScopedInput,
  supplierAccountId: Uuid,
  productId: Uuid,
  unitPrice: FinancialMajorAmount,
})

export const DraftPurchaseOrderInput = Schema.Struct({
  ...ScopedInput,
  supplierAccountId: Uuid,
  lines: Schema.Array(
    Schema.Struct({
      productId: Uuid,
      quantity: Quantity,
      /** Overrides the supplier price. */
      unitPrice: Schema.optionalKey(FinancialMajorAmount),
      /** Overrides the product's default purchase tax code. */
      taxCodeId: Schema.optionalKey(Schema.NullOr(Uuid)),
    }),
  )
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(200)),
})

export const ReleasePurchaseOrderInput = Schema.Struct({
  ...ScopedInput,
  purchaseOrderId: Uuid,
  idempotencyKey: Schema.String.check(Schema.isPattern(/\S/)),
})

export const PurchaseOrderQueryInput = Schema.Struct({ ...ScopedInput, purchaseOrderId: Uuid })

export const ReceiveValuedInput = Schema.Struct({
  ...ScopedInput,
  /** Client-chosen id that makes a retried receipt return the recorded one. */
  receiptId: Schema.optionalKey(Uuid),
  purchaseOrderId: Uuid,
  warehouseId: Uuid,
  receiptDate: CalendarDate,
  lines: DocumentLines,
})

export const ReturnToSupplierInput = Schema.Struct({
  ...ScopedInput,
  returnId: Schema.optionalKey(Uuid),
  purchaseOrderId: Uuid,
  warehouseId: Uuid,
  returnDate: CalendarDate,
  lines: DocumentLines,
})

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

type StockFailure =
  | InventoryReferenceNotFound
  | StockUnavailable
  | StockValuationUnavailable
  | PostEntryFailure
  | ProductNotFound

/**
 * Procure-to-Pay documents owned by Procurement (ADR-0104): supplier prices, priced purchase orders
 * with threshold approval, valued receipts at the purchase price, returns, and matching data for
 * supplier bills.
 */
export interface PurchaseDocumentService {
  readonly setSupplierPrice: (
    input: Schema.Codec.Encoded<typeof SetSupplierPriceInput>,
  ) => Effect.Effect<
    Schema.Schema.Type<typeof SupplierPrice>,
    ProcurementErrors.SupplierAccountNotFound | ProductNotFound | CommonFailure
  >
  readonly listSupplierPrices: (
    input: Schema.Codec.Encoded<typeof ListSupplierPricesInput>,
  ) => Effect.Effect<ReadonlyArray<Schema.Schema.Type<typeof SupplierPrice>>, CommonFailure>
  readonly draftPurchaseOrder: (
    input: Schema.Codec.Encoded<typeof DraftPurchaseOrderInput>,
  ) => Effect.Effect<
    PricedPurchaseOrder,
    | ProcurementErrors.SupplierAccountNotFound
    | ProcurementErrors.SupplierPriceNotFound
    | ProcurementErrors.PurchaseLineNotStockable
    | ProductNotFound
    | PartyRelationshipNotFound
    | CommonFailure
  >
  /** Confirms a purchase order once any required approval is granted. */
  readonly releasePurchaseOrder: (
    input: Schema.Codec.Encoded<typeof ReleasePurchaseOrderInput>,
  ) => Effect.Effect<
    PurchaseMatching,
    | ProcurementErrors.PurchaseOrderApprovalRequired
    | ProcurementErrors.PurchaseOrderConfirmationIdempotencyConflict
    | ProcurementErrors.PurchaseOrderNotFound
    | ProcurementErrors.PurchaseOrderInvalidState
    | PartyRelationshipNotFound
    | EventIdempotencyConflict
    | CommonFailure
  >
  readonly getMatching: (
    input: Schema.Codec.Encoded<typeof PurchaseOrderQueryInput>,
  ) => Effect.Effect<
    PurchaseMatching,
    ProcurementErrors.PurchaseOrderNotFound | PartyRelationshipNotFound | CommonFailure
  >
  readonly receiveValued: (
    input: Schema.Codec.Encoded<typeof ReceiveValuedInput>,
  ) => Effect.Effect<
    PurchaseStockDocument,
    | ProcurementErrors.PurchaseOrderNotFound
    | ProcurementErrors.PurchaseOrderInvalidState
    | ProcurementErrors.PurchaseReceiptQuantityExceeded
    | PartyRelationshipNotFound
    | StockFailure
    | CommonFailure
  >
  readonly returnToSupplier: (
    input: Schema.Codec.Encoded<typeof ReturnToSupplierInput>,
  ) => Effect.Effect<
    PurchaseStockDocument,
    | ProcurementErrors.PurchaseOrderNotFound
    | ProcurementErrors.PurchaseReturnExceedsReceipt
    | PartyRelationshipNotFound
    | StockFailure
    | CommonFailure
  >
}

export const PurchaseDocumentService = Context.Service<PurchaseDocumentService>(
  "RITSEI/PurchaseDocumentService",
)
