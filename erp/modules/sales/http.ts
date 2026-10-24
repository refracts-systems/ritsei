// HTTP adapter for this module (ADR-0094). Only the composition root imports this file.
import * as Effect from "effect/Effect"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import * as Schema from "effect/Schema"

import { FinancialMajorAmount } from "../../../framework/foundation/mod.ts"
import {
  ApiErrors as errors,
  BaseApiErrorPolicy,
  BearerAuth,
  BoundedArray,
  CurrentPrincipal,
  Email,
  ShortString,
  TenantHeaders as tenantHeaders,
  Uuid,
  apiErrorMapping,
  moduleApi,
} from "../../../framework/modules/http/mod.ts"
import {
  Customer,
  Quotation,
  QuotationStatus,
  SalesOrder,
  SalesOrderLine,
  SalesOrderStatus,
  SalesService,
} from "./mod.ts"

const CreatedCustomer = Customer.pipe(HttpApiSchema.status(201))
const CreatedQuotation = Quotation.pipe(HttpApiSchema.status(201))
const CreatedOrder = SalesOrder.pipe(HttpApiSchema.status(201))

export const SalesHttpGroup = HttpApiGroup.make("Sales").add(
  HttpApiEndpoint.get("listCustomers", "/sales/customers", {
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
    success: Schema.Array(Customer),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("getCustomer", "/sales/customers/:id", {
    params: { id: Uuid },
    headers: tenantHeaders,
    success: Customer,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createCustomer", "/sales/customers", {
    headers: tenantHeaders,
    payload: Schema.Struct({ name: ShortString, email: Email }),
    success: CreatedCustomer,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listQuotations", "/sales/quotations", {
    headers: tenantHeaders,
    query: {
      customerId: Schema.optionalKey(Uuid),
      status: Schema.optionalKey(QuotationStatus),
      limit: Schema.optionalKey(
        Schema.NumberFromString.pipe(
          Schema.check(Schema.isInt()),
          Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
        ),
      ),
    },
    success: Schema.Array(Quotation),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("getQuotation", "/sales/quotations/:id", {
    params: { id: Uuid },
    headers: tenantHeaders,
    success: Quotation,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createQuotation", "/sales/quotations", {
    headers: tenantHeaders,
    payload: Schema.Struct({ customerId: Uuid, total: FinancialMajorAmount }),
    success: CreatedQuotation,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listOrders", "/sales/orders", {
    headers: tenantHeaders,
    query: {
      customerId: Schema.optionalKey(Uuid),
      status: Schema.optionalKey(SalesOrderStatus),
      limit: Schema.optionalKey(
        Schema.NumberFromString.pipe(
          Schema.check(Schema.isInt()),
          Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
        ),
      ),
    },
    success: Schema.Array(SalesOrder),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("getOrder", "/sales/orders/:id", {
    params: { id: Uuid },
    headers: tenantHeaders,
    success: SalesOrder,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createOrder", "/sales/orders", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      customerId: Uuid,
      quotationId: Schema.optionalKey(Uuid),
      lines: BoundedArray(SalesOrderLine).check(Schema.isMinLength(1)),
    }),
    success: CreatedOrder,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("confirmOrder", "/sales/orders/:id/confirm", {
    params: { id: Uuid },
    headers: tenantHeaders,
    payload: Schema.Struct({
      commandId: ShortString,
      correlationId: ShortString,
      causationId: Schema.optionalKey(Schema.NullOr(ShortString)),
      idempotencyKey: ShortString,
    }),
    success: SalesOrder,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("cancelOrder", "/sales/orders/:id/cancel", {
    params: { id: Uuid },
    headers: tenantHeaders,
    success: SalesOrder,
    error: errors,
  }).middleware(BearerAuth),
)

const SalesHttpApi = moduleApi(SalesHttpGroup)

export const SalesHttpErrors = apiErrorMapping({
  ...BaseApiErrorPolicy,
  CustomerAlreadyExists: "conflict",
  CustomerNotFound: "not_found",
  QuotationCustomerMismatch: "conflict",
  QuotationNotFound: "not_found",
  SalesOrderConfirmationIdempotencyConflict: "conflict",
  SalesOrderInvalidState: "conflict",
  SalesOrderNotFound: "not_found",
})

const coreApiEffect = SalesHttpErrors.apiEffect

export const SalesHttpHandlers = HttpApiBuilder.group(SalesHttpApi, "Sales", (handlers) =>
  Effect.gen(function* () {
    const sales = yield* SalesService

    return handlers
      .handle(
        "listCustomers",
        Effect.fn("Http.Sales.listCustomers")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            sales.listCustomers({ principal, tenantId: headers["x-tenant-id"], ...query }),
          )
        }),
      )
      .handle(
        "getCustomer",
        Effect.fn("Http.Sales.getCustomer")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            sales.getCustomer({
              principal,
              tenantId: headers["x-tenant-id"],
              customerId: params.id,
            }),
          )
        }),
      )
      .handle(
        "createCustomer",
        Effect.fn("Http.Sales.createCustomer")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            sales.createCustomer({ principal, tenantId: headers["x-tenant-id"], ...payload }),
          )
        }),
      )
      .handle(
        "listQuotations",
        Effect.fn("Http.Sales.listQuotations")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            sales.listQuotations({ principal, tenantId: headers["x-tenant-id"], ...query }),
          )
        }),
      )
      .handle(
        "getQuotation",
        Effect.fn("Http.Sales.getQuotation")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            sales.getQuotation({
              principal,
              tenantId: headers["x-tenant-id"],
              quotationId: params.id,
            }),
          )
        }),
      )
      .handle(
        "createQuotation",
        Effect.fn("Http.Sales.createQuotation")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            sales.createQuotation({ principal, tenantId: headers["x-tenant-id"], ...payload }),
          )
        }),
      )
      .handle(
        "listOrders",
        Effect.fn("Http.Sales.listOrders")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            sales.listOrders({ principal, tenantId: headers["x-tenant-id"], ...query }),
          )
        }),
      )
      .handle(
        "getOrder",
        Effect.fn("Http.Sales.getOrder")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            sales.getOrder({
              principal,
              tenantId: headers["x-tenant-id"],
              orderId: params.id,
            }),
          )
        }),
      )
      .handle(
        "createOrder",
        Effect.fn("Http.Sales.createOrder")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            sales.createOrder({ principal, tenantId: headers["x-tenant-id"], ...payload }),
          )
        }),
      )
      .handle(
        "confirmOrder",
        Effect.fn("Http.Sales.confirmOrder")(function* ({ headers, params, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            sales.confirmOrder({
              principal,
              tenantId: headers["x-tenant-id"],
              orderId: params.id,
              ...payload,
            }),
          )
        }),
      )
      .handle(
        "cancelOrder",
        Effect.fn("Http.Sales.cancelOrder")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal

          return yield* coreApiEffect(
            sales.cancelConfirmedOrder({
              principal,
              tenantId: headers["x-tenant-id"],
              orderId: params.id,
            }),
          )
        }),
      )
  }),
)
