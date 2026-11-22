import * as Data from "effect/Data"

import { requireExactMajorToMinor } from "../../../../framework/foundation/mod.ts"
import type { PurchaseOrderLine, PurchaseOrderStatus } from "./contract.ts"

/**
 * Pure purchase order decisions (PRC-PO-1, PRC-PO-2, PRC-PO-3, PRC-REL-1). A store reads the locked
 * order, asks here what to do, and performs only the write the decision names, so the memory and
 * PostgreSQL stores cannot disagree about which transitions exist.
 *
 * What stays in each store on purpose: finding the order, locking it, reading and submitting the
 * approval request (PostgreSQL only, because Approvals has no memory implementation), the receipt
 * lookup that precedes a cancellation, and keeping one confirmation key from naming two orders (a
 * map in memory, a unique constraint in PostgreSQL).
 */

/**
 * The total is `sum(quantity * unit price)` in integer minor units, never a float. It does not
 * bound the result: a caller checks it against the major-amount boundary, so an order that
 * overflows it fails as a schema error and not as a defect.
 */
export const deriveTotal = (
  lines: ReadonlyArray<Pick<PurchaseOrderLine, "quantity" | "unitPrice">>,
): string => {
  const minor = lines.reduce(
    (total, line) => total + BigInt(line.quantity) * requireExactMajorToMinor(line.unitPrice, 2),
    0n,
  )

  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`
}

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

export type ApprovalCover = Data.TaggedEnum<{
  /** An approved request for exactly the total: the order may be confirmed. */
  Covered: {}
  /** No request exists. */
  Missing: {}
  /**
   * A request exists and does not cover the total: it is pending or rejected, or approved for a
   * different amount. `excess` is true when it was approved for more than the total.
   */
  NotCovered: { readonly status: string; readonly excess: boolean }
}>

export const ApprovalCover = Data.taggedEnum<ApprovalCover>()

/**
 * An approval is valid only for the amount it was requested for (ADR-0125), so a larger approval
 * does not cover a smaller order. `excess` lets `releasePurchaseOrder`, which checks only that the
 * amount is at least the total, hand an over-approved order on to confirmation, which refuses it.
 * Both amounts are canonical two-decimal strings: Approvals normalizes the stored one.
 */
export const decideApprovalCover = (
  approval: { readonly status: string; readonly amount: string } | null | undefined,
  total: string,
): ApprovalCover => {
  if (approval === null || approval === undefined) return ApprovalCover.Missing()

  if (approval.status !== "approved") {
    return ApprovalCover.NotCovered({ status: approval.status, excess: false })
  }

  const granted = requireExactMajorToMinor(approval.amount, 2)
  const required = requireExactMajorToMinor(total, 2)

  return granted === required
    ? ApprovalCover.Covered()
    : ApprovalCover.NotCovered({ status: approval.status, excess: granted > required })
}
