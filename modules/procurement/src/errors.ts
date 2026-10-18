import * as Schema from "effect/Schema"

const Uuid = Schema.String.check(Schema.isUUID())
const TrimmedNonEmptyString = Schema.String.check(Schema.makeFilter(
  (value) => /\S/.test(value) && value === value.trim(),
  { expected: "a trimmed nonblank string" },
))
const Quantity = Schema.String.check(
  Schema.makeFilter(
    (value) => /^[1-9]\d*$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n,
    { expected: "a positive PostgreSQL bigint quantity" },
  ),
)

export class SupplierAccountAlreadyExists
  extends Schema.TaggedError<SupplierAccountAlreadyExists>()(
    "SupplierAccountAlreadyExists",
    {
      tenantId: Uuid,
      supplierRelationshipId: Uuid,
    },
  )
{}

export class SupplierRelationshipNotEligible
  extends Schema.TaggedError<SupplierRelationshipNotEligible>()(
    "SupplierRelationshipNotEligible",
    {
      tenantId: Uuid,
      supplierRelationshipId: Uuid,
    },
  )
{}

export class SupplierAccountNotFound extends Schema.TaggedError<SupplierAccountNotFound>()(
  "SupplierAccountNotFound",
  {
    tenantId: Uuid,
    supplierAccountId: Uuid,
  },
) {}

export class PurchaseOrderNotFound extends Schema.TaggedError<PurchaseOrderNotFound>()(
  "PurchaseOrderNotFound",
  {
    tenantId: Uuid,
    purchaseOrderId: Uuid,
  },
) {}

export class PurchaseOrderConfirmationIdempotencyConflict
  extends Schema.TaggedError<PurchaseOrderConfirmationIdempotencyConflict>()(
    "PurchaseOrderConfirmationIdempotencyConflict",
    {
      tenantId: Uuid,
      purchaseOrderId: Uuid,
      idempotencyKey: TrimmedNonEmptyString,
    },
  )
{}

export class PurchaseOrderInvalidState
  extends Schema.TaggedError<PurchaseOrderInvalidState>()("PurchaseOrderInvalidState", {
    tenantId: Uuid,
    purchaseOrderId: Uuid,
    status: Schema.Literals(["draft", "confirmed", "cancelled"]),
  })
{}

export class PurchaseOrderHasReceipts
  extends Schema.TaggedError<PurchaseOrderHasReceipts>()("PurchaseOrderHasReceipts", {
    tenantId: Uuid,
    purchaseOrderId: Uuid,
  })
{}

export class PurchaseReceiptIdempotencyConflict
  extends Schema.TaggedError<PurchaseReceiptIdempotencyConflict>()(
    "PurchaseReceiptIdempotencyConflict",
    {
      tenantId: Uuid,
      purchaseOrderId: Uuid,
      idempotencyKey: TrimmedNonEmptyString,
    },
  )
{}

export class PurchaseReceiptLineDuplicate
  extends Schema.TaggedError<PurchaseReceiptLineDuplicate>()("PurchaseReceiptLineDuplicate", {
    tenantId: Uuid,
    purchaseOrderId: Uuid,
    purchaseOrderLineId: Uuid,
  })
{}

export class PurchaseReceiptLineNotFound
  extends Schema.TaggedError<PurchaseReceiptLineNotFound>()("PurchaseReceiptLineNotFound", {
    tenantId: Uuid,
    purchaseOrderId: Uuid,
    purchaseOrderLineId: Uuid,
  })
{}

export class PurchaseReceiptQuantityExceeded
  extends Schema.TaggedError<PurchaseReceiptQuantityExceeded>()(
    "PurchaseReceiptQuantityExceeded",
    {
      tenantId: Uuid,
      purchaseOrderId: Uuid,
      purchaseOrderLineId: Uuid,
      ordered: Quantity,
      received: Schema.String,
      requested: Quantity,
    },
  )
{}

export class PurchaseReceiptInventoryReferenceNotFound
  extends Schema.TaggedError<PurchaseReceiptInventoryReferenceNotFound>()(
    "PurchaseReceiptInventoryReferenceNotFound",
    {
      tenantId: Uuid,
      warehouseId: Uuid,
      itemId: Uuid,
    },
  )
{}

export class PurchaseReceiptWarehouseLegalEntityMismatch
  extends Schema.TaggedError<PurchaseReceiptWarehouseLegalEntityMismatch>()(
    "PurchaseReceiptWarehouseLegalEntityMismatch",
    {
      tenantId: Uuid,
      warehouseId: Uuid,
      legalEntityId: Uuid,
    },
  )
{}
