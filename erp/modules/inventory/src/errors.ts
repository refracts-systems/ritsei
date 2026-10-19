import * as Schema from "effect/Schema"

import { StockReservationStatus, StockTransferStatus, UnitOfMeasure } from "./contract.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const TrimmedNonEmptyString = Schema.String.check(
  Schema.makeFilter((value) => /\S/.test(value) && value === value.trim(), {
    expected: "a trimmed nonblank string",
  }),
)

export class InventoryReferenceNotFound extends Schema.TaggedError<InventoryReferenceNotFound>()(
  "InventoryReferenceNotFound",
  {
    tenantId: Uuid,
    warehouseId: Uuid,
    itemId: Uuid,
  },
) {}
export class WarehouseAlreadyExists extends Schema.TaggedError<WarehouseAlreadyExists>()(
  "WarehouseAlreadyExists",
  {
    tenantId: Uuid,
    name: Schema.String,
  },
) {}
export class WarehouseLegalEntityNotFound extends Schema.TaggedError<WarehouseLegalEntityNotFound>()(
  "WarehouseLegalEntityNotFound",
  {
    tenantId: Uuid,
    legalEntityId: Uuid,
  },
) {}
export class InventoryWarehouseLegalEntityMismatch extends Schema.TaggedError<InventoryWarehouseLegalEntityMismatch>()(
  "InventoryWarehouseLegalEntityMismatch",
  {
    tenantId: Uuid,
    warehouseId: Uuid,
    legalEntityId: Uuid,
  },
) {}
export class WarehouseBranchNotFound extends Schema.TaggedError<WarehouseBranchNotFound>()(
  "WarehouseBranchNotFound",
  {
    tenantId: Uuid,
    legalEntityId: Uuid,
    branchId: Uuid,
  },
) {}
export class ItemAlreadyExists extends Schema.TaggedError<ItemAlreadyExists>()(
  "ItemAlreadyExists",
  {
    tenantId: Uuid,
    sku: Schema.String,
  },
) {}
export class StockUnavailable extends Schema.TaggedError<StockUnavailable>()("StockUnavailable", {
  tenantId: Uuid,
  warehouseId: Uuid,
  itemId: Uuid,
  requested: Schema.String,
}) {}
export class InventoryUnitOfMeasureMismatch extends Schema.TaggedError<InventoryUnitOfMeasureMismatch>()(
  "InventoryUnitOfMeasureMismatch",
  {
    tenantId: Uuid,
    itemId: Uuid,
    expected: UnitOfMeasure,
    actual: UnitOfMeasure,
  },
) {}
export class StockCorrectionIdempotencyConflict extends Schema.TaggedError<StockCorrectionIdempotencyConflict>()(
  "StockCorrectionIdempotencyConflict",
  {
    tenantId: Uuid,
    idempotencyKey: TrimmedNonEmptyString,
  },
) {}
export class StockReservationIdempotencyConflict extends Schema.TaggedError<StockReservationIdempotencyConflict>()(
  "StockReservationIdempotencyConflict",
  {
    tenantId: Uuid,
    idempotencyKey: TrimmedNonEmptyString,
  },
) {}
export class StockReservationLegalEntityMismatch extends Schema.TaggedError<StockReservationLegalEntityMismatch>()(
  "StockReservationLegalEntityMismatch",
  {
    tenantId: Uuid,
    warehouseId: Uuid,
    legalEntityId: Uuid,
  },
) {}
export class StockReservationNotFound extends Schema.TaggedError<StockReservationNotFound>()(
  "StockReservationNotFound",
  {
    tenantId: Uuid,
    reservationId: Uuid,
  },
) {}
export class StockReservationInvalidState extends Schema.TaggedError<StockReservationInvalidState>()(
  "StockReservationInvalidState",
  {
    tenantId: Uuid,
    reservationId: Uuid,
    operation: Schema.Literals(["release", "fulfill"]),
    status: StockReservationStatus,
  },
) {}
export class StockTransferNotFound extends Schema.TaggedError<StockTransferNotFound>()(
  "StockTransferNotFound",
  {
    tenantId: Uuid,
    transferId: Uuid,
  },
) {}
export class StockTransferInvalidState extends Schema.TaggedError<StockTransferInvalidState>()(
  "StockTransferInvalidState",
  {
    tenantId: Uuid,
    transferId: Uuid,
    operation: Schema.Literals(["confirm", "complete"]),
    status: StockTransferStatus,
  },
) {}
export class StockTransferSameWarehouse extends Schema.TaggedError<StockTransferSameWarehouse>()(
  "StockTransferSameWarehouse",
  {
    tenantId: Uuid,
    warehouseId: Uuid,
  },
) {}
export class StockTransferDifferentLegalEntity extends Schema.TaggedError<StockTransferDifferentLegalEntity>()(
  "StockTransferDifferentLegalEntity",
  {
    tenantId: Uuid,
    sourceWarehouseId: Uuid,
    destinationWarehouseId: Uuid,
  },
) {}
export class StockTransferDuplicateItem extends Schema.TaggedError<StockTransferDuplicateItem>()(
  "StockTransferDuplicateItem",
  {
    tenantId: Uuid,
    itemId: Uuid,
  },
) {}
export class StockTransferWarehouseNotFound extends Schema.TaggedError<StockTransferWarehouseNotFound>()(
  "StockTransferWarehouseNotFound",
  { tenantId: Uuid, warehouseId: Uuid },
) {}
export class StockTransferItemNotFound extends Schema.TaggedError<StockTransferItemNotFound>()(
  "StockTransferItemNotFound",
  {
    tenantId: Uuid,
    itemId: Uuid,
  },
) {}
