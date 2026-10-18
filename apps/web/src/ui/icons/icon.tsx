import { css } from "../generated/css/index.js"
import { phosphorSymbolHref } from "./providers/phosphor.ts"
import type { IconName } from "./registry.ts"
import { defaultIconVariant, type IconSize, type IconTone, type IconVariant } from "./semantics.ts"

const sizeStyles: Record<IconSize, string> = {
  xs: css({
    display: "inline-block",
    flexShrink: "0",
    verticalAlign: "middle",
    width: "iconXs",
    height: "iconXs",
    fontSize: "iconXs",
    lineHeight: "none",
  }),
  sm: css({
    display: "inline-block",
    flexShrink: "0",
    verticalAlign: "middle",
    width: "iconSm",
    height: "iconSm",
    fontSize: "iconSm",
    lineHeight: "none",
  }),
  md: css({
    display: "inline-block",
    flexShrink: "0",
    verticalAlign: "middle",
    width: "iconMd",
    height: "iconMd",
    fontSize: "iconMd",
    lineHeight: "none",
  }),
  lg: css({
    display: "inline-block",
    flexShrink: "0",
    verticalAlign: "middle",
    width: "iconLg",
    height: "iconLg",
    fontSize: "iconLg",
    lineHeight: "none",
  }),
  xl: css({
    display: "inline-block",
    flexShrink: "0",
    verticalAlign: "middle",
    width: "iconXl",
    height: "iconXl",
    fontSize: "iconXl",
    lineHeight: "none",
  }),
  display: css({
    display: "inline-block",
    flexShrink: "0",
    verticalAlign: "middle",
    width: "iconDisplay",
    height: "iconDisplay",
    fontSize: "iconDisplay",
    lineHeight: "none",
  }),
}

const toneStyles: Record<IconTone, string> = {
  default: "",
  muted: css({ color: "icon.muted" }),
  subtle: css({ color: "icon.subtle" }),
  success: css({ color: "icon.success" }),
  warning: css({ color: "icon.warning" }),
  danger: css({ color: "icon.danger" }),
  info: css({ color: "icon.info" }),
  disabled: css({ color: "icon.disabled" }),
  inverse: css({ color: "icon.inverse" }),
}

export type IconProps = {
  name: IconName
  size?: IconSize
  tone?: IconTone
  variant?: IconVariant
  label?: string
  class?: string
  id?: string
  title?: string
}

export function Icon(props: IconProps) {
  const variant = () => props.variant ?? defaultIconVariant(props.name)
  const size = () => props.size ?? "md"
  const tone = () => props.tone ?? "default"
  const className = () =>
    [sizeStyles[size()], toneStyles[tone()], props.class].filter(Boolean).join(" ")

  return (
    <svg
      id={props.id}
      class={className()}
      fill="currentColor"
      viewBox="0 0 1024 1024"
      role={props.label ? "img" : undefined}
      aria-hidden={props.label ? undefined : "true"}
      aria-label={props.label}
    >
      {props.title && <title>{props.title}</title>}
      <use href={phosphorSymbolHref(props.name, variant())} />
    </svg>
  )
}
