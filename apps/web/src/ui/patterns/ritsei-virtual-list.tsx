import type { JSX } from "@solidjs/web"
import { createSignal, For, onCleanup, Show } from "solid-js"
import { css } from "../generated/css/index.js"
import { surface } from "../recipes/surface.ts"

export interface RitseiVirtualListProps<Item> {
  readonly ariaLabel: string
  readonly items: readonly Item[]
  readonly itemHeight: number
  readonly renderItem: (item: Item, index: number) => JSX.Element
  readonly getItemId?: (item: Item, index: number) => string
  readonly overscan?: number
  readonly empty?: JSX.Element
  readonly class?: JSX.ClassValue
}

const styles = {
  root: css({ maxHeight: "[30rem]", overflow: "auto", position: "relative" }),
  viewport: css({ position: "relative", width: "[100%]" }),
  item: css({ position: "absolute", left: "[0]", width: "[100%]" }),
}

/**
 * Narrow RITSEI-owned rendering-window boundary, not a TanStack Virtual API mirror.
 *
 * The component owns only fixed-row window math and list semantics. It deliberately does not accept
 * engine options. A future measured adapter can replace the math without changing semantic callers;
 * small collections should use a normal `For` instead.
 */
export function RitseiVirtualList<Item>(props: RitseiVirtualListProps<Item>) {
  const [scrollTop, setScrollTop] = createSignal(0)
  const rowHeight = () => Math.max(1, props.itemHeight)
  const overscan = () => Math.max(0, props.overscan ?? 4)
  const start = () => Math.max(0, Math.floor(scrollTop() / rowHeight()) - overscan())

  const end = () =>
    Math.min(props.items.length, Math.ceil((scrollTop() + 480) / rowHeight()) + overscan())

  const visibleItems = () => props.items.slice(start(), end())
  let root: HTMLDivElement | undefined
  let handleScroll: (() => void) | undefined

  const setRoot = (element: HTMLDivElement) => {
    root = element
    handleScroll = () => setScrollTop(element.scrollTop)
    element.addEventListener("scroll", handleScroll, { passive: true })
  }

  onCleanup(() => {
    if (root && handleScroll) root.removeEventListener("scroll", handleScroll)
  })

  return (
    <div
      ref={setRoot}
      class={[surface(), styles.root, props.class]}
      role="list"
      aria-label={props.ariaLabel}
      aria-busy="false"
    >
      <Show when={props.items.length > 0} fallback={props.empty ?? "No records."}>
        <div class={styles.viewport} style={{ height: `${props.items.length * rowHeight()}px` }}>
          <For each={visibleItems()}>
            {(item, visibleIndex) => {
              const index = () => start() + visibleIndex()

              return (
                <div
                  class={styles.item}
                  role="listitem"
                  aria-setsize={props.items.length}
                  aria-posinset={index() + 1}
                  data-item-id={props.getItemId?.(item, index())}
                  style={{
                    height: `${rowHeight()}px`,
                    transform: `translateY(${index() * rowHeight()}px)`,
                  }}
                >
                  {props.renderItem(item, index())}
                </div>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}
