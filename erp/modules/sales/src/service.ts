import type { CapabilityType } from "../../../../framework/modules/authorization/mod.ts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { FinancialMajorAmount, uuidv7 } from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import { AuthorizationService } from "../../../../framework/modules/authorization/mod.ts"
import { MessagingService } from "../../../../framework/modules/messaging/mod.ts"
import { SalesCapabilities } from "./capabilities.ts"
import {
  CancelConfirmedOrderInput,
  ConfirmOrderInput,
  CreateCustomerInput,
  CreateOrderInput,
  CreateQuotationInput,
  GetConfirmedOrderTotalInput,
  GetCustomerInput,
  GetOrderInput,
  GetQuotationInput,
  ListCustomersInput,
  ListOrdersInput,
  ListQuotationsInput,
  SalesService,
} from "./contract.ts"
import {
  CustomerNotFound,
  QuotationNotFound,
  SalesOrderConfirmationIdempotencyConflict,
  SalesOrderInvalidState,
  SalesOrderNotFound,
} from "./errors.ts"
import { SalesOrderConfirmedEvent, SalesOrderConfirmedEventPayload } from "./events.ts"
import type { SalesStore } from "./store.ts"
import { CancellationMutation, ConfirmationMutation, ConfirmedTotalLookup } from "./store.ts"

export const makeSalesServiceFromStore = <R>(storeEffect: Effect.Effect<SalesStore, never, R>) =>
  Effect.gen(function* () {
    const store = yield* storeEffect
    const authorization = yield* AuthorizationService
    const messaging = yield* MessagingService
    const authorize = (
      input: { principal: Schema.Schema.Type<typeof Principal>; tenantId: string },
      capability: CapabilityType,
    ) =>
      authorization.authorize({ principal: input.principal, tenantId: input.tenantId, capability })
    const listCustomers = Effect.fn("SalesService.listCustomers")(function* (
      input: Schema.Codec.Encoded<typeof ListCustomersInput>,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(ListCustomersInput)(input)
      yield* authorize(decoded, SalesCapabilities.customerRead)
      return yield* store.listCustomers(decoded)
    })
    const getCustomer = Effect.fn("SalesService.getCustomer")(function* (
      input: Schema.Codec.Encoded<typeof GetCustomerInput>,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(GetCustomerInput)(input)
      yield* authorize(decoded, SalesCapabilities.customerRead)
      const customer = yield* store.getCustomer(decoded)
      if (customer === undefined) {
        return yield* Effect.fail(
          new CustomerNotFound({ tenantId: decoded.tenantId, customerId: decoded.customerId }),
        )
      }
      return customer
    })
    const listQuotations = Effect.fn("SalesService.listQuotations")(function* (
      input: Schema.Codec.Encoded<typeof ListQuotationsInput>,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(ListQuotationsInput)(input)
      yield* authorize(decoded, SalesCapabilities.quotationRead)
      return yield* store.listQuotations(decoded)
    })
    const getQuotation = Effect.fn("SalesService.getQuotation")(function* (
      input: Schema.Codec.Encoded<typeof GetQuotationInput>,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(GetQuotationInput)(input)
      yield* authorize(decoded, SalesCapabilities.quotationRead)
      const quotation = yield* store.getQuotation(decoded)
      if (quotation === undefined) {
        return yield* Effect.fail(
          new QuotationNotFound({ tenantId: decoded.tenantId, quotationId: decoded.quotationId }),
        )
      }
      return quotation
    })
    const listOrders = Effect.fn("SalesService.listOrders")(function* (
      input: Schema.Codec.Encoded<typeof ListOrdersInput>,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(ListOrdersInput)(input)
      yield* authorize(decoded, SalesCapabilities.orderRead)
      return yield* store.listOrders(decoded)
    })
    const getOrder = Effect.fn("SalesService.getOrder")(function* (
      input: Schema.Codec.Encoded<typeof GetOrderInput>,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(GetOrderInput)(input)
      yield* authorize(decoded, SalesCapabilities.orderRead)
      const order = yield* store.getOrder(decoded)
      if (order === undefined) {
        return yield* Effect.fail(
          new SalesOrderNotFound({ tenantId: decoded.tenantId, orderId: decoded.orderId }),
        )
      }
      return order
    })
    const createCustomer = Effect.fn("SalesService.createCustomer")(function* (
      input: Schema.Codec.Encoded<typeof CreateCustomerInput>,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(CreateCustomerInput)(input)
      yield* authorize(decoded, SalesCapabilities.customerCreate)
      return yield* store.createCustomer(decoded)
    })
    const createQuotation = Effect.fn("SalesService.createQuotation")(function* (
      input: Schema.Codec.Encoded<typeof CreateQuotationInput>,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(CreateQuotationInput)(input)
      yield* authorize(decoded, SalesCapabilities.quotationCreate)
      return yield* store.createQuotation(decoded)
    })
    const createOrder = Effect.fn("SalesService.createOrder")(function* (
      input: Schema.Codec.Encoded<typeof CreateOrderInput>,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(CreateOrderInput)(input)
      yield* authorize(decoded, SalesCapabilities.orderCreate)
      const order = yield* store.createOrder(decoded)
      yield* Schema.decodeUnknownEffect(FinancialMajorAmount)(order.total)
      return order
    })
    const confirmOrder = Effect.fn("SalesService.confirmOrder")(function* (
      input: Schema.Codec.Encoded<typeof ConfirmOrderInput>,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(ConfirmOrderInput)(input)
      yield* authorize(decoded, SalesCapabilities.orderConfirm)
      const normalized = {
        ...decoded,
        commandId: decoded.commandId.trim(),
        correlationId: decoded.correlationId.trim(),
        causationId: decoded.causationId?.trim() ?? null,
        idempotencyKey: decoded.idempotencyKey.trim(),
      }
      const mutation = yield* store.confirmOrder(normalized, (order) =>
        Schema.decodeUnknownEffect(SalesOrderConfirmedEventPayload)({
          orderId: order.id,
          total: order.total,
        }).pipe(
          Effect.flatMap((payload) =>
            messaging.append({
              eventId: uuidv7(),
              eventType: SalesOrderConfirmedEvent.id,
              eventVersion: SalesOrderConfirmedEvent.version,
              tenantId: normalized.tenantId,
              aggregateType: SalesOrderConfirmedEvent.aggregateType,
              aggregateId: order.id,
              commandId: normalized.commandId,
              correlationId: normalized.correlationId,
              causationId: normalized.causationId,
              idempotencyKey: normalized.idempotencyKey,
              actorPrincipalId: normalized.principal.userAccountId,
              occurredAt: order.confirmedAt!,
              payload,
            }),
          ),
        ),
      )
      return yield* ConfirmationMutation.$match(mutation, {
        Confirmed: ({ order }) => Effect.succeed(order),
        Existing: ({ order }) => Effect.succeed(order),
        NotFound: () =>
          Effect.fail(
            new SalesOrderNotFound({ tenantId: decoded.tenantId, orderId: decoded.orderId }),
          ),
        IdempotencyConflict: () =>
          Effect.fail(
            new SalesOrderConfirmationIdempotencyConflict({
              tenantId: normalized.tenantId,
              orderId: normalized.orderId,
              idempotencyKey: normalized.idempotencyKey,
            }),
          ),
        InvalidState: ({ status }) =>
          Effect.fail(
            new SalesOrderInvalidState({
              tenantId: decoded.tenantId,
              orderId: decoded.orderId,
              status,
            }),
          ),
      })
    })
    const cancelConfirmedOrder = Effect.fn("SalesService.cancelConfirmedOrder")(function* (
      input: Schema.Codec.Encoded<typeof CancelConfirmedOrderInput>,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(CancelConfirmedOrderInput)(input)
      yield* authorize(decoded, SalesCapabilities.orderCancel)
      const result = yield* store.cancelConfirmedOrder(decoded)
      return yield* CancellationMutation.$match(result, {
        Cancelled: ({ order }) => Effect.succeed(order),
        NotFound: () =>
          Effect.fail(
            new SalesOrderNotFound({ tenantId: decoded.tenantId, orderId: decoded.orderId }),
          ),
        InvalidState: ({ status }) =>
          Effect.fail(
            new SalesOrderInvalidState({
              tenantId: decoded.tenantId,
              orderId: decoded.orderId,
              status,
            }),
          ),
      })
    })
    const getConfirmedOrderTotal = Effect.fn("SalesService.getConfirmedOrderTotal")(function* (
      input: Schema.Codec.Encoded<typeof GetConfirmedOrderTotalInput>,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(GetConfirmedOrderTotalInput)(input)
      yield* authorize(decoded, SalesCapabilities.orderRead)
      const result = yield* store.getConfirmedOrderTotal(decoded)
      return yield* ConfirmedTotalLookup.$match(result, {
        NotFound: () =>
          Effect.fail(
            new SalesOrderNotFound({ tenantId: decoded.tenantId, orderId: decoded.orderId }),
          ),
        Found: ({ total, status, confirmedAt }) =>
          status !== "confirmed" || confirmedAt === null
            ? Effect.fail(
                new SalesOrderInvalidState({
                  tenantId: decoded.tenantId,
                  orderId: decoded.orderId,
                  status,
                }),
              )
            : Effect.succeed(total),
      })
    })
    return {
      listCustomers,
      getCustomer,
      listQuotations,
      getQuotation,
      listOrders,
      getOrder,
      createCustomer,
      createQuotation,
      createOrder,
      confirmOrder,
      cancelConfirmedOrder,
      getConfirmedOrderTotal,
    } satisfies SalesService
  })
