import type { JSX } from "@solidjs/web"
import { omit } from "solid-js"
import { type FieldProps, FieldShell } from "../internal/field-shell.tsx"
import { control } from "../recipes/control.ts"

type MoneyFieldProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "class" | "children"> &
  FieldProps

export function MoneyField(props: MoneyFieldProps) {
  const inputProps = omit(props, "class", "label", "error")

  return (
    <FieldShell label={props.label} error={props.error} id={props.id} class={props.class}>
      {(fieldProps) => (
        <input
          {...inputProps}
          {...fieldProps}
          type="text"
          inputmode="decimal"
          autocomplete="off"
          class={control({ kind: "input" })}
        />
      )}
    </FieldShell>
  )
}
