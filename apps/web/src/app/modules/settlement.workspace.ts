import type { ModuleWorkspace } from "../workspace.ts"

export const workspace = {
  label: "Payments",
  description: "Payments received and made, aging, and customer statements.",
  icon: "object.payment",
  order: 37,
  group: "Operations",
  area: "Finance",
  section: "Payments",
} as const satisfies ModuleWorkspace
