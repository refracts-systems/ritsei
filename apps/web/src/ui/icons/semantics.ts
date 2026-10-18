const iconSizes = ["xs", "sm", "md", "lg", "xl", "display"] as const

export type IconSize = (typeof iconSizes)[number]

const iconVariants = ["regular", "fill", "duotone"] as const

export type IconVariant = (typeof iconVariants)[number]

const iconTones = [
  "default",
  "muted",
  "subtle",
  "success",
  "warning",
  "danger",
  "info",
  "disabled",
  "inverse",
] as const

export type IconTone = (typeof iconTones)[number]

export const defaultIconVariant = (name: string): IconVariant =>
  name.startsWith("empty.") ? "duotone" : "regular"
