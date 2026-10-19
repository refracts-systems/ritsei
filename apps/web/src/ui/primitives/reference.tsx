import { Show } from "solid-js"
import { css } from "../generated/css/index.js"

export interface ReferenceProps {
  /** Identifier of the referenced record. Always kept as the tooltip and fallback. */
  readonly id: string
  /** Human-readable name resolved by the owning feature, when it is known. */
  readonly label?: string | undefined
}

const styles = {
  code: css({ fontFamily: "mono", fontSize: "xs", color: "muted" }),
}

/**
 * Shows a referenced record by name, keeping its identifier as the tooltip. Falls back to the
 * monospaced identifier when the caller cannot resolve a name. Resolution stays with the feature.
 */
export function Reference(props: ReferenceProps) {
  return (
    <Show when={props.label} keyed fallback={<code class={styles.code}>{props.id}</code>}>
      {(label) => <span title={props.id}>{label}</span>}
    </Show>
  )
}
