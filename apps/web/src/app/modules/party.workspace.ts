import type { ModuleWorkspace } from "../workspace.ts"

export const workspace = {
  label: "Parties",
  description: "Organizations, legal entities, and branches.",
  icon: "navigation.parties",
  order: 60,
} as const satisfies ModuleWorkspace
