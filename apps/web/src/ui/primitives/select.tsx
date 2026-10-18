import type { JSX } from "@solidjs/web"
import { omit } from "solid-js"
import { control } from "../recipes/control.ts"

export interface SelectOption {
  readonly value: string
  readonly label: string
  readonly disabled?: boolean
}

export type SelectProps =
  & Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, "class" | "children">
  & {
    readonly options: readonly SelectOption[]
    readonly placeholder?: string
    readonly class?: JSX.ClassValue
  }

export function Select(props: SelectProps) {
  return (
    <select
      {...omit(props, "options", "placeholder", "class")}
      class={[control({ kind: "input" }), props.class]}
    >
      {props.placeholder && <option value="">{props.placeholder}</option>}
      {props.options.map((option) => (
        <option value={option.value} disabled={option.disabled}>{option.label}</option>
      ))}
    </select>
  )
}
