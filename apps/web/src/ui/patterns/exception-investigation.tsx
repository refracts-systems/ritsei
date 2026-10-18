import type { JSX } from "@solidjs/web"
import { layout } from "../foundations/layout.ts"
import { surface } from "../recipes/surface.ts"

export interface ExceptionInvestigationProps {
  readonly title: string
  readonly description?: JSX.Element
  readonly children: JSX.Element
  readonly evidence?: JSX.Element
  readonly actions?: JSX.Element
  readonly class?: JSX.ClassValue
}

export function ExceptionInvestigation(props: ExceptionInvestigationProps) {
  return (
    <section class={[layout.stack, props.class]} aria-label={props.title}>
      <header class={layout.row}>
        <div class={layout.stack}>
          <h1>{props.title}</h1>
          {props.description}
        </div>
        {props.actions}
      </header>
      <div class={layout.row}>
        <div class={layout.stack}>{props.children}</div>
        {props.evidence && (
          <aside class={surface()} aria-label="Evidence">
            {props.evidence}
          </aside>
        )}
      </div>
    </section>
  )
}
