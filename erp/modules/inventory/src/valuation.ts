// Pure stock valuation (INV-VAL-1, INV-VAL-3): how an issue or receipt changes the moving-average
// value of one item. The service locks and writes; these functions only decide amounts.
import * as Data from "effect/Data"

/** Round `numerator / denominator` half up; both are non-negative. */
export const divideHalfUp = (numerator: bigint, denominator: bigint) =>
  (numerator * 2n + denominator) / (denominator * 2n)

/** A planned stock change: signed quantity, and for gains the value it adds. */
export type PlannedLine = {
  readonly itemId: string
  readonly quantity: bigint
  /** Receipts carry their value; issues and losses take the moving-average cost. */
  readonly receiptValue?: bigint
  /** An issue at a stated cost instead of the moving average. */
  readonly issueValue?: bigint
  /** Gains without a receipt value use the average cost, or this cost when nothing is valued. */
  readonly fallbackUnitCost?: bigint
}

export type ValuedLine = {
  readonly itemId: string
  readonly quantity: bigint
  readonly value: bigint
}

export type Balance = { readonly onHand: bigint; readonly reserved: bigint }

export type Valuation = { readonly quantity: bigint; readonly value: bigint }

export type LineValue = Data.TaggedEnum<{
  Valued: { readonly line: ValuedLine }
  Unavailable: {}
  Unvalued: {}
}>

export const LineValue = Data.taggedEnum<LineValue>()

/** An issue removes the moving-average cost, or its stated cost, from valued stock. */
export const valueIssue = (
  line: PlannedLine,
  balance: Balance,
  valuation: Valuation,
): LineValue => {
  const quantity = -line.quantity

  if (balance.onHand - balance.reserved < quantity) return LineValue.Unavailable()

  if (valuation.quantity < quantity) return LineValue.Unvalued()

  // The last units take the remaining value, so rounding or a stated cost never strands value.
  const cost =
    quantity === valuation.quantity
      ? valuation.value
      : (line.issueValue ?? divideHalfUp(valuation.value * quantity, valuation.quantity))

  if (cost > valuation.value) return LineValue.Unvalued()

  return LineValue.Valued({ line: { itemId: line.itemId, quantity: line.quantity, value: -cost } })
}

/** A receipt adds its value; a gain without one takes the average or the fallback cost. */
export const valueReceipt = (line: PlannedLine, valuation: Valuation): LineValue => {
  const value =
    line.receiptValue ??
    (valuation.quantity > 0n
      ? divideHalfUp(valuation.value * line.quantity, valuation.quantity)
      : line.fallbackUnitCost === undefined
        ? undefined
        : line.fallbackUnitCost * line.quantity)

  return value === undefined
    ? LineValue.Unvalued()
    : LineValue.Valued({ line: { itemId: line.itemId, quantity: line.quantity, value } })
}

export const valueLine = (line: PlannedLine, balance: Balance, valuation: Valuation) =>
  line.quantity < 0n ? valueIssue(line, balance, valuation) : valueReceipt(line, valuation)
