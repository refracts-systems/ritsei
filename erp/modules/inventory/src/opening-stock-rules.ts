import * as Data from "effect/Data"

import { requireExactMajorToMinor } from "../../../../framework/foundation/mod.ts"

/**
 * Pure opening stock decisions (INV-OPEN-2, INV-OPEN-3). The service asks here whether a load
 * bundle may be loaded, and maps the answer to its tagged errors, so the Alchemy `OpeningLoad`
 * aggregate and the service cannot disagree about what a load carries.
 */

export type OpeningLine = {
  readonly itemId: string
  readonly tracking: "none" | "lot" | "expiry"
  /** The line names its lots or serials (ADR-0131), so tracked stock can be carried. */
  readonly identified?: boolean
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
 * The first source position the load does not carry: tracked stock without its lots or serials,
 * reservations, goods in transit. The load is on-hand stock only, and a position it cannot carry is rejected, never
 * dropped (ADR-0118).
 */
export const firstUncarried = (lines: ReadonlyArray<OpeningLine>): OpeningRejection | undefined => {
  for (const line of lines) {
    if (line.tracking !== "none" && line.identified !== true) {
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

/**
 * The instance key of an opening load (INV-OPEN-4): one approved bundle per tenant and `openingId`.
 * An Alchemy instance key only; table rows keep their UUIDv7 ids. The service finds a recorded load
 * by the same pair (`tenantId`, `openingId`), so the key never needs a value that changes.
 */
export const openingLoadKey = (tenantId: string, openingId: string) => `${tenantId}/${openingId}`

/** An item's quantity and values in minor units, as a load carries them. */
export type OpeningValues = {
  readonly itemId: string
  readonly quantity: bigint
  readonly sourceValue: bigint
  readonly value: bigint
}

/** A load as the bundle compares it: where, as of when, and what. */
export type OpeningBundle = {
  readonly warehouseId: string
  readonly cutoffDate: string
  readonly rows: ReadonlyArray<OpeningValues>
}

/**
 * The rows a request loads, in item order. The value held is the moving-average value when the
 * line states one, else the source value.
 */
export const requestedOpeningRows = (
  lines: ReadonlyArray<{
    readonly itemId: string
    readonly quantity: string
    readonly sourceValue: string
    readonly movingAverageValue?: string
  }>,
): ReadonlyArray<OpeningValues> =>
  lines
    .map((line) => {
      const sourceValue = requireExactMajorToMinor(line.sourceValue, 2)

      return {
        itemId: line.itemId,
        quantity: BigInt(line.quantity),
        sourceValue,
        value:
          line.movingAverageValue === undefined
            ? sourceValue
            : requireExactMajorToMinor(line.movingAverageValue, 2),
      }
    })
    .toSorted((left, right) => left.itemId.localeCompare(right.itemId))

/**
 * A recorded load repeats the request when the warehouse, the cutoff date, and every item,
 * quantity, and value agree (INV-OPEN-4). Anything else is `OpeningStockConflict`.
 */
export const sameOpeningBundle = (recorded: OpeningBundle, requested: OpeningBundle) => {
  const byItem = new Map(recorded.rows.map((row) => [row.itemId.toLowerCase(), row]))

  return (
    recorded.warehouseId === requested.warehouseId &&
    recorded.cutoffDate === requested.cutoffDate &&
    recorded.rows.length === requested.rows.length &&
    requested.rows.every((row) => {
      const found = byItem.get(row.itemId.toLowerCase())

      return (
        found !== undefined &&
        found.quantity === row.quantity &&
        found.sourceValue === row.sourceValue &&
        found.value === row.value
      )
    })
  )
}
