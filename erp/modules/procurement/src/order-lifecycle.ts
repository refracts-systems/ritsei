import * as Data from "effect/Data"

import type { PurchaseOrderStatus } from "./contract.ts"

/**
 * Pure purchase order lifecycle decisions (PRC-PO-1, PRC-PO-3). A store reads the locked order, asks
 * here what to do, and performs only the write the decision names, so the memory and PostgreSQL
 * stores cannot disagree about which transitions exist.
 *
 * What stays in each store on purpose: finding the order, locking it, the approval gate (PostgreSQL
 * only, because Approvals has no memory implementation), the receipt lookup that precedes a
 * cancellation, and keeping one confirmation key from naming two orders (a map in memory, a unique
 * constraint in PostgreSQL).
 */

export type ConfirmationDecision = Data.TaggedEnum<{
  /** The order is a draft: record the confirmation and publish the event. */
  Confirm: {}
  /** Already confirmed with the same key: return it unchanged, publish nothing. */
  Existing: {}
  /** Already confirmed with a different key. */
  IdempotencyConflict: {}
  InvalidState: { readonly status: PurchaseOrderStatus }
}>

export const ConfirmationDecision = Data.taggedEnum<ConfirmationDecision>()

export const decideConfirmation = (
  order: {
    readonly status: PurchaseOrderStatus
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
  /** The order is confirmed: cancel it unless a receipt exists, which the store checks next. */
  Cancel: {}
  /** Cancelling a cancelled order is a no-op that returns it. */
  AlreadyCancelled: {}
  InvalidState: { readonly status: PurchaseOrderStatus }
}>

export const CancellationDecision = Data.taggedEnum<CancellationDecision>()

export const decideCancellation = (status: PurchaseOrderStatus): CancellationDecision => {
  switch (status) {
    case "confirmed":
      return CancellationDecision.Cancel()
    case "cancelled":
      return CancellationDecision.AlreadyCancelled()
    case "draft":
      return CancellationDecision.InvalidState({ status })
  }
}
