import { For, Show } from "solid-js"
import { layout } from "../foundations/layout.ts"
import { Badge } from "../primitives/badge.tsx"

export interface DocumentFlowItem {
  /** The kind of document, for example "Sales order". */
  readonly kind: string
  /** The document number, or the kind when it has none. */
  readonly label: string
  readonly state: string
  readonly amount?: string | undefined
  readonly date?: string | undefined
  /** The workspace page of the document; absent when it has none. */
  readonly href?: string | undefined
  readonly current: boolean
}

/**
 * The chain a document belongs to, in document order. A real list with one current item; the
 * current item says so in words as well as through `aria-current`.
 */
export function DocumentFlow(props: {
  readonly label: string
  readonly items: readonly DocumentFlowItem[]
}) {
  return (
    <ol class={layout.stack} aria-label={props.label}>
      <For each={props.items}>
        {(item) => (
          <li class={layout.row} aria-current={item.current ? "true" : undefined}>
            <span class={layout.detailTerm}>{item.kind}</span>
            <Show when={item.href !== undefined} fallback={<strong>{item.label}</strong>}>
              <a href={item.href}>{item.label}</a>
            </Show>
            <Badge>{item.state}</Badge>
            <Show when={item.amount}>
              {(amount) => <span class={layout.numeric}>{amount()}</span>}
            </Show>
            <Show when={item.date}>
              {(date) => <span class={layout.detailTerm}>{date()}</span>}
            </Show>
            <Show when={item.current}>
              <Badge tone="info">This document</Badge>
            </Show>
          </li>
        )}
      </For>
    </ol>
  )
}
