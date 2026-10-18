import type { JSX } from "@solidjs/web"
import { omit } from "solid-js"
import { css } from "../generated/css/index.js"

export interface BadgeProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  readonly tone?: "neutral" | "success" | "warning" | "danger" | "info"
}

// Status is carried by the label text; tone adds a second channel (tint + dot), never the only one.
const styles = {
  base: css({
    display: "inline-flex",
    alignItems: "center",
    gap: "1.5",
    minHeight: "5",
    px: "2",
    borderRadius: "full",
    borderWidth: "1px",
    textStyle: "status",
    whiteSpace: "nowrap",
    verticalAlign: "middle",
    "&::before": {
      content: '""',
      width: "1.5",
      height: "1.5",
      flexShrink: "0",
      borderRadius: "full",
      bg: "[currentColor]",
    },
    "@media (forced-colors: active)": { borderColor: "[CanvasText]" },
  }),
  neutral: css({
    color: "status.neutral.fg",
    bg: "status.neutral.bg",
    borderColor: "status.neutral.border",
  }),
  success: css({
    color: "status.success.fg",
    bg: "status.success.bg",
    borderColor: "status.success.border",
  }),
  warning: css({
    color: "status.warning.fg",
    bg: "status.warning.bg",
    borderColor: "status.warning.border",
  }),
  danger: css({
    color: "status.danger.fg",
    bg: "status.danger.bg",
    borderColor: "status.danger.border",
  }),
  info: css({ color: "status.info.fg", bg: "status.info.bg", borderColor: "status.info.border" }),
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
