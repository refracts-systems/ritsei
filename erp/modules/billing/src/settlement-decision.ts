import * as Data from "effect/Data"

/**
 * The pure settlement decision (BIL-SET-1), in minor units. `settle` loads the locked document and
 * any earlier settlement of the same source, asks here, and performs only the write the decision
 * names, so the service and the Alchemy aggregate cannot disagree about what a settlement may do.
 */
export type SettlementDecision = Data.TaggedEnum<{
  /** Lower the open amount to `openAfter` and record the source. */
  Apply: { readonly openAfter: bigint }
  /** The same source was applied before with the same amount: return the document unchanged. */
  Replay: {}
  /** The same source was applied before with a different amount. */
  Conflict: {}
  ExceedsOpenAmount: {}
}>

export const SettlementDecision = Data.taggedEnum<SettlementDecision>()

export const decideSettlement = (input: {
  readonly open: bigint
  readonly amount: bigint
  /** The amount an earlier settlement of this source applied, or undefined for a new source. */
  readonly prior: bigint | undefined
}): SettlementDecision => {
  // A known source is judged before the open amount: a replay after the document is fully settled
  // must stay a no-op instead of exceeding it.
  if (input.prior !== undefined) {
    return input.prior === input.amount
      ? SettlementDecision.Replay()
      : SettlementDecision.Conflict()
  }

  return input.amount > input.open
    ? SettlementDecision.ExceedsOpenAmount()
    : SettlementDecision.Apply({ openAfter: input.open - input.amount })
}
