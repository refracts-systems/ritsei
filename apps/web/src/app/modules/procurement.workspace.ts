import type { ModuleWorkspace } from "../workspace.ts"

export const workspace = {
  label: "Supply",
  description: "Suppliers and purchase orders.",
  icon: "navigation.procurement",
  order: 20,
} as const satisfies ModuleWorkspace
