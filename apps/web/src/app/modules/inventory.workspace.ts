import type { ModuleWorkspace } from "../workspace.ts"

export const workspace = {
  label: "Inventory",
  description: "Items, warehouses, stock, and reservations.",
  icon: "navigation.inventory",
  order: 30,
  group: "Operations",
  area: "Inventory",
  section: "Overview",
} as const satisfies ModuleWorkspace
