import type { ModuleWorkspace } from "../workspace.ts"

export const workspace = {
  label: "Parties",
  description: "Organizations, legal entities, and branches.",
  icon: "navigation.parties",
  order: 60,
  group: "Administration",
  area: "Party",
  section: "Parties",
} as const satisfies ModuleWorkspace
