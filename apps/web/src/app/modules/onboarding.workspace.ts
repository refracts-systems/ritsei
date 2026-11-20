import type { ModuleWorkspace } from "../workspace.ts"

export const workspace = {
  label: "Data imports",
  description: "Check and import Party records from a CSV file.",
  icon: "action.upload",
  order: 61,
  group: "Administration",
  area: "Onboarding",
  section: "Data imports",
} as const satisfies ModuleWorkspace
