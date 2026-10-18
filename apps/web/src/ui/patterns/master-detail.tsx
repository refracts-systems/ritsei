import type { JSX } from "@solidjs/web"
import { layout } from "../foundations/layout.ts"
import { surface } from "../recipes/surface.ts"

export interface MasterDetailProps {
  readonly master: JSX.Element
  readonly detail: JSX.Element
  readonly masterLabel?: string
  readonly detailLabel?: string
  readonly class?: JSX.ClassValue
}

export function MasterDetail(props: MasterDetailProps) {
  return (
    <div class={[layout.row, props.class]}>
      <section class={surface()} aria-label={props.masterLabel ?? "Items"}>
        {props.master}
      </section>
      <section class={surface()} aria-label={props.detailLabel ?? "Details"}>
        {props.detail}
      </section>
    </div>
  )
}
