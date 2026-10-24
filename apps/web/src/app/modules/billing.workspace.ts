import type { ModuleWorkspace } from "../workspace.ts"

export const workspace = {
  label: "Billing",
  description: "Invoices, credit notes, and supplier bills.",
  icon: "object.invoice",
  order: 35,
  group: "Operations",
  area: "Revenue",
  section: "Billing",
} as const satisfies ModuleWorkspace
