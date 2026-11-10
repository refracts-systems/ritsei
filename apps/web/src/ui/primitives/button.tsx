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
  // A quick turn reads as a quick load. The label already says "Loading", so reduced motion
  // drops the spinner instead of slowing it.
  spinner: css({
    width: "3.5",
    height: "3.5",
    flexShrink: "0",
    borderRadius: "full",
    borderWidth: "2px",
    borderColor: "[currentColor]",
    borderRightColor: "transparent",
    animationName: "spin",
    animationDuration: "spin",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
    _motionReduce: { display: "none" },
  }),
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
      {props.loading ? (
        <>
          <span class={styles.spinner} aria-hidden="true" />
          Loading…
        </>
      ) : (
        props.children
      )}
    </button>
  )
}
