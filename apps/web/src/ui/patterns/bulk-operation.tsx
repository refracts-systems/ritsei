import type { JSX } from "@solidjs/web"
import { layout } from "../foundations/layout.ts"
import { surface } from "../recipes/surface.ts"

export interface BulkOperationProps {
  readonly title: string
  readonly description?: JSX.Element
  readonly selectedLabel?: string
  readonly selectedCount?: number
  readonly children: JSX.Element
  readonly actions?: JSX.Element
  readonly class?: JSX.ClassValue
}

export function BulkOperation(props: BulkOperationProps) {
  return (
    <section class={[surface(), layout.stack, props.class]} aria-label={props.title}>
      <header class={layout.row}>
        <div class={layout.stack}>
          <h1>{props.title}</h1>
          {props.description}
        </div>
        {props.selectedCount !== undefined && (
          <p aria-live="polite">
            {props.selectedLabel ?? "Selected"}: {props.selectedCount}
          </p>
        )}
      </header>
      <div>{props.children}</div>
      {props.actions && <div class={layout.row}>{props.actions}</div>}
    </section>
  )
}
