import { Tabs as KobalteTabs } from "@kobalte/core/tabs"
import type { JSX } from "@solidjs/web"
import { css } from "../generated/css/index.js"

export interface TabItem {
  readonly value: string
  readonly label: string
  readonly content: JSX.Element
  readonly disabled?: boolean
}

export interface TabsProps {
  readonly items: readonly TabItem[]
  readonly value?: string
  readonly defaultValue?: string
  readonly onChange?: (value: string) => void
}

// A segmented control: the list is a quiet track and the selected tab is a raised chip that
// slides between positions.
const styles = {
  root: css({ display: "flex", flexDirection: "column", gap: "4", alignItems: "flex-start" }),
  list: css({
    position: "relative",
    display: "inline-flex",
    maxWidth: "full",
    gap: "0.5",
    p: "[3px]",
    bg: "contentHover",
    borderRadius: "menu",
    overflowX: "auto",
  }),
  trigger: css({
    position: "relative",
    zIndex: "[1]",
    border: "[0]",
    bg: "transparent",
    color: "muted",
    minHeight: "[30px]",
    px: "3",
    borderRadius: "item",
    textStyle: "label",
    whiteSpace: "nowrap",
    cursor: "pointer",
    transitionProperty: "[color]",
    transitionDuration: "fast",
    transitionTimingFunction: "standard",
    _motionReduce: { transitionDuration: "none" },
    _hover: { color: "text" },
    _focusVisible: { outline: "[2px solid]", outlineColor: "focusRing", outlineOffset: "[-2px]" },
    _selected: { color: "text" },
    _disabled: { cursor: "not-allowed", opacity: "0.5" },
  }),
  // Kobalte sets the chip's transform and width. It is one small layer of its own, and it moves
  // while staying on screen, so it uses the in-out curve.
  indicator: css({
    position: "absolute",
    top: "[3px]",
    bottom: "[3px]",
    left: "0",
    bg: "content",
    borderRadius: "item",
    boxShadow: "control",
    transitionProperty: "[transform, width]",
    transitionDuration: "normal",
    transitionTimingFunction: "inOut",
    _motionReduce: { transitionDuration: "none" },
  }),
  content: css({ width: "full", color: "text", _focusVisible: { outline: "none" } }),
}

export function Tabs(props: TabsProps) {
  return (
    <KobalteTabs
      class={styles.root}
      value={props.value}
      defaultValue={props.defaultValue ?? props.items[0]?.value}
      onChange={props.onChange}
    >
      <KobalteTabs.List class={styles.list}>
        {props.items.map((item) => (
          <KobalteTabs.Trigger class={styles.trigger} value={item.value} disabled={item.disabled}>
            {item.label}
          </KobalteTabs.Trigger>
        ))}
        <KobalteTabs.Indicator class={styles.indicator} />
      </KobalteTabs.List>
      {props.items.map((item) => (
        <KobalteTabs.Content class={styles.content} value={item.value}>
          {item.content}
        </KobalteTabs.Content>
      ))}
    </KobalteTabs>
  )
}
