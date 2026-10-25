import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import {
  decodeInput,
  decodeResponse,
  mutationRequest,
  requestJson,
  routeWithId,
} from "../../shared/api.ts"
import { formText } from "../../shared/form-values.ts"
import { Uuid } from "../../shared/schemas.ts"
import type { FormValue } from "../../ui/primitives/form.tsx"

/** Browser view of the custom field contract of a Sales customer (ADR-0109). */
export const CustomFieldKind = Schema.Literals(["text", "number", "date", "boolean", "choice"])

export type CustomFieldKind = Schema.Schema.Type<typeof CustomFieldKind>

export const CustomFieldDefinition = Schema.Struct({
  id: Uuid,
  key: Schema.String,
  label: Schema.String,
  kind: CustomFieldKind,
  required: Schema.Boolean,
  choices: Schema.NullOr(Schema.Array(Schema.String)),
  position: Schema.Int,
})

export type CustomFieldDefinition = Schema.Schema.Type<typeof CustomFieldDefinition>

const DefinitionList = Schema.Array(CustomFieldDefinition).check(Schema.isMaxLength(200))

const Values = Schema.Record(
  Schema.String,
  Schema.NullOr(Schema.Union([Schema.String, Schema.Boolean])),
)

export type CustomFieldValues = Schema.Schema.Type<typeof Values>

const DefineInput = Schema.Struct({
  key: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]{0,39}$/)),
  label: Schema.String.check(Schema.isPattern(/\S/), Schema.isMaxLength(80)),
  kind: CustomFieldKind,
  required: Schema.optionalKey(Schema.Boolean),
  choices: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
})

const SetInput = Schema.Struct({ customerId: Uuid, values: Values })

export const listCustomerFields = Effect.fn("Frontend.Sales.listCustomerFields")(function* () {
  const body = yield* requestJson("/sales/custom-fields")

  return yield* decodeResponse(DefinitionList, body)
})

export const defineCustomerField = Effect.fn("Frontend.Sales.defineCustomerField")(function* (
  input: Schema.Codec.Encoded<typeof DefineInput>,
) {
  const decoded = yield* decodeInput(DefineInput, input)
  const body = yield* mutationRequest("/sales/custom-fields", decoded)

  return yield* decodeResponse(CustomFieldDefinition, body, "unknown-outcome")
})

export const getCustomerFieldValues = Effect.fn("Frontend.Sales.getCustomerFieldValues")(function* (
  customerId: string,
) {
  const decoded = yield* decodeInput(Uuid, customerId)
  const body = yield* requestJson(routeWithId("/sales/customers/:id/custom-fields", decoded))

  return yield* decodeResponse(Values, body)
})

export const setCustomerFieldValues = Effect.fn("Frontend.Sales.setCustomerFieldValues")(function* (
  input: Schema.Codec.Encoded<typeof SetInput>,
) {
  const decoded = yield* decodeInput(SetInput, input)

  const body = yield* mutationRequest(
    routeWithId("/sales/customers/:id/custom-fields", decoded.customerId),
    { values: decoded.values },
  )

  return yield* decodeResponse(Values, body, "unknown-outcome")
})

/** What the user is told for the business failures custom fields can return. */
export const customFieldFailureMessages = {
  CustomFieldAlreadyDefined: "A field with that key already exists on customers.",
  CustomFieldNotDefined: "This field is no longer defined. Reload the customer.",
  CustomFieldValueInvalid: "A value does not fit its field. Check the hints under each field.",
  CustomFieldRequired: "A required field is empty. Fill it in before saving.",
  CustomerNotFound: "This customer is no longer available. Reload the workspace.",
} as const

const keyPattern = /^[a-z][a-z0-9_]{0,39}$/

/**
 * The definition command from the fields key, label, kind, choices (separated by commas) and required.
 * Undefined when the key or label is malformed, or a choice field has no choices.
 */
export const definitionPayload = (value: FormValue) => {
  const key = formText(value.key)
  const label = formText(value.label)
  const kind = Schema.decodeUnknownOption(CustomFieldKind)(formText(value.kind))

  const choices = formText(value.choices)
    .split(",")
    .map((choice) => choice.trim())
    .filter((choice) => choice !== "")

  if (!keyPattern.test(key) || label === "" || Option.isNone(kind)) return undefined

  if (kind.value === "choice" && choices.length === 0) return undefined

  const base = { key, label, kind: kind.value }
  const withRequired = value.required === "true" ? { ...base, required: true } : base

  return kind.value === "choice" ? { ...withRequired, choices } : withRequired
}

/** Reads one submitted field as the value its kind carries; an empty field has no value. */
const submitted = (definition: CustomFieldDefinition, value: FormValue[string] | undefined) => {
  const text = formText(value)

  if (text === "") return null

  return definition.kind === "boolean" ? text === "true" : text
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
      const next = submitted(definition, value[`field-${definition.key}`])

      return next === (current[definition.key] ?? null) ? [] : [[definition.key, next] as const]
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
