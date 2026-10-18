import type { JSX } from "@solidjs/web"
import { omit } from "solid-js"
import { css } from "../generated/css/index.js"

export interface BadgeProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  readonly tone?: "neutral" | "success" | "warning" | "danger" | "info"
}

const styles = {
  base: css({
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "full",
    px: "2",
    py: "1",
    textStyle: "status",
    borderWidth: "1px",
    borderColor: "boundary",
  }),
  neutral: css({ color: "muted" }),
  success: css({ color: "icon.success" }),
  warning: css({ color: "icon.warning" }),
  danger: css({ color: "danger" }),
  info: css({ color: "icon.info" }),
}

export function Badge(props: BadgeProps) {
  return (
    <span
      {...omit(props, "tone", "class", "children")}
      class={[styles.base, styles[props.tone ?? "neutral"], props.class]}
    >
      {props.children}
    </span>
  )
}
