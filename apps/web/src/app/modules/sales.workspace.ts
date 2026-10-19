import type { ModuleWorkspace } from "../workspace.ts"

export const workspace = {
  label: "Revenue",
  description: "Customers, quotations, and sales orders.",
  icon: "navigation.sales",
  order: 10,
} as const satisfies ModuleWorkspace
