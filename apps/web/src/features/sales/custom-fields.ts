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

import {
  CustomFieldDefinition,
  CustomFieldKind,
  CustomFieldValues,
} from "../../shared/custom-field-values.ts"

const DefinitionList = Schema.Array(CustomFieldDefinition).check(Schema.isMaxLength(200))

const DefineInput = Schema.Struct({
  key: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]{0,39}$/)),
  label: Schema.String.check(Schema.isPattern(/\S/), Schema.isMaxLength(80)),
  kind: CustomFieldKind,
  required: Schema.optionalKey(Schema.Boolean),
  choices: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
})

const SetInput = Schema.Struct({ customerId: Uuid, values: CustomFieldValues })

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

  return yield* decodeResponse(CustomFieldValues, body)
})

export const setCustomerFieldValues = Effect.fn("Frontend.Sales.setCustomerFieldValues")(function* (
  input: Schema.Codec.Encoded<typeof SetInput>,
) {
  const decoded = yield* decodeInput(SetInput, input)

  const body = yield* mutationRequest(
    routeWithId("/sales/customers/:id/custom-fields", decoded.customerId),
    { values: decoded.values },
  )

  return yield* decodeResponse(CustomFieldValues, body, "unknown-outcome")
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
