import * as Data from "effect/Data"

import type { SalesOrderStatus } from "./contract.ts"

/**
 * Pure order lifecycle decisions (SAL-ORDER-1, SAL-ORDER-2). A store reads the locked order, asks
 * here what to do, and performs only the write the decision names, so the memory and PostgreSQL
 * stores cannot disagree about which transitions exist.
 */

export type ConfirmationDecision = Data.TaggedEnum<{
  /** The order is a draft: record the confirmation and publish the event. */
  Confirm: {}
  /** Already confirmed with the same key: return it unchanged, publish nothing. */
  Existing: {}
  /** Already confirmed with a different key. */
  IdempotencyConflict: {}
  InvalidState: { readonly status: SalesOrderStatus }
}>

export const ConfirmationDecision = Data.taggedEnum<ConfirmationDecision>()

export const decideConfirmation = (
  order: {
    readonly status: SalesOrderStatus
    /** The key recorded when the order was confirmed, or null for an order never confirmed. */
    readonly confirmationIdempotencyKey: string | null
  },
  idempotencyKey: string,
): ConfirmationDecision => {
  switch (order.status) {
    case "draft":
      return ConfirmationDecision.Confirm()
    case "confirmed":
      return order.confirmationIdempotencyKey === idempotencyKey
        ? ConfirmationDecision.Existing()
        : ConfirmationDecision.IdempotencyConflict()
    case "cancelled":
      return ConfirmationDecision.InvalidState({ status: order.status })
  }
}

export type CancellationDecision = Data.TaggedEnum<{
  Cancel: {}
  /** Cancelling a cancelled order is a no-op that returns it. */
  AlreadyCancelled: {}
  InvalidState: { readonly status: SalesOrderStatus }
}>

export const CancellationDecision = Data.taggedEnum<CancellationDecision>()

export const decideCancellation = (status: SalesOrderStatus): CancellationDecision => {
  switch (status) {
    case "confirmed":
      return CancellationDecision.Cancel()
    case "cancelled":
      return CancellationDecision.AlreadyCancelled()
    case "draft":
      return CancellationDecision.InvalidState({ status })
  }
}

/**
 * An order created from a quotation must belong to the quotation's customer (SAL-ORDER-3). The
 * tenant side of the reference is the composite foreign keys' job and stays in PostgreSQL.
 */
export const quotationBelongsToCustomer = (
  quotation: { readonly customerId: string },
  customerId: string,
): boolean => quotation.customerId === customerId
