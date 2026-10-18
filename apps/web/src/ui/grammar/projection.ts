import type { VisualArchetype } from "./archetypes.ts"
import { deterministicSeed } from "./deterministic-variation.ts"
import type { CartographicPrimitive } from "./primitives.ts"
import type {
  VisualDensity,
  VisualDimension,
  VisualFallback,
  VisualIntent,
  VisualIntentStatus,
  VisualMarker,
  VisualMaterial,
  VisualMotionPolicy,
  VisualSemantics,
  VisualSurfaceLevel,
} from "./visual-intent.ts"

export interface VisualProjectionInput {
  readonly variationKey: string
  readonly archetypes: readonly [VisualArchetype, ...VisualArchetype[]]
  readonly primitives: readonly CartographicPrimitive[]
  readonly dimension: VisualDimension
  readonly value: number
  readonly semantics: VisualSemantics
  readonly fallback: VisualFallback
  readonly density?: VisualDensity
  readonly surface?: VisualSurfaceLevel
  readonly motion?: VisualMotionPolicy
  readonly status?: VisualIntentStatus
  readonly markers?: readonly VisualMarker[]
}

const clampUnit = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

const baseMaterial = (): VisualMaterial => ({
  density: 0,
  amplitude: 0,
  compression: 0,
  roughness: 0,
  continuity: 1,
  velocity: 0,
  depth: 0,
  blur: 0,
  fieldRadius: 0.5,
  contourCount: 0,
  mass: 0,
  level: 0,
  concentration: 0,
  boundarySoftness: 0,
  proximity: 0,
  pulse: 0,
})

export const materialForDimension = (
  dimension: VisualDimension,
  rawValue: number,
): VisualMaterial => {
  const value = clampUnit(rawValue)
  const material = baseMaterial()
  switch (dimension) {
    case "risk":
      return {
        ...material,
        density: value,
        compression: value,
        contourCount: value,
        roughness: value * 0.7,
        pulse: value > 0.7 ? value : 0,
      }
    case "capacity":
      return {
        ...material,
        density: value * 0.45,
        amplitude: value,
        depth: value,
        level: value,
        mass: value,
        contourCount: value * 0.55,
      }
    case "movement":
      return {
        ...material,
        density: value * 0.55,
        velocity: value,
        pulse: value,
        continuity: 0.65 + value * 0.35,
        contourCount: value * 0.35,
      }
    case "uncertainty":
      return {
        ...material,
        blur: value,
        boundarySoftness: value,
        fieldRadius: 0.5 + value * 0.5,
        continuity: 1 - value * 0.25,
      }
    case "discrepancy":
      return {
        ...material,
        roughness: value,
        continuity: 1 - value,
        compression: value * 0.6,
        pulse: value,
        contourCount: value * 0.7,
      }
    case "value":
      return {
        ...material,
        concentration: value,
        depth: value * 0.6,
        fieldRadius: 0.35 + value * 0.65,
        mass: value,
        density: value * 0.35,
      }
    case "relationship":
      return {
        ...material,
        proximity: value,
        density: 0.25 + value * 0.5,
        fieldRadius: 0.45 + value * 0.35,
        contourCount: value * 0.4,
      }
    case "progress":
      return {
        ...material,
        level: value,
        continuity: value,
        velocity: value * 0.5,
        pulse: value > 0.8 ? value : 0,
        contourCount: value * 0.3,
      }
  }
}

const normalizedMarker = (marker: VisualMarker): VisualMarker => ({
  ...marker,
  x: clampUnit(marker.x / 100) * 100,
  y: clampUnit(marker.y / 100) * 100,
})

export const projectVisualIntent = (input: VisualProjectionInput): VisualIntent => {
  if (input.archetypes.length === 0) {
    throw new TypeError("A visual projection requires at least one archetype")
  }
  if (input.primitives.length === 0) {
    throw new TypeError("A visual projection requires at least one primitive")
  }

  return {
    archetypes: input.archetypes,
    primitives: input.primitives,
    dimension: input.dimension,
    material: materialForDimension(input.dimension, input.value),
    density: input.density ?? "compact",
    surface: input.surface ?? "content",
    motion: input.motion ?? "static",
    status: input.status ?? "ready",
    semantics: input.semantics,
    fallback: input.fallback,
    variation: {
      seed: deterministicSeed([
        input.variationKey,
        input.dimension,
        input.density ?? "compact",
        input.surface ?? "content",
        input.status ?? "ready",
      ]),
    },
    markers: (input.markers ?? []).map(normalizedMarker),
  }
}
