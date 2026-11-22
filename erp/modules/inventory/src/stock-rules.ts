import * as Data from "effect/Data"

/**
 * Pure stock decisions (INV-STOCK-1, INV-STOCK-2, INV-STOCK-4, INV-STOCK-5). A store reads the
 * locked rows, asks here what to do, and performs only the write the decision names, so the memory
 * and PostgreSQL stores and the Alchemy `StockItem` aggregate cannot disagree about when stock
 * moves.
 */

export type Balance = { readonly onHand: bigint; readonly reserved: bigint }

/** Stock a reservation, a transfer, or an issue may still take; a missing balance has none. */
export const hasAvailableStock = (balance: Balance | undefined, quantity: bigint) =>
  balance !== undefined && balance.onHand - balance.reserved >= quantity

export type ReservationStatus = "active" | "released" | "fulfilled"

export type ReservationClose = "release" | "fulfill"

export type ReservationCloseDecision = Data.TaggedEnum<{
  /** The reservation is active: move its stock and record the new status. */
  Apply: {}
  /** Already in the target status: return it unchanged, move nothing. */
  Existing: {}
  InvalidState: { readonly status: ReservationStatus }
}>

export const ReservationCloseDecision = Data.taggedEnum<ReservationCloseDecision>()

/** A reservation is released or fulfilled exactly once; repeating the same close is a no-op. */
export const decideReservationClose = (
  status: ReservationStatus,
  operation: ReservationClose,
): ReservationCloseDecision => {
  if (status === (operation === "release" ? "released" : "fulfilled")) {
    return ReservationCloseDecision.Existing()
  }

  return status === "active"
    ? ReservationCloseDecision.Apply()
    : ReservationCloseDecision.InvalidState({ status })
}

/** A correction may remove stock down to the reserved quantity, never below it. */
export const correctionKeepsReservations = (balance: Balance | undefined, adjustment: bigint) =>
  (balance?.onHand ?? 0n) + adjustment >= (balance?.reserved ?? 0n)

/** A correction states the unit of measure of the item it corrects. */
export const unitOfMeasureMatches = (itemUnitOfMeasure: string, unitOfMeasure: string) =>
  itemUnitOfMeasure === unitOfMeasure

export type CorrectionDecision = Data.TaggedEnum<{
  Apply: {}
  UnitOfMeasureMismatch: { readonly expected: string; readonly actual: string }
  /** The correction would leave less stock than is reserved. */
  BelowReserved: {}
}>

export const CorrectionDecision = Data.taggedEnum<CorrectionDecision>()

export const decideCorrection = (
  item: { readonly unitOfMeasure: string },
  unitOfMeasure: string,
  balance: Balance | undefined,
  adjustment: bigint,
): CorrectionDecision =>
  !unitOfMeasureMatches(item.unitOfMeasure, unitOfMeasure)
    ? CorrectionDecision.UnitOfMeasureMismatch({
        expected: item.unitOfMeasure,
        actual: unitOfMeasure,
      })
    : correctionKeepsReservations(balance, adjustment)
      ? CorrectionDecision.Apply()
      : CorrectionDecision.BelowReserved()

/**
 * Whether stock the caller claims for a legal entity is stock of the warehouse's legal entity.
 * A call that names no legal entity makes no claim. A warehouse that cannot be read has no legal
 * entity, so a claim against it never holds.
 */
export const warehouseInLegalEntity = (
  warehouseLegalEntityId: string | undefined,
  claimedLegalEntityId: string | undefined,
) => claimedLegalEntityId === undefined || warehouseLegalEntityId === claimedLegalEntityId

/** A transfer never moves stock between legal entities. */
export const transferWithinLegalEntity = (
  sourceLegalEntityId: string,
  destinationLegalEntityId: string,
) => sourceLegalEntityId === destinationLegalEntityId

/**
 * One row of the movement log. Quantities are magnitudes except a correction, which is signed; a
 * reversal is a new movement (a release, or a correction of the opposite sign), so the log never
 * needs an update or a delete.
 */
export type BalanceMovement = Data.TaggedEnum<{
  Receipt: { readonly quantity: bigint }
  /** A stock correction; negative removes stock. */
  Correction: { readonly quantity: bigint }
  Reserve: { readonly quantity: bigint }
  Release: { readonly quantity: bigint }
  Fulfill: { readonly quantity: bigint }
}>

export const BalanceMovement = Data.taggedEnum<BalanceMovement>()

/** The balance after a movement: the balance is the fold of the movements over zero. */
export const applyBalanceMovement = (balance: Balance, movement: BalanceMovement): Balance =>
  BalanceMovement.$match(movement, {
    Receipt: ({ quantity }) => ({ ...balance, onHand: balance.onHand + quantity }),
    Correction: ({ quantity }) => ({ ...balance, onHand: balance.onHand + quantity }),
    Reserve: ({ quantity }) => ({ ...balance, reserved: balance.reserved + quantity }),
    Release: ({ quantity }) => ({ ...balance, reserved: balance.reserved - quantity }),
    Fulfill: ({ quantity }) => ({
      onHand: balance.onHand - quantity,
      reserved: balance.reserved - quantity,
    }),
  })
