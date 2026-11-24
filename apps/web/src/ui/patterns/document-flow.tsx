import { For, Show } from "solid-js"
import { css } from "../generated/css/index.js"
import { Badge } from "../primitives/badge.tsx"
import { type ObjectType, TypeTag } from "../primitives/type-tag.tsx"

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
  /** The object type the document belongs to, shown as a tag and as the color of its edge. */
  readonly tag?: ObjectType | undefined
}

// The chain reads top to bottom, one node per document, joined by a line. A node keeps its type
// color on its left edge, and the current one has a heavier accent frame.
const styles = {
  chain: css({
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    m: "0",
    p: "0",
    listStyle: "none",
  }),
  item: css({ display: "flex", flexDirection: "column", alignItems: "stretch", minWidth: "0" }),
  node: css({
    display: "flex",
    flexDirection: "column",
    gap: "1",
    minWidth: "[9rem]",
    p: "3",
    bg: "content",
    borderWidth: "1px",
    borderLeftWidth: "6px",
    borderColor: "frame",
    textStyle: "body",
  }),
  current: css({ borderWidth: "2px", borderLeftWidth: "6px", borderColor: "accent" }),
  line: css({ display: "flex", alignItems: "center", gap: "2" }),
  name: css({ fontFamily: "mono", fontWeight: "semibold" }),
  detail: css({ color: "muted", textStyle: "body" }),
  amount: css({ fontFamily: "mono", fontVariantNumeric: "tabular-nums" }),
  join: css({ flex: "none", width: "[1px]", height: "4", ml: "4", bg: "frame" }),
  none: css({ borderLeftColor: "boundaryStrong" }),
  SAL: css({ borderLeftColor: "type.sal" }),
  PRC: css({ borderLeftColor: "type.prc" }),
  INV: css({ borderLeftColor: "type.inv" }),
  FIN: css({ borderLeftColor: "type.fin" }),
  HRD: css({ borderLeftColor: "type.hrd" }),
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
    <ol class={styles.chain} aria-label={props.label}>
      <For each={props.items}>
        {(item, index) => (
          <li class={styles.item} aria-current={item.current ? "true" : undefined}>
            <Show when={index() > 0}>
              <span class={styles.join} aria-hidden="true" />
            </Show>
            <div
              class={[
                styles.node,
                item.tag === undefined ? styles.none : styles[item.tag],
                item.current ? styles.current : undefined,
              ]}
            >
              <span class={styles.line}>
                <Show when={item.tag}>{(tag) => <TypeTag type={tag()} />}</Show>
                <Show when={item.label !== item.kind}>
                  <span class={styles.detail}>{item.kind}</span>
                </Show>
              </span>
              <Show when={item.href !== undefined} fallback={<strong>{item.label}</strong>}>
                <a class={styles.name} href={item.href}>
                  {item.label}
                </a>
              </Show>
              <span class={styles.line}>
                <Badge>{item.state}</Badge>
                <Show when={item.amount}>
                  {(amount) => <span class={styles.amount}>{amount()}</span>}
                </Show>
              </span>
              <Show when={item.date}>{(date) => <span class={styles.detail}>{date()}</span>}</Show>
              <Show when={item.current}>
                <Badge tone="info">This document</Badge>
              </Show>
            </div>
          </li>
        )}
      </For>
    </ol>
  )
}
