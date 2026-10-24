import type { PartyDirectoryEntry } from "./contracts/generated/party.ts"

/** Names resolved from the party directory; an unresolved id falls back to the identifier. */
export interface Names {
  readonly parties: ReadonlyMap<string, string>
  readonly legalEntities: ReadonlyMap<string, string>
}

export const namesFrom = (entries: readonly PartyDirectoryEntry[]): Names => ({
  parties: new Map(entries.map((entry) => [entry.party.id, entry.party.name])),
  legalEntities: new Map(
    entries.flatMap((entry) =>
      entry.legalEntityId === null ? [] : [[entry.legalEntityId, entry.party.name] as const],
    ),
  ),
})
