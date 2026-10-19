import type { IconName } from "../ui/icons/index.ts"

/** Global-navigation groups after "Work", in their stable sidebar order. */
export const navigationGroups = ["Operations", "Processes", "Administration"] as const

export type NavigationGroup = (typeof navigationGroups)[number]

/**
 * Shell metadata for a module workspace. `order` sets its place in the home directory and within its
 * sidebar `group`; `area` and `section` label the topbar's `Area / Section` local navigation.
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
