import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  ProcessCatalogCapabilityKind,
  type ProcessCatalogRegistry,
  ResolveProcessCatalogInput,
} from "./catalog-registry.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export const ProcessReleaseRequest = Schema.Struct({
  definitionId: Uuid,
  definitionVersion: PositiveInt,
  catalogVersion: PositiveInt,
  references: Schema.Array(ResolveProcessCatalogInput),
})

export const ProcessReleaseValidation = Schema.Struct({
  status: Schema.Literals(["VALIDATED"]),
  definitionId: Uuid,
  definitionVersion: PositiveInt,
  catalogVersion: PositiveInt,
  references: Schema.Array(ResolveProcessCatalogInput),
})

export type ProcessReleaseRequest = Schema.Schema.Type<typeof ProcessReleaseRequest>
export type ProcessReleaseValidation = Schema.Schema.Type<typeof ProcessReleaseValidation>

export class ProcessReleaseValidationFailed
  extends Schema.TaggedError<ProcessReleaseValidationFailed>()(
    "ProcessReleaseValidationFailed",
    {
      definitionId: Uuid,
      kind: ProcessCatalogCapabilityKind,
      id: Schema.String.check(Schema.isPattern(/\S/)),
      version: PositiveInt,
    },
  )
{}

export const validateProcessRelease = (
  registry: ProcessCatalogRegistry,
  input: unknown,
): Effect.Effect<ProcessReleaseValidation, ProcessReleaseValidationFailed | Schema.SchemaError> =>
  Effect.gen(function*() {
    const decoded = yield* Schema.decodeUnknownEffect(ProcessReleaseRequest)(input)
    // An unregistered capability can never enter a released process.
    for (const reference of decoded.references) {
      const resolved = registry.resolveReleasedCapability(reference)
      if (resolved === undefined) {
        return yield* Effect.fail(
          new ProcessReleaseValidationFailed({
            definitionId: decoded.definitionId,
            kind: reference.kind,
            id: reference.id,
            version: reference.version,
          }),
        )
      }
    }
    return {
      status: "VALIDATED" as const,
      definitionId: decoded.definitionId,
      definitionVersion: decoded.definitionVersion,
      catalogVersion: decoded.catalogVersion,
      references: decoded.references,
    }
  })
