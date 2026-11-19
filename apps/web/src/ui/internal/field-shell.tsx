import type { JSX } from "@solidjs/web"
import { createUniqueId, untrack } from "solid-js"
import { css } from "../generated/css/index.js"

export type FieldProps = {
  readonly id?: string
  readonly label: JSX.Element
  readonly error?: JSX.Element
  readonly class?: JSX.ClassValue
}

type FieldControlProps = {
  readonly id: string
  readonly "aria-describedby"?: string
  readonly "aria-invalid"?: "true"
}

const styles = {
  root: css({ display: "flex", flexDirection: "column", gap: "1.5" }),
  label: css({ textStyle: "label" }),
  error: css({ textStyle: "helper", color: "danger" }),
}

export function FieldShell(
  props: FieldProps & { readonly children: (controlProps: FieldControlProps) => JSX.Element },
) {
  const id = props.id ?? createUniqueId()
  const errorId = `${id}-error`

  // The control renders once; its ARIA attributes are getters so a spread onto it still updates.
  const controlProps: FieldControlProps = {
    id,
    get "aria-describedby"() {
      return props.error ? errorId : undefined
    },
    get "aria-invalid"() {
      return props.error ? "true" : undefined
    },
  }

  return (
    <div class={props.class ? [styles.root, props.class] : styles.root}>
      <label class={styles.label} for={id}>
        {props.label}
      </label>
      {untrack(() => props.children(controlProps))}
      {props.error && (
        <div class={styles.error} id={errorId} role="alert">
          {props.error}
        </div>
      )}
    </div>
  )
}
