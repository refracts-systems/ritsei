import type { JSX } from "@solidjs/web"
import { layout } from "../foundations/layout.ts"
import { surface } from "../recipes/surface.ts"

export interface OperationalWorkspaceProps {
  readonly title: string
  readonly description?: JSX.Element
  readonly status?: JSX.Element
  readonly actions?: JSX.Element
  readonly children: JSX.Element
  readonly secondary?: JSX.Element
  readonly class?: JSX.ClassValue
}

export function OperationalWorkspace(props: OperationalWorkspaceProps) {
  return (
    <section class={[layout.stack, props.class]} aria-label={props.title}>
      <header class={layout.row}>
        <div class={layout.stack}>
          <h1>{props.title}</h1>
          {props.description}
        </div>
        {props.actions}
      </header>
      {props.status && (
        <div role="status" class={surface()}>
          {props.status}
        </div>
      )}
      <div class={layout.stack}>{props.children}</div>
      {props.secondary && (
        <section class={surface()} aria-label="Additional information">
          {props.secondary}
        </section>
      )}
    </section>
  )
}
