export { InventoryCapabilities } from "./src/capabilities.ts"
export {
  InventoryAdjustStockAction,
  InventoryStockCorrectedEvent,
  InventoryTypedActionCatalog,
  InventoryTypedEventCatalog,
  StockCorrectedEventPayload,
} from "./src/catalog.ts"

export {
  AdjustStockInput,
  CompleteStockTransferInput,
  ConfirmStockTransferInput,
  CreateItemInput,
  CreateStockTransferInput,
  CreateWarehouseInput,
  FulfillReservationInput,
  InventoryService,
  Item,
  ListItemsInput,
  ListStockBalancesInput,
  ListStockMovementsInput,
  ListStockReservationsInput,
  ListStockTransfersInput,
  ListWarehousesInput,
  ReceiveStockInput,
  ReleaseReservationInput,
  ReserveStockInput,
  StockBalance,
  StockCorrection,
  StockMovement,
  StockMovementKind,
  StockReservation,
  StockReservationStatus,
  StockTransfer,
  StockTransferLine,
  StockTransferStatus,
  UnitOfMeasure,
  Warehouse,
} from "./src/contract.ts"
export type {
  InventoryService as InventoryServiceContract,
  Item as ItemType,
  StockBalance as StockBalanceType,
  StockCorrection as StockCorrectionType,
  StockMovement as StockMovementType,
  StockReservation as StockReservationType,
  StockTransfer as StockTransferType,
  StockTransferLine as StockTransferLineType,
  Warehouse as WarehouseType,
} from "./src/contract.ts"
export {
  InventoryReferenceNotFound,
  InventoryUnitOfMeasureMismatch,
  InventoryWarehouseLegalEntityMismatch,
  ItemAlreadyExists,
  StockCorrectionIdempotencyConflict,
  StockReservationIdempotencyConflict,
  StockReservationInvalidState,
  StockReservationLegalEntityMismatch,
  StockReservationNotFound,
  StockTransferDifferentLegalEntity,
  StockTransferDuplicateItem,
  StockTransferInvalidState,
  StockTransferItemNotFound,
  StockTransferNotFound,
  StockTransferSameWarehouse,
  StockTransferWarehouseNotFound,
  StockUnavailable,
  WarehouseAlreadyExists,
  WarehouseBranchNotFound,
  WarehouseLegalEntityNotFound,
} from "./src/errors.ts"
export { InventoryLive, makeInventoryService, makeInventoryTestLayer } from "./src/layers.ts"
export { InventoryModule } from "./manifest.ts"
export {
  CountStockInput,
  IssueValuedStockInput,
  ReceiveValuedStockInput,
  RegisterProductItemInput,
  StockKeepingService,
  StockSource,
  StockValuation,
  ValuationReportInput,
  ValuedStockMovement,
} from "./src/stock-keeping-contract.ts"
export type {
  StockKeepingService as StockKeepingServiceContract,
  StockValuation as StockValuationType,
  ValuedStockMovement as ValuedStockMovementType,
} from "./src/stock-keeping-contract.ts"
export { StockNotStockable, StockValuationUnavailable } from "./src/errors.ts"
export { StockKeepingLive } from "./src/stock-keeping.ts"
