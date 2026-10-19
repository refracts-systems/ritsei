import type { ModuleWorkspace } from "../workspace.ts"

export const workspace = {
  label: "Tax",
  description: "Tax codes and rates for sales and purchases.",
  icon: "navigation.settings",
  order: 57,
  group: "Administration",
  area: "Tax",
  section: "Tax codes",
} as const satisfies ModuleWorkspace
