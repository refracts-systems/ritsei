import type { JSX } from "@solidjs/web"
import { Show } from "solid-js"
import { layout } from "../foundations/layout.ts"
import { surface } from "../recipes/surface.ts"

export interface EntityWorkspaceProps {
  readonly title: string
  readonly description?: JSX.Element
  readonly headerActions?: JSX.Element
  readonly toolbar?: JSX.Element
  readonly children: JSX.Element
  readonly aside?: JSX.Element
  readonly class?: JSX.ClassValue
}

export function EntityWorkspace(props: EntityWorkspaceProps) {
  return (
    <section class={[layout.stack, props.class]} aria-label={props.title}>
      <header class={layout.workspaceHeading}>
        <div class={layout.workspaceTitle}>
          <h1>{props.title}</h1>
          <div class={layout.workspaceDescription}>{props.description}</div>
        </div>
        <Show when={props.headerActions}>
          <div class={layout.workspaceActions}>{props.headerActions}</div>
        </Show>
      </header>
      <Show when={props.toolbar}>
        <div class={surface({ tone: "subtle" })}>{props.toolbar}</div>
      </Show>
      <div class={props.aside ? layout.workspaceSplit : layout.stack}>
        <div class={layout.stack}>{props.children}</div>
        <Show when={props.aside}>
          <aside class={[surface(), layout.inspector]} aria-label="Related information">
            {props.aside}
          </aside>
        </Show>
      </div>
    </section>
  )
}
