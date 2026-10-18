import "@phosphor-icons/web/duotone/style.css"
import "@phosphor-icons/web/fill/style.css"
import "@phosphor-icons/web/regular/style.css"
import { iconRegistry } from "../registry.ts"
import type { IconName } from "../registry.ts"
import type { IconVariant } from "../semantics.ts"

const variantClasses: Record<IconVariant, string> = {
  regular: "ph",
  fill: "ph-fill",
  duotone: "ph-duotone",
}

export const phosphorClass = (name: IconName, variant: IconVariant): string =>
  `${variantClasses[variant]} ph-${iconRegistry[name]}`
