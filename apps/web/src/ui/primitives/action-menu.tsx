import { DropdownMenu } from "@kobalte/core/dropdown-menu"
import type { JSX } from "@solidjs/web"
import { createSignal, For } from "solid-js"
import {
  type ActionEntry,
  ActionMenuContext,
  type ActionMenuRegistry,
} from "./action-menu-context.ts"
import { css } from "../generated/css/index.js"
import { Icon } from "../icons/index.ts"
import { control } from "../recipes/control.ts"

const styles = {
  // The panel renders in place (no Portal): under the pinned Solid 2 alpha, Kobalte's popper only
  // computes a position when the content shares the trigger's subtree.
  root: css({ position: "relative", display: "inline-flex" }),
  content: css({
    zIndex: "modal",
    minWidth: "[13rem]",
    p: "1",
    bg: "content",
    color: "text",
    borderWidth: "1px",
    borderColor: "boundary",
    borderRadius: "overlay",
    boxShadow: "overlay",
    _focusVisible: { outline: "none" },
  }),
  item: css({
    display: "flex",
    alignItems: "center",
    minHeight: "8",
    px: "2.5",
    borderRadius: "control",
    textStyle: "label",
    fontWeight: "regular",
    color: "text",
    cursor: "pointer",
    outline: "none",
    userSelect: "none",
    "&[data-highlighted]": { bg: "contentHover" },
    "&[data-disabled]": { opacity: "0.5", cursor: "not-allowed" },
  }),
}

export interface ActionMenuProps {
  readonly label?: string
  readonly children: JSX.Element
}

/**
 * Collects secondary commands behind one "More actions" control. Dialogs rendered as children stay
 * mounted outside the menu and register their trigger as a menu item instead of a button.
 */
export function ActionMenu(props: ActionMenuProps) {
  const [entries, setEntries] = createSignal<readonly ActionEntry[]>([])
  // Kobalte owns the trigger ref (it anchors the menu position), so focus is restored via a wrapper.
  let root: HTMLSpanElement | undefined
  // The selected item's action runs after the menu has closed and released focus, so the dialog it
  // opens keeps focus instead of the menu pulling it back to its trigger.
  let pending: (() => void) | undefined
  let nextId = 0

  const registry: ActionMenuRegistry = {
    register: (entry) => {
      const id = nextId++
      setEntries((current) => [...current, { ...entry, id }])

      return () => setEntries((current) => current.filter((candidate) => candidate.id !== id))
    },
    restoreFocus: () =>
      queueMicrotask(() => root?.querySelector<HTMLElement>("[aria-haspopup]")?.focus()),
  }

  return (
    <ActionMenuContext value={registry}>
      <span ref={(element) => (root = element)} class={styles.root}>
        <DropdownMenu placement="bottom-end" gutter={4}>
          <DropdownMenu.Trigger class={control({ kind: "secondary", size: "md" })}>
            {props.label ?? "More actions"}
            <Icon name="disclosure.collapse" size="sm" tone="muted" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content
            class={styles.content}
            onCloseAutoFocus={(event: Event) => {
              const action = pending

              if (action === undefined) return
              pending = undefined
              event.preventDefault()
              action()
            }}
          >
            <For each={entries()}>
              {(entry) => (
                <DropdownMenu.Item
                  class={styles.item}
                  onSelect={() => {
                    pending = entry.select
                  }}
                >
                  {entry.label}
                </DropdownMenu.Item>
              )}
            </For>
          </DropdownMenu.Content>
        </DropdownMenu>
      </span>
      {props.children}
    </ActionMenuContext>
  )
}
