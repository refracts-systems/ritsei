import * as Data from "effect/Data"

import {
  formatSignedMinor,
  requireExactMajorToMinor,
} from "../../../../framework/foundation/mod.ts"
import { type TaxCode, type TaxCodeRate, type TaxComputation, taxOn } from "./contract.ts"

/**
 * Pure tax decisions (TAX-CALC-2, TAX-RATE-1). A service reads the codes and rate periods, asks
 * here what to charge or whether a period may be added, and the memory store and the Alchemy model
 * (`domain-model.ts`) call the same functions, so they cannot disagree.
 */

const minor = (value: string) => requireExactMajorToMinor(value, 2)
const major = (value: bigint) => formatSignedMinor(value, 2)

/** A code can tax a transaction only when it is active and of the transaction's direction. */
export const isUsableFor = (
  code: Pick<TaxCode, "active" | "direction">,
  direction: TaxCode["direction"],
): boolean => code.active && code.direction === direction

/**
 * The rate in force on `date`: the latest period starting on or before it. Before the first
 * period, or without a date (Tax never defaults to today), the code charges its own rate.
 */
export const rateInForce = (
  ownRate: string,
  periods: ReadonlyArray<Pick<TaxCodeRate, "effectiveFrom" | "rate">>,
  date: string | undefined,
): string => {
  if (date === undefined) {
    return ownRate
  }

  let latest: Pick<TaxCodeRate, "effectiveFrom" | "rate"> | undefined

  for (const period of periods) {
    if (
      period.effectiveFrom <= date &&
      (latest === undefined || latest.effectiveFrom < period.effectiveFrom)
    ) {
      latest = period
    }
  }

  return latest?.rate ?? ownRate
}

export type RatePeriodDecision = Data.TaggedEnum<{
  Add: {}
  /** A period never changes: a second period on the same start date is refused, at any rate. */
  AlreadyExists: {}
}>

export const RatePeriodDecision = Data.taggedEnum<RatePeriodDecision>()

export const decideRatePeriod = (
  existingStarts: ReadonlyArray<string>,
  effectiveFrom: string,
): RatePeriodDecision =>
  existingStarts.includes(effectiveFrom)
    ? RatePeriodDecision.AlreadyExists()
    : RatePeriodDecision.Add()

type ChargingCode = Pick<TaxCode, "id" | "rate" | "direction" | "active">

type RatePeriod = Pick<TaxCodeRate, "taxCodeId" | "effectiveFrom" | "rate">

type Line = {
  readonly key: string
  readonly base: string
  readonly taxCodeId: string | null
}

/**
 * The first line, in line order, whose code does not exist, is inactive, or applies to the other
 * direction. A service asks this before it reads rate periods, so a refusal costs one read.
 */
export const firstUnusableCode = (
  codes: ReadonlyArray<Pick<TaxCode, "id" | "active" | "direction">>,
  direction: TaxCode["direction"],
  lines: ReadonlyArray<Pick<Line, "taxCodeId">>,
): string | undefined => {
  const byId = new Map(codes.map((code) => [code.id, code]))

  for (const line of lines) {
    if (line.taxCodeId === null) {
      continue
    }

    const code = byId.get(line.taxCodeId)

    if (code === undefined || !isUsableFor(code, direction)) {
      return line.taxCodeId
    }
  }

  return undefined
}

/**
 * Tax per line, rounded half up, then summed per code in order of first appearance, so document
 * totals equal line sums. A line without a code is untaxed. Every coded line must have its code in
 * `codes` (see {@link firstUnusableCode}); only periods starting on or before `date` count.
 */
export const computeTaxLines = (input: {
  readonly date: string | undefined
  readonly codes: ReadonlyArray<ChargingCode>
  readonly periods: ReadonlyArray<RatePeriod>
  readonly lines: ReadonlyArray<Line>
}): TaxComputation => {
  const codes = new Map(input.codes.map((code) => [code.id, code]))
  const summary = new Map<string, { base: bigint; tax: bigint }>()
  let totalTax = 0n

  const lines = input.lines.map((line) => {
    if (line.taxCodeId === null) {
      return { key: line.key, taxCodeId: null, rate: "0.0000", base: line.base, tax: "0.00" }
    }

    const code = codes.get(line.taxCodeId)!

    const rate = rateInForce(
      code.rate,
      input.periods.filter((period) => period.taxCodeId === code.id),
      input.date,
    )

    const tax = taxOn(line.base, rate)
    const current = summary.get(code.id) ?? { base: 0n, tax: 0n }
    summary.set(code.id, { base: current.base + minor(line.base), tax: current.tax + minor(tax) })
    totalTax += minor(tax)

    return { key: line.key, taxCodeId: code.id, rate, base: line.base, tax }
  })

  return {
    lines,
    summary: [...summary].map(([taxCodeId, amounts]) => ({
      taxCodeId,
      base: major(amounts.base),
      tax: major(amounts.tax),
    })),
    totalTax: major(totalTax),
  }
}

export type TaxComputationDecision = Data.TaggedEnum<{
  Computed: { readonly computation: TaxComputation }
  /** The code does not exist, is inactive, or applies to the other direction. */
  UnusableCode: { readonly taxCodeId: string }
}>

export const TaxComputationDecision = Data.taggedEnum<TaxComputationDecision>()

/** Refuses the whole computation at the first unusable code; otherwise computes it. */
export const decideTaxComputation = (input: {
  readonly direction: TaxCode["direction"]
  readonly date: string | undefined
  readonly codes: ReadonlyArray<ChargingCode>
  readonly periods: ReadonlyArray<RatePeriod>
  readonly lines: ReadonlyArray<Line>
}): TaxComputationDecision => {
  const unusable = firstUnusableCode(input.codes, input.direction, input.lines)

  return unusable === undefined
    ? TaxComputationDecision.Computed({ computation: computeTaxLines(input) })
    : TaxComputationDecision.UnusableCode({ taxCodeId: unusable })
}
