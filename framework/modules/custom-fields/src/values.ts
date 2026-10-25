import * as Predicate from "effect/Predicate"

import type { CustomFieldDefinition } from "./contract.ts"

const isCalendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

  const parsed = new Date(`${value}T00:00:00.000Z`)

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

type Kinds = Readonly<
  Record<
    CustomFieldDefinition["kind"],
    (value: string | boolean, definition: CustomFieldDefinition) => boolean
  >
>

const kinds: Kinds = {
  text: (value) => Predicate.isString(value) && /\S/.test(value) && value.length <= 500,
  number: (value) => Predicate.isString(value) && /^-?\d{1,18}(\.\d{1,6})?$/.test(value),
  date: (value) => Predicate.isString(value) && isCalendarDate(value),
  boolean: (value) => Predicate.isBoolean(value),
  choice: (value, definition) =>
    Predicate.isString(value) && (definition.choices ?? []).includes(value),
}

/** What a value of this field has to be, in words, or undefined when the value fits. */
export const mismatch = (
  definition: CustomFieldDefinition,
  value: string | boolean,
): string | undefined =>
  kinds[definition.kind](value, definition)
    ? undefined
    : {
        text: "non-empty text of at most 500 characters",
        number: "a number with at most six decimals",
        date: "a calendar date as YYYY-MM-DD",
        boolean: "true or false",
        choice: `one of ${(definition.choices ?? []).join(", ")}`,
      }[definition.kind]
