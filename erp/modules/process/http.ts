// HTTP adapter for this module (ADR-0094). Only the composition root imports this file.
import * as Effect from "effect/Effect"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import * as Schema from "effect/Schema"

import { CalendarDate, PositiveQuantity } from "../../../framework/foundation/mod.ts"
import {
  ApiErrors as errors,
  BaseApiErrorPolicy,
  BearerAuth,
  BoundedArray,
  CurrentPrincipal,
  NonEmptyString,
  PositiveInt,
  ShortString,
  TenantHeaders as tenantHeaders,
  Uuid,
  apiErrorMapping,
  moduleApi,
  ReadLimit,
} from "../../../framework/modules/http/mod.ts"
import {
  OrderCancellationPayload,
  OrderCancellationResult,
  OrderConfirmationPayload,
  OrderConfirmationResult,
  OrderDelivery,
  OrderToCashService,
  OrderFulfillmentPayload,
  OrderFulfillmentResult,
  ProcessCatalogCapabilityKind,
  ProcessCatalogDescriptor,
  ProcessJobInboxItem,
  ProcessOperatorAction,
  ProcessOperatorControl,
  ProcessRuntimeInstance,
  ProcessService,
  ProcessStaticValidation,
  ProcessStudioService,
  ProcessWorkflowRun,
  ResolveProcessCatalogInput,
  WorkflowRun,
} from "./mod.ts"

const CreatedOrderConfirmation = OrderConfirmationResult.pipe(HttpApiSchema.status(201))
const CreatedOrderCancellation = OrderCancellationResult.pipe(HttpApiSchema.status(201))
const CreatedOrderFulfillment = OrderFulfillmentResult.pipe(HttpApiSchema.status(201))
const CreatedOrderDelivery = OrderDelivery.pipe(HttpApiSchema.status(201))

const ProcessInboxResponse = Schema.Struct({
  runtimeInstances: BoundedArray(ProcessRuntimeInstance),
  jobs: BoundedArray(ProcessJobInboxItem),
})

const ProcessReadLimit = ReadLimit

export const ProcessHttpGroup = HttpApiGroup.make("Process").add(
  HttpApiEndpoint.post("confirmOrder", "/process/order-confirmations", {
    headers: tenantHeaders,
    payload: OrderConfirmationPayload,
    success: CreatedOrderConfirmation,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("cancelOrder", "/process/order-cancellations", {
    headers: tenantHeaders,
    payload: OrderCancellationPayload,
    success: CreatedOrderCancellation,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("fulfillOrder", "/process/order-fulfillments", {
    headers: tenantHeaders,
    payload: OrderFulfillmentPayload,
    success: CreatedOrderFulfillment,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("deliverOrder", "/process/order-deliveries", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      orderId: Uuid,
      deliveryId: Schema.optionalKey(Uuid),
      warehouseId: Uuid,
      deliveryDate: CalendarDate,
      lines: BoundedArray(Schema.Struct({ orderLineId: Uuid, quantity: PositiveQuantity })).check(
        Schema.isMinLength(1),
      ),
    }),
    success: CreatedOrderDelivery,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("recoverOrder", "/process/order-confirmations/recover", {
    headers: tenantHeaders,
    payload: OrderConfirmationPayload,
    success: OrderConfirmationResult,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("manualRecovery", "/process/order-confirmations/manual-recovery", {
    headers: tenantHeaders,
    payload: Schema.Struct({ idempotencyKey: ShortString, reason: NonEmptyString }),
    success: WorkflowRun,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listCatalog", "/process/catalog", {
    headers: tenantHeaders,
    query: {
      kind: Schema.optionalKey(ProcessCatalogCapabilityKind),
      limit: ProcessReadLimit,
    },
    success: BoundedArray(ProcessCatalogDescriptor),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("validateDefinition", "/process/definitions/validate", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      definitionId: Uuid,
      definitionVersion: PositiveInt,
      catalogVersion: PositiveInt,
      references: BoundedArray(ResolveProcessCatalogInput),
    }),
    success: ProcessStaticValidation,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listRuntimeInstances", "/process/runtime", {
    headers: tenantHeaders,
    query: {
      status: Schema.optionalKey(ProcessRuntimeInstance.fields.status),
      environment: Schema.optionalKey(Schema.Literals(["DEV", "TEST", "PROD"])),
      limit: ProcessReadLimit,
    },
    success: BoundedArray(ProcessRuntimeInstance),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listWorkflowRuns", "/process/workflow-runs", {
    headers: tenantHeaders,
    query: {
      workflowType: Schema.optionalKey(ProcessWorkflowRun.fields.workflowType),
      status: Schema.optionalKey(ProcessWorkflowRun.fields.status),
      limit: ProcessReadLimit,
    },
    success: BoundedArray(ProcessWorkflowRun),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listOperatorInbox", "/process/inbox", {
    headers: tenantHeaders,
    query: { limit: ProcessReadLimit },
    success: ProcessInboxResponse,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listOperatorControls", "/process/operator-controls", {
    headers: tenantHeaders,
    query: { instanceId: Schema.optionalKey(Uuid), limit: ProcessReadLimit },
    success: BoundedArray(ProcessOperatorControl),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("operateRuntime", "/process/runtime/:id/operator-controls", {
    params: { id: Uuid },
    headers: tenantHeaders,
    payload: Schema.Struct({
      action: ProcessOperatorAction,
      idempotencyKey: ShortString,
      reason: NonEmptyString,
    }),
    success: ProcessRuntimeInstance,
    error: errors,
  }).middleware(BearerAuth),
)

const ProcessHttpApi = moduleApi(ProcessHttpGroup)

export const ProcessHttpErrors = apiErrorMapping({
  ...BaseApiErrorPolicy,
  AccountNotFound: "not_found",
  AccountingLegalEntityNotFound: "not_found",
  AccountingPeriodNotOpen: "conflict",
  CustomerLegalEntityRequired: "conflict",
  DeliveryExceedsOrder: "conflict",
  InventoryReferenceNotFound: "not_found",
  InvalidJournalLine: "conflict",
  OrderLineNotFound: "not_found",
  PostingRuleNotFound: "conflict",
  ProductNotFound: "not_found",
  StockValuationUnavailable: "conflict",
  UnbalancedJournal: "conflict",
  FinancialEngineActivated: "conflict",
  JournalIdempotencyConflict: "conflict",
  RevenueJournalNotFound: "not_found",
  RevenuePostingProfileNotFound: "not_found",
  SalesOrderConfirmationIdempotencyConflict: "conflict",
  SalesOrderInvalidState: "conflict",
  SalesOrderNotFound: "not_found",
  StockReservationIdempotencyConflict: "conflict",
  StockReservationInvalidState: "conflict",
  StockReservationLegalEntityMismatch: "conflict",
  StockReservationNotFound: "not_found",
  StockUnavailable: "conflict",
  OrderConfirmationCorrupt: "conflict",
  OrderConfirmationNotFound: "not_found",
  ProcessCheckpointInvalid: "service_unavailable",
  ProcessCheckpointRevisionConflict: "conflict",
  ProcessOperatorActionUnavailable: "conflict",
  ProcessOperatorConflict: "conflict",
  ProcessReleaseValidationFailed: "conflict",
  ProcessRuntimeInstanceNotFound: "not_found",
  ProcessStudioRecordCorrupt: "service_unavailable",
  WorkflowAlreadyCompleted: "conflict",
  WorkflowAlreadyInProgress: "conflict",
  WorkflowIdempotencyConflict: "conflict",
  WorkflowManualRecoveryRequired: "conflict",
  WorkflowOutcomeUnknown: "service_unavailable",
  WorkflowResultCorrupt: "conflict",
  WorkflowRunNotFound: "not_found",
})

const coreApiEffect = ProcessHttpErrors.apiEffect

export const ProcessHttpHandlers = HttpApiBuilder.group(ProcessHttpApi, "Process", (handlers) =>
  Effect.gen(function* () {
    const process = yield* ProcessService
    const studio = yield* ProcessStudioService
    const orderToCash = yield* OrderToCashService

    return handlers
      .handle(
        "confirmOrder",
        Effect.fn("Http.Process.confirmOrder")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            process.confirmOrder({ principal, tenantId: headers["x-tenant-id"], ...payload }),
          )
        }),
      )
      .handle(
        "deliverOrder",
        Effect.fn("Http.Process.deliverOrder")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            orderToCash.deliverOrder({ principal, tenantId: headers["x-tenant-id"], ...payload }),
          )
        }),
      )
      .handle(
        "cancelOrder",
        Effect.fn("Http.Process.cancelOrder")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            process.cancelOrder({ principal, tenantId: headers["x-tenant-id"], ...payload }),
          )
        }),
      )
      .handle(
        "fulfillOrder",
        Effect.fn("Http.Process.fulfillOrder")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            process.fulfillOrder({ principal, tenantId: headers["x-tenant-id"], ...payload }),
          )
        }),
      )
      .handle(
        "recoverOrder",
        Effect.fn("Http.Process.recoverOrder")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            process.recoverOrder({ principal, tenantId: headers["x-tenant-id"], ...payload }),
          )
        }),
      )
      .handle(
        "manualRecovery",
        Effect.fn("Http.Process.manualRecovery")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            process.markManualRecovery({
              principal,
              tenantId: headers["x-tenant-id"],
              ...payload,
            }),
          )
        }),
      )
      .handle(
        "listCatalog",
        Effect.fn("Http.Process.listCatalog")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            studio.listCatalog({ principal, tenantId: headers["x-tenant-id"], ...query }),
          )
        }),
      )
      .handle(
        "validateDefinition",
        Effect.fn("Http.Process.validateDefinition")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            studio.validateDefinition({
              principal,
              tenantId: headers["x-tenant-id"],
              ...payload,
            }),
          )
        }),
      )
      .handle(
        "listRuntimeInstances",
        Effect.fn("Http.Process.listRuntimeInstances")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            studio.listRuntimeInstances({
              principal,
              tenantId: headers["x-tenant-id"],
              ...query,
            }),
          )
        }),
      )
      .handle(
        "listWorkflowRuns",
        Effect.fn("Http.Process.listWorkflowRuns")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            studio.listWorkflowRuns({ principal, tenantId: headers["x-tenant-id"], ...query }),
          )
        }),
      )
      .handle(
        "listOperatorInbox",
        Effect.fn("Http.Process.listOperatorInbox")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            studio.listOperatorInbox({ principal, tenantId: headers["x-tenant-id"], ...query }),
          )
        }),
      )
      .handle(
        "listOperatorControls",
        Effect.fn("Http.Process.listOperatorControls")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            studio.listOperatorControls({
              principal,
              tenantId: headers["x-tenant-id"],
              ...query,
            }),
          )
        }),
      )
      .handle(
        "operateRuntime",
        Effect.fn("Http.Process.operateRuntime")(function* ({ headers, params, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            studio.operateRuntime({
              principal,
              tenantId: headers["x-tenant-id"],
              instanceId: params.id,
              ...payload,
            }),
          )
        }),
      )
  }),
)
