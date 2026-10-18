import type { JSX } from "@solidjs/web"
import { For, omit } from "solid-js"
import { type FieldProps, FieldShell } from "../internal/field-shell.tsx"
import { control } from "../recipes/control.ts"

interface PartyOption {
  readonly value: string
  readonly label: string
  readonly disabled?: boolean
}

type PartyFieldProps = Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, "class" | "children"> &
  FieldProps & {
    readonly options: readonly PartyOption[]
    readonly placeholder?: string
  }

export function PartyField(props: PartyFieldProps) {
  const selectProps = omit(props, "class", "label", "error", "options", "placeholder")
  return (
    <FieldShell label={props.label} error={props.error} id={props.id} class={props.class}>
      {(fieldProps) => (
        <select {...selectProps} {...fieldProps} class={control({ kind: "input" })}>
          {props.placeholder === undefined ? null : <option value="">{props.placeholder}</option>}
          <For each={props.options}>
            {(option) => (
              <option value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            )}
          </For>
        </select>
      )}
    </FieldShell>
  )
}
