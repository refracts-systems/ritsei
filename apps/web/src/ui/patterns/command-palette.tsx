import { createMemo, createSignal, For, Show } from "solid-js"
import { css } from "../generated/css/index.js"
import { control } from "../recipes/control.ts"
import { Dialog } from "../primitives/dialog.tsx"

export interface PaletteEntry {
  readonly label: string
  readonly href: string
  /** The group the entry belongs to, shown beside it and matched by the filter. */
  readonly group: string
}

const styles = {
  list: css({ display: "grid", gap: "0.5", m: "0", p: "0", listStyle: "none" }),
  entry: css({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "3",
    minHeight: "10",
    px: "3",
    borderRadius: "item",
    color: "text",
    textDecoration: "none",
    textStyle: "body",
    _hover: { bg: "contentHover" },
    _focusVisible: { bg: "contentHover", outline: "[2px solid]", outlineColor: "focusRing" },
  }),
  group: css({ color: "muted", fontFamily: "mono", fontSize: "xs" }),
  empty: css({ color: "muted", textStyle: "body", m: "0" }),
}

const matches = (entry: PaletteEntry, query: string): boolean => {
  const needle = query.trim().toLowerCase()

  return (
    needle === "" ||
    entry.label.toLowerCase().includes(needle) ||
    entry.group.toLowerCase().includes(needle)
  )
}

/**
 * A palette of destinations that opens from the keyboard. It filters a fixed list of workspaces:
 * it jumps between places and does not search records.
 */
export function CommandPalette(props: {
  readonly entries: readonly PaletteEntry[]
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onChoose: (href: string) => void
}) {
  const [query, setQuery] = createSignal("")
  const found = createMemo(() => props.entries.filter((entry) => matches(entry, query())))
  let input: HTMLInputElement | undefined
  let list: HTMLUListElement | undefined

  const links = () => [...(list?.querySelectorAll<HTMLAnchorElement>("a") ?? [])]

  const move = (from: number, step: 1 | -1) => {
    const all = links()
    const next = from + step

    if (next < 0) input?.focus()
    else all[Math.min(next, all.length - 1)]?.focus()
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (next) setQuery("")
        props.onOpenChange(next)
      }}
      title="Go to a workspace"
      initialFocus={() => input}
    >
      <input
        ref={(element) => (input = element)}
        type="text"
        class={control({ kind: "input" })}
        aria-label="Filter workspaces"
        placeholder="Type a workspace name"
        autocomplete="off"
        value={query()}
        onInput={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault()
            links()[0]?.focus()
          } else if (event.key === "Enter") {
            const first = found()[0]

            if (first !== undefined) {
              event.preventDefault()
              props.onChoose(first.href)
            }
          }
        }}
      />
      <Show
        when={found().length > 0}
        fallback={
          <p class={styles.empty} role="status">{`No workspace matches “${query().trim()}”.`}</p>
        }
      >
        <ul ref={(element) => (list = element)} class={styles.list} aria-label="Workspaces">
          <For each={found()}>
            {(entry, index) => (
              <li>
                <a
                  class={styles.entry}
                  href={entry.href}
                  onClick={() => props.onChoose(entry.href)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault()
                      move(index(), event.key === "ArrowDown" ? 1 : -1)
                    }
                  }}
                >
                  <span>{entry.label}</span>
                  <span class={styles.group}>{entry.group}</span>
                </a>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </Dialog>
  )
}
