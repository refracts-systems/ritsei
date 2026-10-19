import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import type {
  DomainActionCatalogEntry,
  DomainEventCatalogEntry,
} from "../../../../framework/modules/module/mod.ts"

export type ProcessCatalogEntry = DomainActionCatalogEntry | DomainEventCatalogEntry

export const ProcessCatalogCapabilityKind = Schema.Literals(["DomainAction", "DomainEvent"])
const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export const ResolveProcessCatalogInput = Schema.Struct({
  kind: ProcessCatalogCapabilityKind,
  id: NonEmptyString,
  version: PositiveInt,
})
export type ResolveProcessCatalogInput = Schema.Schema.Type<typeof ResolveProcessCatalogInput>

export class ProcessCatalogConflict extends Schema.TaggedError<ProcessCatalogConflict>()(
  "ProcessCatalogConflict",
  {
    kind: ProcessCatalogCapabilityKind,
    id: NonEmptyString,
    version: PositiveInt,
  },
) {}

export type ProcessCatalogRegistry = {
  readonly entries: readonly ProcessCatalogEntry[]
  readonly resolveReleasedCapability: (
    input: ResolveProcessCatalogInput,
  ) => ProcessCatalogEntry | undefined
}

const entryKey = (entry: ProcessCatalogEntry): string =>
  `${entry.kind}:${entry.id}:${entry.version}`

const lookupKey = (input: ResolveProcessCatalogInput): string =>
  `${input.kind}:${input.id}:${input.version}`

export const makeProcessCatalogRegistry = (
  entries: readonly ProcessCatalogEntry[],
): Effect.Effect<ProcessCatalogRegistry, ProcessCatalogConflict> => {
  const byKey = new Map<string, ProcessCatalogEntry>()
  for (const entry of entries) {
    const key = entryKey(entry)
    if (byKey.has(key)) {
      return Effect.fail(
        new ProcessCatalogConflict({
          kind: entry.kind,
          id: entry.id,
          version: entry.version,
        }),
      )
    }
    byKey.set(key, entry)
  }

  return Effect.succeed({
    entries: [...entries],
    resolveReleasedCapability: (input) => {
      const entry = byKey.get(lookupKey(input))
      return entry?.stability === "PUBLIC" ? entry : undefined
    },
  })
}
