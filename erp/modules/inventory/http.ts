// HTTP adapter for this module (ADR-0094). Only the composition root imports this file.
import * as Effect from "effect/Effect"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import * as Schema from "effect/Schema"

import {
  ApiErrors as errors,
  BaseApiErrorPolicy,
  BearerAuth,
  BoundedArray,
  CurrentPrincipal,
  NonEmptyString,
  ShortString,
  TenantHeaders as tenantHeaders,
  Uuid,
  apiErrorMapping,
  moduleApi,
} from "../../../framework/modules/http/mod.ts"
import { CalendarDate, FinancialMajorAmount } from "../../../framework/foundation/mod.ts"
import {
  InventoryService,
  Item,
  StockKeepingService,
  StockValuation,
  ValuedStockMovement,
  StockBalance,
  StockCorrection,
  StockMovement,
  StockMovementKind,
  StockReservation,
  StockReservationStatus,
  StockTransfer,
  StockTransferLine,
  StockTransferStatus,
  Warehouse,
} from "./mod.ts"

const CreatedWarehouse = Warehouse.pipe(HttpApiSchema.status(201))
const CreatedItem = Item.pipe(HttpApiSchema.status(201))
const CreatedReservation = StockReservation.pipe(HttpApiSchema.status(201))
const CreatedTransfer = StockTransfer.pipe(HttpApiSchema.status(201))

export const InventoryHttpGroup = HttpApiGroup.make("Inventory").add(
  HttpApiEndpoint.get("listWarehouses", "/inventory/warehouses", {
    headers: tenantHeaders,
    query: {
      legalEntityId: Schema.optionalKey(Uuid),
      limit: Schema.optionalKey(
        Schema.NumberFromString.pipe(
          Schema.check(Schema.isInt()),
          Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
        ),
      ),
    },
    success: Schema.Array(Warehouse),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listItems", "/inventory/items", {
    headers: tenantHeaders,
    query: {
      search: Schema.optionalKey(ShortString),
      limit: Schema.optionalKey(
        Schema.NumberFromString.pipe(
          Schema.check(Schema.isInt()),
          Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
        ),
      ),
    },
    success: Schema.Array(Item),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listStockBalances", "/inventory/stock-balances", {
    headers: tenantHeaders,
    query: {
      warehouseId: Schema.optionalKey(Uuid),
      itemId: Schema.optionalKey(Uuid),
      limit: Schema.optionalKey(
        Schema.NumberFromString.pipe(
          Schema.check(Schema.isInt()),
          Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
        ),
      ),
    },
    success: Schema.Array(StockBalance),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listStockReservations", "/inventory/reservations", {
    headers: tenantHeaders,
    query: {
      warehouseId: Schema.optionalKey(Uuid),
      itemId: Schema.optionalKey(Uuid),
      status: Schema.optionalKey(StockReservationStatus),
      limit: Schema.optionalKey(
        Schema.NumberFromString.pipe(
          Schema.check(Schema.isInt()),
          Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
        ),
      ),
    },
    success: Schema.Array(StockReservation),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listStockTransfers", "/inventory/transfers", {
    headers: tenantHeaders,
    query: {
      warehouseId: Schema.optionalKey(Uuid),
      status: Schema.optionalKey(StockTransferStatus),
      limit: Schema.optionalKey(
        Schema.NumberFromString.pipe(
          Schema.check(Schema.isInt()),
          Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
        ),
      ),
    },
    success: Schema.Array(StockTransfer),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listStockMovements", "/inventory/movements", {
    headers: tenantHeaders,
    query: {
      warehouseId: Schema.optionalKey(Uuid),
      itemId: Schema.optionalKey(Uuid),
      kind: Schema.optionalKey(StockMovementKind),
      limit: Schema.optionalKey(
        Schema.NumberFromString.pipe(
          Schema.check(Schema.isInt()),
          Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
        ),
      ),
    },
    success: Schema.Array(StockMovement),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createWarehouse", "/inventory/warehouses", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      legalEntityId: Uuid,
      primaryBranchId: Schema.optionalKey(Uuid),
      name: ShortString,
    }),
    success: CreatedWarehouse,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createItem", "/inventory/items", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      sku: ShortString,
      name: ShortString,
      unitOfMeasure: Schema.optionalKey(ShortString),
    }),
    success: CreatedItem,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("adjustStock", "/inventory/adjustments", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      warehouseId: Uuid,
      itemId: Uuid,
      adjustment: NonEmptyString,
      unitOfMeasure: ShortString,
      reason: ShortString,
      commandId: ShortString,
      correlationId: ShortString,
      causationId: Schema.optionalKey(Schema.NullOr(ShortString)),
      idempotencyKey: ShortString,
    }),
    success: StockCorrection,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("receiveStock", "/inventory/receipts", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      warehouseId: Uuid,
      itemId: Uuid,
      quantity: NonEmptyString,
      legalEntityId: Schema.optionalKey(Uuid),
      referenceId: Schema.optionalKey(Uuid),
    }),
    success: StockBalance,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("reserveStock", "/inventory/reservations", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      warehouseId: Uuid,
      itemId: Uuid,
      quantity: NonEmptyString,
      legalEntityId: Schema.optionalKey(Uuid),
      idempotencyKey: Schema.optionalKey(ShortString),
    }),
    success: CreatedReservation,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("releaseReservation", "/inventory/reservations/:id/release", {
    params: { id: Uuid },
    headers: tenantHeaders,
    success: StockReservation,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("fulfillReservation", "/inventory/reservations/:id/fulfill", {
    params: { id: Uuid },
    headers: tenantHeaders,
    success: StockReservation,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createTransfer", "/inventory/transfers", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      sourceWarehouseId: Uuid,
      destinationWarehouseId: Uuid,
      lines: BoundedArray(StockTransferLine).check(Schema.isMinLength(1)),
    }),
    success: CreatedTransfer,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("confirmTransfer", "/inventory/transfers/:id/confirm", {
    params: { id: Uuid },
    headers: tenantHeaders,
    success: StockTransfer,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("completeTransfer", "/inventory/transfers/:id/complete", {
    params: { id: Uuid },
    headers: tenantHeaders,
    success: StockTransfer,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("registerProductItem", "/inventory/product-items", {
    headers: tenantHeaders,
    payload: Schema.Struct({ productId: Uuid }),
    success: Item,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("countStock", "/inventory/warehouses/:id/counts", {
    params: { id: Uuid },
    headers: tenantHeaders,
    payload: Schema.Struct({
      countId: Uuid,
      postingDate: CalendarDate,
      lines: BoundedArray(
        Schema.Struct({
          itemId: Uuid,
          countedQuantity: Schema.String.check(Schema.isPattern(/^(0|[1-9]\d{0,17})$/)),
          unitCost: Schema.optionalKey(FinancialMajorAmount),
        }),
      ),
    }),
    success: ValuedStockMovement,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("stockValuation", "/inventory/legal-entities/:id/valuation", {
    params: { id: Uuid },
    headers: tenantHeaders,
    success: StockValuation,
    error: errors,
  }).middleware(BearerAuth),
)

const InventoryHttpApi = moduleApi(InventoryHttpGroup)

export const InventoryHttpErrors = apiErrorMapping({
  ...BaseApiErrorPolicy,
  InventoryReferenceNotFound: "not_found",
  InventoryUnitOfMeasureMismatch: "conflict",
  InventoryWarehouseLegalEntityMismatch: "conflict",
  ItemAlreadyExists: "conflict",
  ProductNotFound: "not_found",
  StockNotStockable: "conflict",
  StockValuationUnavailable: "conflict",
  AccountingLegalEntityNotFound: "conflict",
  AccountingPeriodNotOpen: "conflict",
  AccountNotFound: "conflict",
  FinancialEngineActivated: "conflict",
  InvalidJournalLine: "conflict",
  JournalIdempotencyConflict: "conflict",
  PostingRuleNotFound: "conflict",
  UnbalancedJournal: "conflict",
  StockCorrectionIdempotencyConflict: "conflict",
  StockReservationIdempotencyConflict: "conflict",
  StockReservationInvalidState: "conflict",
  StockReservationLegalEntityMismatch: "conflict",
  StockReservationNotFound: "not_found",
  StockTransferDifferentLegalEntity: "conflict",
  StockTransferDuplicateItem: "conflict",
  StockTransferInvalidState: "conflict",
  StockTransferItemNotFound: "not_found",
  StockTransferNotFound: "not_found",
  StockTransferSameWarehouse: "conflict",
  StockTransferWarehouseNotFound: "not_found",
  StockUnavailable: "conflict",
  WarehouseAlreadyExists: "conflict",
  WarehouseBranchNotFound: "not_found",
  WarehouseLegalEntityNotFound: "not_found",
})

const coreApiEffect = InventoryHttpErrors.apiEffect

export const InventoryHttpHandlers = HttpApiBuilder.group(
  InventoryHttpApi,
  "Inventory",
  (handlers) =>
    Effect.gen(function* () {
      const inventory = yield* InventoryService
      const stockKeeping = yield* StockKeepingService

      return handlers
        .handle(
          "registerProductItem",
          Effect.fn("Http.Inventory.registerProductItem")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              stockKeeping.registerProductItem({
                principal,
                tenantId: headers["x-tenant-id"],
                productId: payload.productId,
              }),
            )
          }),
        )
        .handle(
          "countStock",
          Effect.fn("Http.Inventory.countStock")(function* ({ headers, params, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              stockKeeping.countStock({
                principal,
                tenantId: headers["x-tenant-id"],
                warehouseId: params.id,
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "stockValuation",
          Effect.fn("Http.Inventory.stockValuation")(function* ({ headers, params }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              stockKeeping.valuation({
                principal,
                tenantId: headers["x-tenant-id"],
                legalEntityId: params.id,
              }),
            )
          }),
        )
        .handle(
          "listWarehouses",
          Effect.fn("Http.Inventory.listWarehouses")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              inventory.listWarehouses({ principal, tenantId: headers["x-tenant-id"], ...query }),
            )
          }),
        )
        .handle(
          "listItems",
          Effect.fn("Http.Inventory.listItems")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              inventory.listItems({ principal, tenantId: headers["x-tenant-id"], ...query }),
            )
          }),
        )
        .handle(
          "listStockBalances",
          Effect.fn("Http.Inventory.listStockBalances")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              inventory.listStockBalances({
                principal,
                tenantId: headers["x-tenant-id"],
                ...query,
              }),
            )
          }),
        )
        .handle(
          "listStockReservations",
          Effect.fn("Http.Inventory.listStockReservations")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              inventory.listStockReservations({
                principal,
                tenantId: headers["x-tenant-id"],
                ...query,
              }),
            )
          }),
        )
        .handle(
          "listStockTransfers",
          Effect.fn("Http.Inventory.listStockTransfers")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              inventory.listStockTransfers({
                principal,
                tenantId: headers["x-tenant-id"],
                ...query,
              }),
            )
          }),
        )
        .handle(
          "listStockMovements",
          Effect.fn("Http.Inventory.listStockMovements")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              inventory.listStockMovements({
                principal,
                tenantId: headers["x-tenant-id"],
                ...query,
              }),
            )
          }),
        )
        .handle(
          "createWarehouse",
          Effect.fn("Http.Inventory.createWarehouse")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              inventory.createWarehouse({
                principal,
                tenantId: headers["x-tenant-id"],
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "createItem",
          Effect.fn("Http.Inventory.createItem")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              inventory.createItem({ principal, tenantId: headers["x-tenant-id"], ...payload }),
            )
          }),
        )
        .handle(
          "adjustStock",
          Effect.fn("Http.Inventory.adjustStock")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              inventory.adjustStock({ principal, tenantId: headers["x-tenant-id"], ...payload }),
            )
          }),
        )
        .handle(
          "receiveStock",
          Effect.fn("Http.Inventory.receiveStock")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              inventory.receiveStock({ principal, tenantId: headers["x-tenant-id"], ...payload }),
            )
          }),
        )
        .handle(
          "reserveStock",
          Effect.fn("Http.Inventory.reserveStock")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              inventory.reserveStock({ principal, tenantId: headers["x-tenant-id"], ...payload }),
            )
          }),
        )
        .handle(
          "releaseReservation",
          Effect.fn("Http.Inventory.releaseReservation")(function* ({ headers, params }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              inventory.releaseReservation({
                principal,
                tenantId: headers["x-tenant-id"],
                reservationId: params.id,
              }),
            )
          }),
        )
        .handle(
          "fulfillReservation",
          Effect.fn("Http.Inventory.fulfillReservation")(function* ({ headers, params }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              inventory.fulfillReservation({
                principal,
                tenantId: headers["x-tenant-id"],
                reservationId: params.id,
              }),
            )
          }),
        )
        .handle(
          "createTransfer",
          Effect.fn("Http.Inventory.createTransfer")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              inventory.createTransfer({ principal, tenantId: headers["x-tenant-id"], ...payload }),
            )
          }),
        )
        .handle(
          "confirmTransfer",
          Effect.fn("Http.Inventory.confirmTransfer")(function* ({ headers, params }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              inventory.confirmTransfer({
                principal,
                tenantId: headers["x-tenant-id"],
                transferId: params.id,
              }),
            )
          }),
        )
        .handle(
          "completeTransfer",
          Effect.fn("Http.Inventory.completeTransfer")(function* ({ headers, params }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              inventory.completeTransfer({
                principal,
                tenantId: headers["x-tenant-id"],
                transferId: params.id,
              }),
            )
          }),
        )
    }),
)
