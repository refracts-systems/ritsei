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

const styles = {
  root: css({ display: "flex", flexDirection: "column", gap: "4" }),
  list: css({
    position: "relative",
    display: "flex",
    gap: "4",
    borderBottomWidth: "1px",
    borderColor: "boundary",
    overflowX: "auto",
  }),
  trigger: css({
    position: "relative",
    border: "[0]",
    bg: "transparent",
    color: "muted",
    px: "0.5",
    py: "2.5",
    textStyle: "label",
    whiteSpace: "nowrap",
    cursor: "pointer",
    _hover: { color: "text" },
    _focusVisible: { outline: "[2px solid]", outlineColor: "focusRing", outlineOffset: "[-2px]" },
    _selected: { color: "text", fontWeight: "semibold" },
    _disabled: { cursor: "not-allowed", opacity: "0.5" },
  }),
  indicator: css({
    position: "absolute",
    bottom: "[-1px]",
    left: "0",
    height: "0.5",
    bg: "action",
    borderRadius: "full",
    transitionProperty: "[transform, width]",
    transitionDuration: "normal",
    transitionTimingFunction: "standard",
    _motionReduce: { transitionDuration: "none" },
  }),
  content: css({ color: "text", _focusVisible: { outline: "none" } }),
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
