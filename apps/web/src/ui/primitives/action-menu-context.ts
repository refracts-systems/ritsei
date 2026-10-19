import type { JSX } from "@solidjs/web"
import { createContext, useContext } from "solid-js"

export type ActionEntry = Readonly<{ id: number; label: JSX.Element; select: () => void }>

export type ActionMenuRegistry = Readonly<{
  register: (entry: Omit<ActionEntry, "id">) => () => void
  restoreFocus: () => void
}>

// Solid 2 treats an undefined default as "no default", so outside a menu the value is null.
export const ActionMenuContext = createContext<ActionMenuRegistry | null>(null)

/** The enclosing ActionMenu, if any. Dialog uses it to turn its trigger into a menu item. */
export const useActionMenu = () => useContext(ActionMenuContext)
