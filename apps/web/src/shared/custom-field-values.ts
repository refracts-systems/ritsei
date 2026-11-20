import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type { FormValue } from "../ui/primitives/form.tsx"
import { Uuid } from "./schemas.ts"

/** Browser view of the custom field contract released by document owners (ADR-0109). */
export const CustomFieldKind = Schema.Literals(["text", "number", "date", "boolean", "choice"])

export type CustomFieldKind = Schema.Schema.Type<typeof CustomFieldKind>

const CustomFieldKey = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]{0,39}$/))

export const CustomFieldDefinition = Schema.Struct({
  id: Uuid,
  key: CustomFieldKey,
  label: Schema.String,
  kind: CustomFieldKind,
  required: Schema.Boolean,
  choices: Schema.NullOr(Schema.Array(Schema.String)),
  position: Schema.Int,
})

export type CustomFieldDefinition = Schema.Schema.Type<typeof CustomFieldDefinition>

export const CustomFieldValues = Schema.Record(
  CustomFieldKey,
  Schema.NullOr(Schema.Union([Schema.String, Schema.Boolean])),
)

export type CustomFieldValues = Schema.Schema.Type<typeof CustomFieldValues>

export const fieldValue = (values: CustomFieldValues, key: string) =>
  Object.hasOwn(values, key) ? values[key] : undefined

/** A native text input removes line breaks from its initial value. */
const inputValue = (definition: CustomFieldDefinition, previous: string | boolean | null) => {
  const text = String(previous ?? "")

  return definition.kind === "text" ? text.replace(/[\r\n]/g, "") : text
}

/** Reads one submitted field as the value its kind carries; an empty field has no value. */
const submitted = (definition: CustomFieldDefinition, value: FormValue[string] | undefined) => {
  if (!Predicate.isString(value) || value.trim() === "") return null

  if (definition.kind === "boolean") return value === "true"

  return definition.kind === "number" ? value.trim() : value
}

/**
 * The values to send: only the fields whose submitted value differs from the current one, so an
 * edit never rewrites what the user did not touch. Fields are named field-<key>.
 */
export const valuesPayload = (
  value: FormValue,
  definitions: readonly CustomFieldDefinition[],
  current: CustomFieldValues,
) =>
  Object.fromEntries(
    definitions.flatMap((definition) => {
      const previous = fieldValue(current, definition.key) ?? null
      const field = value[`field-${definition.key}`]

      if (field === undefined || field === inputValue(definition, previous)) return []

      const next = submitted(definition, field)

      return next === previous ? [] : [[definition.key, next] as const]
    }),
  )

const yesNo = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
]

/** The choices a list-like field offers: yes or no, or its own choices; none for typed text. */
export const listOptions = (definition: CustomFieldDefinition) => {
  if (definition.kind === "boolean") return yesNo

  return definition.kind === "choice"
    ? (definition.choices ?? []).map((choice) => ({ value: choice, label: choice }))
    : undefined
}

const shownBooleans = new Map<string | boolean, string>([
  [true, "Yes"],
  [false, "No"],
])

/** A stored value as the user reads it. */
export const displayValue = (value: string | boolean | null | undefined) =>
  value === null || value === undefined ? "Not set" : (shownBooleans.get(value) ?? value)
