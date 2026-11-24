import type { IconName } from "../ui/icons/index.ts"

/** Navigation groups after "Work", in their stable order on the bar. */
export const navigationGroups = ["Operations", "Processes", "Administration"] as const

export type NavigationGroup = (typeof navigationGroups)[number]

/**
 * Shell metadata for a module workspace. `order` sets its place in the home directory and within its
 * bar `group`.
 */
export type ModuleWorkspace = {
  readonly label: string
  readonly description: string
  readonly icon: IconName
  readonly order: number
  readonly group: NavigationGroup
  readonly area: string
  readonly section: string
}
