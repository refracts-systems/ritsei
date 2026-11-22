import * as Data from "effect/Data"

import {
  formatSignedMinor,
  requireExactMajorToMinor,
} from "../../../../framework/foundation/mod.ts"
import type { SalesQuotation } from "./documents-contract.ts"

/**
 * Pure quotation decisions (SAL-QUOT-1, SAL-QUOT-2). The document service reads what a decision
 * needs, asks here, and performs only the write the decision names.
 */

export const minor = (value: string) => requireExactMajorToMinor(value, 2)
export const major = (value: bigint) => formatSignedMinor(value, 2)
export const normalizeMoney = (value: string) => major(minor(value))

/** Discount `12.5` percent → 1250 basis points. */
export const basisPoints = (percent: string) => {
  const [whole = "0", fraction = ""] = percent.split(".")

  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2))
}

export const formatPercent = (points: bigint) =>
  `${points / 100n}.${(points % 100n).toString().padStart(2, "0")}`

/** Net unit price after a discount, rounded half up to the cent. */
export const discountedPrice = (listPrice: string, discountPercent: string) => {
  const numerator = minor(listPrice) * (10_000n - basisPoints(discountPercent))

  return major((numerator * 2n + 10_000n) / 20_000n)
}

export const lineTotal = (unitPrice: string, quantity: string) =>
  major(minor(unitPrice) * BigInt(quantity))

/** A quotation's total is derived from its line totals, never accepted as input. */
export const sumLineTotals = (lineTotals: ReadonlyArray<string>) =>
  major(lineTotals.reduce((sum, total) => sum + minor(total), 0n))

export type LinePricing = Data.TaggedEnum<{
  Priced: {
    readonly listPrice: string
    readonly discountPercent: string
    readonly unitPrice: string
    readonly taxCodeId: string | null
  }
  /** Neither an explicit list price nor a price on the customer's list. */
  PriceNotFound: {}
}>

export const LinePricing = Data.taggedEnum<LinePricing>()

/**
 * Prices one quotation line: an explicit list price wins over the customer's price list, and a
 * missing tax code (`undefined`, not `null`) takes the product's default from Tax.
 */
export const decideLinePricing = (
  line: {
    readonly listPrice?: string | undefined
    readonly discountPercent?: string | undefined
    readonly taxCodeId?: string | null | undefined
  },
  priceListPrice: string | undefined,
  defaultTaxCodeId: string | null | undefined,
): LinePricing => {
  const listPrice = line.listPrice ?? priceListPrice

  if (listPrice === undefined) return LinePricing.PriceNotFound()

  const discountPercent = line.discountPercent ?? "0"

  return LinePricing.Priced({
    listPrice: normalizeMoney(listPrice),
    discountPercent: formatPercent(basisPoints(discountPercent)),
    unitPrice: discountedPrice(listPrice, discountPercent),
    taxCodeId: line.taxCodeId === undefined ? (defaultTaxCodeId ?? null) : line.taxCodeId,
  })
}

export type QuotationTransition = Data.TaggedEnum<{
  /** The quotation is in the starting state: move it to the target. */
  Move: {}
  /** Already in the target state: return it unchanged, write nothing. */
  Unchanged: {}
  InvalidState: { readonly status: SalesQuotation["status"] }
}>

export const QuotationTransition = Data.taggedEnum<QuotationTransition>()

/** The target state is checked before the starting state, so a repeat is never an error. */
export const decideQuotationTransition = (
  status: SalesQuotation["status"],
  from: SalesQuotation["status"],
  to: SalesQuotation["status"],
): QuotationTransition => {
  if (status === to) return QuotationTransition.Unchanged()

  return status === from ? QuotationTransition.Move() : QuotationTransition.InvalidState({ status })
}
