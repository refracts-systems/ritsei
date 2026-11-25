import type { PipelineStage } from "./contract.ts"

/** A document with the quantity of each of its lines that has moved on to the next document. */
export type StagedDocument = {
  readonly firstDate: string
  readonly lines: ReadonlyArray<{ readonly lineId: string; readonly quantity: string }>
}

/**
 * The documents that still have something to bill: any line whose quantity (delivered, or received
 * net of returns) exceeds what has been billed. A fully billed document has left the stage.
 */
export const unbilledStage = (
  documents: ReadonlyArray<StagedDocument>,
  billed: ReadonlyMap<string, bigint>,
): Pick<PipelineStage, "count" | "oldestDate"> => {
  const dates = documents
    .flatMap((document) =>
      document.lines.some((line) => BigInt(line.quantity) > (billed.get(line.lineId) ?? 0n))
        ? [document.firstDate]
        : [],
    )
    .toSorted()

  return { count: dates.length, oldestDate: dates[0] ?? null }
}
