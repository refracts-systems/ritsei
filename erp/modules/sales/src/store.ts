import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { DatabaseFailure, requireExactMajorToMinor } from "../../../../framework/foundation/mod.ts"
import { EventIdempotencyConflict } from "../../../../framework/modules/messaging/mod.ts"
import type {
  CancelConfirmedOrderCommand,
  ConfirmOrderCommand,
  CreateCustomerCommand,
  CreateOrderCommand,
  CreateQuotationCommand,
  Customer,
  GetConfirmedOrderTotalCommand,
  GetCustomerCommand,
  GetOrderCommand,
  GetQuotationCommand,
  ListCustomersCommand,
  ListOrdersCommand,
  ListQuotationsCommand,
  Quotation,
  SalesOrder,
  SalesOrderLine,
} from "./contract.ts"
import type { SalesOrderStatus } from "./contract.ts"
import {
  CustomerAlreadyExists,
  CustomerNotFound,
  QuotationCustomerMismatch,
  QuotationNotFound,
  SalesOrderConfirmationIdempotencyConflict,
  SalesOrderInvalidState,
  SalesOrderNotFound,
} from "./errors.ts"

export type SalesStoreFailure =
  | DatabaseFailure
  | CustomerAlreadyExists
  | CustomerNotFound
  | QuotationCustomerMismatch
  | QuotationNotFound
  | SalesOrderNotFound
  | SalesOrderInvalidState
  | SalesOrderConfirmationIdempotencyConflict
export type ConfirmationMutation = Data.TaggedEnum<{
  Confirmed: { readonly order: SalesOrder }
  Existing: { readonly order: SalesOrder }
  NotFound: {}
  IdempotencyConflict: {}
  InvalidState: { readonly status: SalesOrderStatus }
}>
export const ConfirmationMutation = Data.taggedEnum<ConfirmationMutation>()

export type CancellationMutation = Data.TaggedEnum<{
  Cancelled: { readonly order: SalesOrder }
  NotFound: {}
  InvalidState: { readonly status: SalesOrderStatus }
}>
export const CancellationMutation = Data.taggedEnum<CancellationMutation>()

export type ConfirmedTotalLookup = Data.TaggedEnum<{
  Found: {
    readonly total: string
    readonly status: SalesOrderStatus
    readonly confirmedAt: string | null
  }
  NotFound: {}
}>
export const ConfirmedTotalLookup = Data.taggedEnum<ConfirmedTotalLookup>()

export type OrderCreation = Data.TaggedEnum<{
  Created: { readonly order: SalesOrder }
  QuotationCustomerMismatch: {}
}>
export const OrderCreation = Data.taggedEnum<OrderCreation>()

export const toSalesOrder = (
  row: {
    readonly id: string
    readonly tenantId: string
    readonly customerId: string
    readonly quotationId: string | null
    readonly status: "draft" | "confirmed" | "cancelled"
    readonly confirmedAt: Date | null
    readonly total: string
  },
  lines: ReadonlyArray<SalesOrderLine>,
): SalesOrder => ({
  id: row.id,
  tenantId: row.tenantId,
  customerId: row.customerId,
  quotationId: row.quotationId,
  status: row.status,
  confirmedAt: row.confirmedAt?.toISOString() ?? null,
  total: row.total,
  lines: lines.map(({ itemId, quantity, unitPrice }) => ({ itemId, quantity, unitPrice })),
})

export interface SalesStore {
  readonly listCustomers: (
    input: ListCustomersCommand,
  ) => Effect.Effect<ReadonlyArray<Customer>, DatabaseFailure>
  readonly getCustomer: (
    input: GetCustomerCommand,
  ) => Effect.Effect<Customer | undefined, DatabaseFailure>
  readonly listQuotations: (
    input: ListQuotationsCommand,
  ) => Effect.Effect<ReadonlyArray<Quotation>, DatabaseFailure>
  readonly getQuotation: (
    input: GetQuotationCommand,
  ) => Effect.Effect<Quotation | undefined, DatabaseFailure>
  readonly listOrders: (
    input: ListOrdersCommand,
  ) => Effect.Effect<ReadonlyArray<SalesOrder>, DatabaseFailure>
  readonly getOrder: (
    input: GetOrderCommand,
  ) => Effect.Effect<SalesOrder | undefined, DatabaseFailure>
  readonly createCustomer: (
    input: CreateCustomerCommand,
  ) => Effect.Effect<Customer, CustomerAlreadyExists | DatabaseFailure>
  readonly createQuotation: (
    input: CreateQuotationCommand,
  ) => Effect.Effect<Quotation, CustomerNotFound | DatabaseFailure>
  readonly createOrder: (
    input: CreateOrderCommand,
  ) => Effect.Effect<
    SalesOrder,
    CustomerNotFound | QuotationCustomerMismatch | QuotationNotFound | DatabaseFailure
  >
  readonly confirmOrder: (
    input: ConfirmOrderCommand,
    append: (
      order: SalesOrder,
    ) => Effect.Effect<unknown, EventIdempotencyConflict | DatabaseFailure | Schema.SchemaError>,
  ) => Effect.Effect<
    ConfirmationMutation,
    | EventIdempotencyConflict
    | DatabaseFailure
    | Schema.SchemaError
    | SalesOrderConfirmationIdempotencyConflict
  >
  readonly cancelConfirmedOrder: (
    input: CancelConfirmedOrderCommand,
  ) => Effect.Effect<CancellationMutation, DatabaseFailure>
  readonly getConfirmedOrderTotal: (
    input: GetConfirmedOrderTotalCommand,
  ) => Effect.Effect<ConfirmedTotalLookup, DatabaseFailure>
}

export const deriveTotal = (lines: ReadonlyArray<SalesOrderLine>): string => {
  const cents = lines.reduce(
    (total, line) => total + BigInt(line.quantity) * requireExactMajorToMinor(line.unitPrice, 2),
    0n,
  )
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`
}
