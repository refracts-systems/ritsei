import { For, Show } from "solid-js"
import { layout } from "../ui/foundations/layout.ts"
import { FormField } from "../ui/primitives/form-field.tsx"
import { Input } from "../ui/primitives/input.tsx"
import { Select } from "../ui/primitives/select.tsx"
import {
  type CustomFieldDefinition,
  type CustomFieldValues,
  displayValue,
  fieldValue,
  listOptions,
} from "./custom-field-values.ts"

export function CustomFieldInput(props: {
  definition: CustomFieldDefinition
  value: string
  disabled?: boolean
}) {
  const name = () => `field-${props.definition.key}`
  const options = () => listOptions(props.definition)

  return (
    <FormField
      label={props.definition.label}
      required={props.definition.required}
      helperText={props.definition.kind === "number" ? "A number such as 12.5" : undefined}
    >
      {(fieldProps) => (
        <Show
          when={options()}
          fallback={
            <Input
              {...fieldProps}
              name={name()}
              aria-required={props.definition.required ? "true" : undefined}
              disabled={props.disabled}
              type={props.definition.kind === "date" ? "date" : "text"}
              inputmode={props.definition.kind === "number" ? "decimal" : undefined}
              autocomplete="off"
              defaultValue={props.value}
            />
          }
        >
          {(list) => (
            <Select
              {...fieldProps}
              name={name()}
              aria-required={props.definition.required ? "true" : undefined}
              disabled={props.disabled}
              placeholder="Not set"
              options={list()}
              defaultValue={props.value}
            />
          )}
        </Show>
      )}
    </FormField>
  )
}

export function CustomFieldList(props: {
  definitions: readonly CustomFieldDefinition[]
  values: CustomFieldValues
}) {
  return (
    <dl class={layout.detailList}>
      <For each={props.definitions}>
        {(definition) => (
          <div class={layout.detailItem}>
            <dt class={layout.detailTerm}>{definition.label}</dt>
            <dd class={layout.detailValue}>
              {displayValue(fieldValue(props.values, definition.key))}
            </dd>
          </div>
        )}
      </For>
    </dl>
  )
}
