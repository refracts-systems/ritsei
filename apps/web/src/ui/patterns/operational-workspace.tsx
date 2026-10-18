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
      <header class={layout.workspaceHeading}>
        <div class={layout.workspaceTitle}>
          <h1>{props.title}</h1>
          <div class={layout.workspaceDescription}>{props.description}</div>
        </div>
        {props.actions && <div class={layout.workspaceActions}>{props.actions}</div>}
      </header>
      {props.status && (
        <div role="status" class={surface({ tone: "subtle" })}>
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
