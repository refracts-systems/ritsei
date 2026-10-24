// HTTP adapter for this module (ADR-0094). Only the composition root imports this file.
import * as Effect from "effect/Effect"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import * as Schema from "effect/Schema"
import * as Option from "effect/Option"

import {
  CalendarDate,
  ConsistencyToken,
  CurrentConsistencyToken,
  FinancialMajorAmount,
  PositiveQuantity,
  PostgresReadYourWrites,
} from "../../../framework/foundation/mod.ts"
import {
  ApiErrors as errors,
  BaseApiErrorPolicy,
  BearerAuth,
  BoundedArray,
  ConsistencyHeaders as consistencyHeaders,
  CurrentPrincipal,
  ShortString,
  TenantHeaders as tenantHeaders,
  Uuid,
  apiErrorMapping,
  moduleApi,
} from "../../../framework/modules/http/mod.ts"
import {
  GoodsReceipt,
  PricedPurchaseOrder,
  ProcurementService,
  PurchaseDocumentService,
  PurchaseMatching,
  PurchaseStockDocument,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  PurchaseReceiptLineInput,
  SupplierAccount,
  SupplierPrice,
} from "./mod.ts"

const CreatedSupplierAccount = SupplierAccount.pipe(HttpApiSchema.status(201))

const CreatedPurchaseOrder = HttpApiSchema.WithHeaders(
  PurchaseOrder.pipe(HttpApiSchema.status(201)),
  { "x-ritsei-consistency-token": Schema.optionalKey(ConsistencyToken) },
)

const CreatedGoodsReceipt = GoodsReceipt.pipe(HttpApiSchema.status(201))
const CreatedPricedPurchaseOrder = PricedPurchaseOrder.pipe(HttpApiSchema.status(201))
const CreatedPurchaseStockDocument = PurchaseStockDocument.pipe(HttpApiSchema.status(201))

const DocumentLines = BoundedArray(
  Schema.Struct({ purchaseOrderLineId: Uuid, quantity: PositiveQuantity }),
).check(Schema.isMinLength(1))

export const ProcurementHttpGroup = HttpApiGroup.make("Procurement").add(
  HttpApiEndpoint.get("listSupplierAccounts", "/procurement/supplier-accounts", {
    headers: tenantHeaders,
    query: {
      limit: Schema.optionalKey(
        Schema.NumberFromString.pipe(
          Schema.check(Schema.isInt()),
          Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
        ),
      ),
    },
    success: Schema.Array(SupplierAccount),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createSupplierAccount", "/procurement/supplier-accounts", {
    headers: tenantHeaders,
    payload: Schema.Struct({ supplierRelationshipId: Uuid }),
    success: CreatedSupplierAccount,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listPurchaseOrders", "/procurement/purchase-orders", {
    headers: tenantHeaders,
    query: {
      supplierAccountId: Schema.optionalKey(Uuid),
      status: Schema.optionalKey(PurchaseOrderStatus),
      limit: Schema.optionalKey(
        Schema.NumberFromString.pipe(
          Schema.check(Schema.isInt()),
          Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
        ),
      ),
    },
    success: Schema.Array(PurchaseOrder),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createPurchaseOrder", "/procurement/purchase-orders", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      supplierAccountId: Uuid,
      lines: BoundedArray(PurchaseOrderLine).check(Schema.isMinLength(1)),
    }),
    success: CreatedPurchaseOrder,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("getPurchaseOrder", "/procurement/purchase-orders/:id", {
    params: { id: Uuid },
    headers: consistencyHeaders,
    success: PurchaseOrder,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("confirmPurchaseOrder", "/procurement/purchase-orders/:id/confirm", {
    params: { id: Uuid },
    headers: tenantHeaders,
    payload: Schema.Struct({ idempotencyKey: ShortString }),
    success: PurchaseOrder,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("cancelPurchaseOrder", "/procurement/purchase-orders/:id/cancel", {
    params: { id: Uuid },
    headers: tenantHeaders,
    success: PurchaseOrder,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listPurchaseReceipts", "/procurement/purchase-orders/:id/receipts", {
    params: { id: Uuid },
    headers: tenantHeaders,
    query: {
      limit: Schema.optionalKey(
        Schema.NumberFromString.pipe(
          Schema.check(Schema.isInt()),
          Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
        ),
      ),
    },
    success: Schema.Array(GoodsReceipt),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("receivePurchaseOrder", "/procurement/purchase-orders/:id/receipts", {
    params: { id: Uuid },
    headers: tenantHeaders,
    payload: Schema.Struct({
      warehouseId: Uuid,
      idempotencyKey: ShortString,
      lines: BoundedArray(PurchaseReceiptLineInput).check(Schema.isMinLength(1)),
    }),
    success: CreatedGoodsReceipt,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listSupplierPrices", "/procurement/supplier-prices", {
    headers: tenantHeaders,
    query: { supplierAccountId: Uuid },
    success: Schema.Array(SupplierPrice),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("setSupplierPrice", "/procurement/supplier-prices", {
    headers: tenantHeaders,
    payload: SupplierPrice,
    success: SupplierPrice,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("draftPurchaseOrder", "/procurement/purchase-order-drafts", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      supplierAccountId: Uuid,
      lines: BoundedArray(
        Schema.Struct({
          productId: Uuid,
          quantity: PositiveQuantity,
          unitPrice: Schema.optionalKey(FinancialMajorAmount),
          taxCodeId: Schema.optionalKey(Schema.NullOr(Uuid)),
        }),
      ).check(Schema.isMinLength(1)),
    }),
    success: CreatedPricedPurchaseOrder,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("releasePurchaseOrder", "/procurement/purchase-orders/:id/release", {
    params: { id: Uuid },
    headers: tenantHeaders,
    payload: Schema.Struct({ idempotencyKey: ShortString }),
    success: PurchaseMatching,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("getPurchaseMatching", "/procurement/purchase-orders/:id/matching", {
    params: { id: Uuid },
    headers: tenantHeaders,
    success: PurchaseMatching,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("receiveValued", "/procurement/purchase-orders/:id/valued-receipts", {
    params: { id: Uuid },
    headers: tenantHeaders,
    payload: Schema.Struct({
      receiptId: Schema.optionalKey(Uuid),
      warehouseId: Uuid,
      receiptDate: CalendarDate,
      lines: DocumentLines,
    }),
    success: CreatedPurchaseStockDocument,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("returnToSupplier", "/procurement/purchase-orders/:id/returns", {
    params: { id: Uuid },
    headers: tenantHeaders,
    payload: Schema.Struct({
      returnId: Schema.optionalKey(Uuid),
      warehouseId: Uuid,
      returnDate: CalendarDate,
      lines: DocumentLines,
    }),
    success: CreatedPurchaseStockDocument,
    error: errors,
  }).middleware(BearerAuth),
)

const ProcurementHttpApi = moduleApi(ProcurementHttpGroup)

export const ProcurementHttpErrors = apiErrorMapping({
  ...BaseApiErrorPolicy,
  InventoryReferenceNotFound: "not_found",
  PartyRelationshipNotFound: "not_found",
  ProductNotFound: "not_found",
  PurchaseLineNotStockable: "conflict",
  PurchaseOrderApprovalRequired: "conflict",
  PurchaseReturnExceedsReceipt: "conflict",
  StockUnavailable: "conflict",
  StockValuationUnavailable: "conflict",
  SupplierPriceNotFound: "not_found",
  AccountNotFound: "not_found",
  AccountingLegalEntityNotFound: "not_found",
  AccountingPeriodNotOpen: "conflict",
  FinancialEngineActivated: "conflict",
  InvalidJournalLine: "conflict",
  JournalIdempotencyConflict: "conflict",
  PostingRuleNotFound: "conflict",
  UnbalancedJournal: "conflict",
  PurchaseOrderConfirmationIdempotencyConflict: "conflict",
  PurchaseOrderHasReceipts: "conflict",
  PurchaseOrderInvalidState: "conflict",
  PurchaseOrderNotFound: "not_found",
  PurchaseReceiptIdempotencyConflict: "conflict",
  PurchaseReceiptInventoryReferenceNotFound: "not_found",
  PurchaseReceiptLineDuplicate: "conflict",
  PurchaseReceiptLineNotFound: "not_found",
  PurchaseReceiptQuantityExceeded: "conflict",
  PurchaseReceiptWarehouseLegalEntityMismatch: "conflict",
  SupplierAccountAlreadyExists: "conflict",
  SupplierAccountNotFound: "not_found",
  SupplierRelationshipNotEligible: "conflict",
})

const coreApiEffect = ProcurementHttpErrors.apiEffect

export const ProcurementHttpHandlers = HttpApiBuilder.group(
  ProcurementHttpApi,
  "Procurement",
  (handlers) =>
    Effect.gen(function* () {
      const procurement = yield* ProcurementService
      const documents = yield* PurchaseDocumentService
      const readYourWrites = yield* Effect.serviceOption(PostgresReadYourWrites)

      return handlers
        .handle(
          "listSupplierAccounts",
          Effect.fn("Http.Procurement.listSupplierAccounts")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              procurement.listSupplierAccounts({
                principal,
                tenantId: headers["x-tenant-id"],
                ...query,
              }),
            )
          }),
        )
        .handle(
          "createSupplierAccount",
          Effect.fn("Http.Procurement.createSupplierAccount")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              procurement.createSupplierAccount({
                principal,
                tenantId: headers["x-tenant-id"],
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "listPurchaseOrders",
          Effect.fn("Http.Procurement.listPurchaseOrders")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              procurement.listPurchaseOrders({
                principal,
                tenantId: headers["x-tenant-id"],
                ...query,
              }),
            )
          }),
        )
        .handle(
          "createPurchaseOrder",
          Effect.fn("Http.Procurement.createPurchaseOrder")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            const order = yield* coreApiEffect(
              procurement.createPurchaseOrder({
                principal,
                tenantId: headers["x-tenant-id"],
                ...payload,
              }),
            )

            // ponytail: best-effort post-commit token capture; create has no idempotency key, so a
            // capture outage must not turn a committed success into a retryable failure.
            const token = Option.isSome(readYourWrites)
              ? yield* readYourWrites.value
                  .capture(headers["x-tenant-id"])
                  .pipe(Effect.catch(() => Effect.succeed(undefined)))
              : undefined

            return HttpApiSchema.withHeaders({
              body: order,
              headers: { "x-ritsei-consistency-token": token },
            })
          }),
        )
        .handle(
          "getPurchaseOrder",
          Effect.fn("Http.Procurement.getPurchaseOrder")(function* ({ headers, params }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              procurement.getPurchaseOrder({
                principal,
                tenantId: headers["x-tenant-id"],
                purchaseOrderId: params.id,
              }),
            ).pipe(
              Effect.provideService(CurrentConsistencyToken, headers["x-ritsei-consistency-token"]),
            )
          }),
        )
        .handle(
          "confirmPurchaseOrder",
          Effect.fn("Http.Procurement.confirmPurchaseOrder")(function* ({
            headers,
            params,
            payload,
          }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              procurement.confirmPurchaseOrder({
                principal,
                tenantId: headers["x-tenant-id"],
                purchaseOrderId: params.id,
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "cancelPurchaseOrder",
          Effect.fn("Http.Procurement.cancelPurchaseOrder")(function* ({ headers, params }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              procurement.cancelPurchaseOrder({
                principal,
                tenantId: headers["x-tenant-id"],
                purchaseOrderId: params.id,
              }),
            )
          }),
        )
        .handle(
          "listPurchaseReceipts",
          Effect.fn("Http.Procurement.listPurchaseReceipts")(function* ({
            headers,
            params,
            query,
          }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              procurement.listPurchaseReceipts({
                principal,
                tenantId: headers["x-tenant-id"],
                purchaseOrderId: params.id,
                ...query,
              }),
            )
          }),
        )
        .handle(
          "receivePurchaseOrder",
          Effect.fn("Http.Procurement.receivePurchaseOrder")(function* ({
            headers,
            params,
            payload,
          }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              procurement.receivePurchaseOrder({
                principal,
                tenantId: headers["x-tenant-id"],
                purchaseOrderId: params.id,
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "listSupplierPrices",
          Effect.fn("Http.Procurement.listSupplierPrices")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              documents.listSupplierPrices({
                principal,
                tenantId: headers["x-tenant-id"],
                ...query,
              }),
            )
          }),
        )
        .handle(
          "setSupplierPrice",
          Effect.fn("Http.Procurement.setSupplierPrice")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              documents.setSupplierPrice({
                principal,
                tenantId: headers["x-tenant-id"],
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "draftPurchaseOrder",
          Effect.fn("Http.Procurement.draftPurchaseOrder")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              documents.draftPurchaseOrder({
                principal,
                tenantId: headers["x-tenant-id"],
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "releasePurchaseOrder",
          Effect.fn("Http.Procurement.releasePurchaseOrder")(function* ({
            headers,
            params,
            payload,
          }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              documents.releasePurchaseOrder({
                principal,
                tenantId: headers["x-tenant-id"],
                purchaseOrderId: params.id,
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "getPurchaseMatching",
          Effect.fn("Http.Procurement.getPurchaseMatching")(function* ({ headers, params }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              documents.getMatching({
                principal,
                tenantId: headers["x-tenant-id"],
                purchaseOrderId: params.id,
              }),
            )
          }),
        )
        .handle(
          "receiveValued",
          Effect.fn("Http.Procurement.receiveValued")(function* ({ headers, params, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              documents.receiveValued({
                principal,
                tenantId: headers["x-tenant-id"],
                purchaseOrderId: params.id,
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "returnToSupplier",
          Effect.fn("Http.Procurement.returnToSupplier")(function* ({ headers, params, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* coreApiEffect(
              documents.returnToSupplier({
                principal,
                tenantId: headers["x-tenant-id"],
                purchaseOrderId: params.id,
                ...payload,
              }),
            )
          }),
        )
    }),
)
