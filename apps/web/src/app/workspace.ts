import type { IconName } from "../ui/icons/index.ts"

/** Home-directory metadata for a module workspace; `order` sets its place in the directory. */
export type ModuleWorkspace = {
  readonly label: string
  readonly description: string
  readonly icon: IconName
  readonly order: number
}
