import type { JSX } from "@solidjs/web"
import { omit } from "solid-js"
import { css } from "../generated/css/index.js"

/** The object types the Kontainer language colors. A type is a kind of record, not a module. */
export type ObjectType = "SAL" | "PRC" | "INV" | "FIN" | "HRD"

export interface TypeTagProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  readonly type: ObjectType
}

// The three letters are the label, and the color is a second channel, so the tag never depends on
// color alone.
const styles = {
  base: css({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "10",
    px: "1.5",
    borderRadius: "item",
    color: "onType",
    fontFamily: "mono",
    fontWeight: "semibold",
    fontSize: "xs",
    lineHeight: "xs",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
    "@media (forced-colors: active)": { borderWidth: "1px", borderColor: "[CanvasText]" },
  }),
  SAL: css({ bg: "type.sal" }),
  PRC: css({ bg: "type.prc" }),
  INV: css({ bg: "type.inv" }),
  FIN: css({ bg: "type.fin" }),
  HRD: css({ bg: "type.hrd" }),
}

export function TypeTag(props: TypeTagProps) {
  return (
    <span
      {...omit(props, "type", "class", "children")}
      class={[styles.base, styles[props.type], props.class]}
    >
      {props.type}
    </span>
  )
}
