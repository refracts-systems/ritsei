// Pure supplier bill arithmetic (BIL-BILL-1, BIL-CREDIT-1): the three-way match of a bill against
// received, returned, and billed quantity, and the matched value a credit note returns.
import { requireExactMajorToMinor } from "../../../../framework/foundation/mod.ts"
import type { PurchaseMatchingType } from "../../procurement/mod.ts"
import type { BillingDocument } from "./contract.ts"

const minor = (value: string) => requireExactMajorToMinor(value, 2)

export type MatchingLine = PurchaseMatchingType["lines"][number]

export type RequestedBillLine = {
  readonly purchaseOrderLineId: string
  readonly quantity: string
  readonly unitPrice: string
}

export type BillMatch = {
  readonly matched: ReadonlyArray<{
    readonly line: MatchingLine
    readonly requested: RequestedBillLine
    /** Received value this line clears from goods received not invoiced, at the purchase price. */
    readonly matchedValue: bigint
  }>
  /** Billed value beyond what was received, which needs an approved variance. */
  readonly excessValue: bigint
  readonly excess: ReadonlyArray<{
    readonly lineId: string
    readonly billable: bigint
    readonly requested: bigint
  }>
}

/**
 * Three-way match: each line may bill what was received, net of returns, minus what was billed
 * net of supplier credits. Returns the unknown line id when a line is not on the order.
 */
export const matchBill = (
  requestedLines: ReadonlyArray<RequestedBillLine>,
  orderLines: ReadonlyArray<MatchingLine>,
  billed: ReadonlyMap<string, bigint>,
  credited: ReadonlyMap<string, bigint>,
): BillMatch | { readonly unknownLineId: string } => {
  const byLine = new Map(orderLines.map((line) => [line.purchaseOrderLineId, line]))

  const match = {
    matched: new Array<BillMatch["matched"][number]>(),
    excessValue: 0n,
    excess: new Array<BillMatch["excess"][number]>(),
  }

  for (const requested of requestedLines) {
    const line = byLine.get(requested.purchaseOrderLineId)

    if (line === undefined) return { unknownLineId: requested.purchaseOrderLineId }

    const netBilled =
      (billed.get(line.purchaseOrderLineId) ?? 0n) - (credited.get(line.purchaseOrderLineId) ?? 0n)

    const billable = BigInt(line.received) - BigInt(line.returned) - netBilled
    const quantity = BigInt(requested.quantity)
    const matched = quantity < billable ? quantity : billable > 0n ? billable : 0n

    if (quantity > matched) {
      match.excess.push({ lineId: line.purchaseOrderLineId, billable, requested: quantity })
      match.excessValue += (quantity - matched) * minor(requested.unitPrice)
    }

    match.matched.push({ line, requested, matchedValue: matched * minor(line.unitPrice) })
  }

  return match
}

/** The matched value of `units` of a line's `total` units, rounded half up to the cent. */
const cumulativeShare = (matched: bigint, units: bigint, total: bigint) =>
  (matched * units * 2n + total) / (total * 2n)

/**
 * The part of a bill line's matched value a credit of `quantity` units returns. The value returned
 * after k credited units is the line's matched value for those k units rounded once, so the shares
 * of any split sum to the value of the units credited, none is negative, and the last units take
 * what is left. Rounding each share on its own could make the last one negative.
 */
export const creditShare = (
  line: BillingDocument["lines"][number],
  quantity: bigint,
  credited: ReadonlyMap<string, bigint>,
  creditedMatched: ReadonlyMap<string, bigint>,
) => {
  const matched = minor(line.matchedValue)
  const total = BigInt(line.quantity)
  const done = credited.get(line.id) ?? 0n
  const returned = creditedMatched.get(line.id) ?? 0n

  if (done + quantity === total) return matched - returned

  // A line credited before this rule may already have returned more than the cumulative value.
  const share = cumulativeShare(matched, done + quantity, total) - returned

  return share > 0n ? share : 0n
}
