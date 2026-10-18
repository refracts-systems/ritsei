import type { JSX } from "@solidjs/web"
import { omit } from "solid-js"
import { css } from "../generated/css/index.js"
import { control } from "../recipes/control.ts"

type ButtonBaseProps = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "aria-label"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger"
  size?: "md" | "sm"
  loading?: boolean
  class?: JSX.ClassValue
}

export type ButtonProps = ButtonBaseProps &
  (
    | { iconOnly: true; "aria-label": string }
    | { iconOnly?: false | undefined; "aria-label"?: string }
  )

const kinds = {
  primary: "action",
  secondary: "secondary",
  ghost: "ghost",
  danger: "danger",
} as const

const styles = {
  loading: css({ cursor: "wait" }),
  iconOnly: css({ px: "0", minWidth: "9", "&.control--size_sm": { minWidth: "8" } }),
}

export function Button(props: ButtonProps) {
  const buttonProps = omit(props, "variant", "size", "loading", "iconOnly", "class", "children")
  return (
    <button
      {...buttonProps}
      aria-busy={props.loading ? "true" : undefined}
      disabled={props.disabled || props.loading}
      class={[
        control({ kind: kinds[props.variant ?? "secondary"], size: props.size ?? "md" }),
        props.loading && styles.loading,
        props.iconOnly && styles.iconOnly,
        props.class,
      ]}
    >
      {props.loading ? "Loading…" : props.children}
    </button>
  )
}
