import { stableUnit } from "../../grammar/deterministic-variation.ts"
import type { VisualIntent } from "../../grammar/visual-intent.ts"

export const cartographyViewBox = {
  width: 320,
  height: 160,
} as const

const hasPrimitive = (intent: VisualIntent, primitive: VisualIntent["primitives"][number]) =>
  intent.primitives.includes(primitive)

const format = (value: number): string => value.toFixed(2)

export const buildContourPaths = (intent: VisualIntent): readonly string[] => {
  if (
    !hasPrimitive(intent, "contour") &&
    !hasPrimitive(intent, "density") &&
    !hasPrimitive(intent, "elevation") &&
    !hasPrimitive(intent, "field")
  )
    return []

  const count = Math.max(2, Math.min(8, Math.round(2 + intent.material.contourCount * 6)))
  const spacing = cartographyViewBox.height / (count + 1)
  const amplitude = 3 + intent.material.amplitude * 9 + intent.material.roughness * 5
  return Array.from({ length: count }, (_, index) => {
    const y = spacing * (index + 1)
    const phase = stableUnit(intent.variation.seed, index + 1) * Math.PI * 2
    const first = y + Math.sin(phase) * amplitude
    const second = y + Math.sin(phase + 1.6) * amplitude
    const third = y + Math.sin(phase + 3.2) * amplitude
    return [
      `M 0 ${format(first)}`,
      `C 64 ${format(y - amplitude)} 96 ${format(y + amplitude)} 160 ${format(second)}`,
      `S 256 ${format(y - amplitude)} 320 ${format(third)}`,
    ].join(" ")
  })
}

export const buildRoutePath = (intent: VisualIntent): string | undefined => {
  if (!hasPrimitive(intent, "route") && !intent.archetypes.includes("flow")) return undefined
  const offset = (stableUnit(intent.variation.seed, 21) - 0.5) * 16
  const velocity = intent.material.velocity * 18
  return [
    `M 16 ${format(128 + offset)}`,
    `C 76 ${format(124 - velocity)} 112 ${format(56 + offset)} 170 ${format(80 - velocity)}`,
    `S 250 ${format(38 + offset)} 304 ${format(32 + velocity)}`,
  ].join(" ")
}

export const buildBoundaryPath = (intent: VisualIntent): string | undefined => {
  if (!hasPrimitive(intent, "boundary") && !hasPrimitive(intent, "region")) return undefined
  const softness = intent.material.boundarySoftness * 8
  return [
    `M ${format(18 + softness)} 24`,
    `Q 160 ${format(8 - softness)} ${format(302 - softness)} 24`,
    `L ${format(286 - softness)} ${format(136 + softness)}`,
    `Q 160 ${format(150 + softness)} ${format(34 + softness)} ${format(136 + softness)}`,
    "Z",
  ].join(" ")
}

export const buildPulseRadius = (intent: VisualIntent): number => 4 + intent.material.pulse * 12
