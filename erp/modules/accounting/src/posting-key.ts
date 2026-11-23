import { requireExactMajorToMinor } from "../../../../framework/foundation/mod.ts"

const lineKey = (line: { accountId: string; debit: string; credit: string }) =>
  `${line.accountId}:${requireExactMajorToMinor(line.debit, 2)}:${requireExactMajorToMinor(line.credit, 2)}`

export type Posting = {
  readonly legalEntityId: string
  readonly postingDate: string
  readonly sourceType: string | null
  readonly sourceId: string | null
}

/**
 * What a retried posting must repeat: legal entity, date, source, and lines (ACC-OPEN-1). The
 * ledger store and the Alchemy `Journal` model both decide a repeat with this key, so a repeat is
 * the posted entry and anything else is `JournalIdempotencyConflict`.
 */
export const postingKey = (
  posting: Posting,
  lines: ReadonlyArray<{ accountId: string; debit: string; credit: string }>,
) =>
  JSON.stringify([
    posting.legalEntityId,
    posting.postingDate,
    posting.sourceType,
    posting.sourceId,
    lines.map(lineKey).toSorted(),
  ])
