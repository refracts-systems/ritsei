import type { ModuleWorkspace } from "../workspace.ts"

export const workspace = {
  label: "Process Studio",
  description: "Design and monitor business processes.",
  icon: "navigation.process",
  order: 50,
} as const satisfies ModuleWorkspace
