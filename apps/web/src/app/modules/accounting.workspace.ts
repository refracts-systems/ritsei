import type { ModuleWorkspace } from "../workspace.ts"

export const workspace = {
  label: "Finance",
  description: "Accounts, periods, and journal entries.",
  icon: "navigation.accounting",
  order: 40,
  group: "Operations",
  area: "Finance",
  section: "Accounting",
} as const satisfies ModuleWorkspace
