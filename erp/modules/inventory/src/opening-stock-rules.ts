import * as Data from "effect/Data"

/**
 * Pure opening stock decisions (INV-OPEN-2, INV-OPEN-3). The service asks here whether a load
 * bundle may be loaded, and maps the answer to its tagged errors, so the Alchemy `OpeningLoad`
 * aggregate and the service cannot disagree about what a load carries.
 */

export type OpeningLine = {
  readonly itemId: string
  readonly tracking: "none" | "lot" | "expiry"
  readonly reservedQuantity: string
  readonly inTransitQuantity: string
}

export type OpeningRejection = Data.TaggedEnum<{
  LotTrackingUnsupported: { readonly itemId: string; readonly tracking: "lot" | "expiry" }
  ReservationsNotCarried: { readonly itemId: string; readonly reserved: string }
  InTransitNotCarried: { readonly itemId: string; readonly inTransit: string }
}>

export const OpeningRejection = Data.taggedEnum<OpeningRejection>()

/**
 * The first source position the load does not carry: tracked batches, reservations, goods in
 * transit. The load is on-hand stock only, and a position it cannot carry is rejected, never
 * dropped (ADR-0118).
 */
export const firstUncarried = (lines: ReadonlyArray<OpeningLine>): OpeningRejection | undefined => {
  for (const line of lines) {
    if (line.tracking !== "none") {
      return OpeningRejection.LotTrackingUnsupported({
        itemId: line.itemId,
        tracking: line.tracking,
      })
    }

    if (line.reservedQuantity !== "0") {
      return OpeningRejection.ReservationsNotCarried({
        itemId: line.itemId,
        reserved: line.reservedQuantity,
      })
    }

    if (line.inTransitQuantity !== "0") {
      return OpeningRejection.InTransitNotCarried({
        itemId: line.itemId,
        inTransit: line.inTransitQuantity,
      })
    }
  }

  return undefined
}

/**
 * The revaluation approval is present exactly when a line states a moving-average value: a revalued
 * line needs it, and nothing else may carry it.
 */
export const revaluationApproved = (
  hasApproval: boolean,
  lines: ReadonlyArray<{ readonly movingAverageValue?: unknown }>,
) => hasApproval === lines.some((line) => line.movingAverageValue !== undefined)
