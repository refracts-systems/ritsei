import type { ModuleWorkspace } from "../workspace.ts"

export const workspace = {
  label: "Finance",
  description: "Accounts, periods, and journal entries.",
  icon: "navigation.accounting",
  order: 40,
} as const satisfies ModuleWorkspace
