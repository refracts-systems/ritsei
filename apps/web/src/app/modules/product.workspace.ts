import type { ModuleWorkspace } from "../workspace.ts"

export const workspace = {
  label: "Products",
  description: "Goods and services shared by sales, purchasing, and inventory.",
  icon: "object.product",
  order: 55,
  group: "Administration",
  area: "Product",
  section: "Products",
} as const satisfies ModuleWorkspace
