const RATE_SCALE = 10_000_000_000n

/** Splits a decimal text with at most `places` decimals into scaled digits, keeping the sign. */
const scaled = (value: string, places: number) => {
  const negative = value.startsWith("-")
  const [whole = "0", fraction = ""] = value.replace(/^-/, "").split(".")
  const digits = BigInt(whole + fraction.padEnd(places, "0"))

  return negative ? -digits : digits
}

/**
 * An amount of the entity currency in the group currency: the amount times the rate, rounded half
 * away from zero to the cent (ADR-0130). Exact integer arithmetic, never floats.
 */
export const translateAmount = (amount: string, rate: string) => {
  const product = scaled(amount, 2) * scaled(rate, 10)
  const half = RATE_SCALE / 2n
  const rounded = (product < 0n ? product - half : product + half) / RATE_SCALE
  const negative = rounded < 0n
  const digits = (negative ? -rounded : rounded).toString().padStart(3, "0")

  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`
}

/** One legal entity's figures, in its own currency; a figure is null when its owner gave none. */
export type EntityFigures = {
  readonly legalEntityId: string
  /** The entity's base currency, or null when accounting is not configured for it. */
  readonly currency: string | null
  /** The rate to the group currency on the day, "1" for the group currency, null when none. */
  readonly rate: string | null
  readonly figures: Readonly<Record<string, string | null>>
}

export type ConsolidatedEntity = EntityFigures & {
  /** The same figures in the group currency; null where the figure or the rate is missing. */
  readonly translated: Readonly<Record<string, string | null>>
}

export type Consolidation = {
  readonly entities: ReadonlyArray<ConsolidatedEntity>
  /** The sum of the translated figures that exist, per figure. */
  readonly totals: Readonly<Record<string, string>>
  /** Per figure, whether every entity contributed; false means the total leaves someone out. */
  readonly complete: Readonly<Record<string, boolean>>
}

const sum = (values: ReadonlyArray<string>) => {
  const total = values.reduce((running, value) => running + scaled(value, 2), 0n)
  const negative = total < 0n
  const digits = (negative ? -total : total).toString().padStart(3, "0")

  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`
}

/** Translates every entity's figures at its own rate and totals them (ADR-0130). */
export const consolidate = (
  entities: ReadonlyArray<EntityFigures>,
  keys: ReadonlyArray<string>,
): Consolidation => {
  const translated = entities.map((entity): ConsolidatedEntity => ({
    ...entity,
    translated: Object.fromEntries(
      keys.map((key) => {
        const figure = entity.figures[key] ?? null

        return [
          key,
          figure === null || entity.rate === null ? null : translateAmount(figure, entity.rate),
        ]
      }),
    ),
  }))

  return {
    entities: translated,
    totals: Object.fromEntries(
      keys.map((key) => [key, sum(translated.flatMap((entity) => entity.translated[key] ?? []))]),
    ),
    complete: Object.fromEntries(
      keys.map((key) => [key, translated.every((entity) => entity.translated[key] !== null)]),
    ),
  }
}
