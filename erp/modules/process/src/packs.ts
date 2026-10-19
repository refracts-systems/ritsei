import * as Schema from "effect/Schema"

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export const ProcessPackStability = Schema.Literals([
  "PRIVATE",
  "EXPERIMENTAL",
  "PUBLIC",
  "DEPRECATED",
  "RETIRED",
])
export type ProcessPackStability = Schema.Schema.Type<typeof ProcessPackStability>

export const ProcessPackCapabilityReference = Schema.Struct({
  kind: Schema.Literals(["DomainAction", "DomainEvent"]),
  id: NonEmptyString,
  version: PositiveInt,
})
export type ProcessPackCapabilityReference = Schema.Schema.Type<
  typeof ProcessPackCapabilityReference
>

export const ProcessPackAsset = Schema.Struct({
  id: NonEmptyString,
  version: PositiveInt,
  title: NonEmptyString,
  description: NonEmptyString,
})
export type ProcessPackAsset = Schema.Schema.Type<typeof ProcessPackAsset>

const Assets = Schema.Array(ProcessPackAsset)

export const ProcessPack = Schema.Struct({
  id: NonEmptyString,
  version: PositiveInt,
  stability: ProcessPackStability,
  profileId: NonEmptyString,
  name: NonEmptyString,
  description: NonEmptyString,
  processTemplateIds: Schema.Array(NonEmptyString).check(Schema.isMinLength(1)),
  requiredCapabilities: Schema.Array(ProcessPackCapabilityReference),
  optionalCapabilities: Schema.Array(ProcessPackCapabilityReference),
  decisions: Assets,
  forms: Assets,
  configuration: Assets,
  recommendedPolicies: Assets,
  projections: Assets,
  documentation: Assets,
})
export type ProcessPack = Schema.Schema.Type<typeof ProcessPack>

export const ProcessPackCapabilityResolution = Schema.Struct({
  packId: NonEmptyString,
  packVersion: PositiveInt,
  status: Schema.Literals(["ready", "missing_required_capabilities"]),
  missingRequiredCapabilities: Schema.Array(ProcessPackCapabilityReference),
})
export type ProcessPackCapabilityResolution = Schema.Schema.Type<
  typeof ProcessPackCapabilityResolution
>

const sameReference = (
  left: ProcessPackCapabilityReference,
  right: ProcessPackCapabilityReference,
): boolean => left.kind === right.kind && left.id === right.id && left.version === right.version

export const resolveProcessPackCapabilities = (
  pack: ProcessPack,
  available: readonly ProcessPackCapabilityReference[],
): ProcessPackCapabilityResolution => {
  const missingRequiredCapabilities = pack.requiredCapabilities.filter(
    (required) => !available.some((candidate) => sameReference(required, candidate)),
  )
  return {
    packId: pack.id,
    packVersion: pack.version,
    status: missingRequiredCapabilities.length === 0 ? "ready" : "missing_required_capabilities",
    missingRequiredCapabilities,
  }
}
