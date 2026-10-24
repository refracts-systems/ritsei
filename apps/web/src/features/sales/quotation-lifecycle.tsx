import { useNavigate } from "@solidjs/router"
import * as Predicate from "effect/Predicate"
import { For, Show, useContext } from "solid-js"
import { CommandFeedback, QueryBoundary, reloaded } from "../../shared/request-feedback.tsx"
import { ApiRuntime } from "../../shared/runtime.ts"
import { formatDecimal } from "../../ui/foundations/format.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { Badge } from "../../ui/primitives/badge.tsx"
import { Button } from "../../ui/primitives/button.tsx"
import { surface } from "../../ui/recipes/surface.ts"
import {
  createProductsQuery,
  createQuotationActionMutation,
  createQuotationDocumentQuery,
} from "./documents-queries.ts"
import {
  type QuotationAction,
  type QuotationDocument,
  quotationFailureMessages,
} from "./documents.ts"

const statusTones = {
  draft: "neutral",
  sent: "info",
  accepted: "success",
  rejected: "warning",
  expired: "warning",
} as const satisfies Record<QuotationDocument["status"], "neutral" | "info" | "success" | "warning">

/** The next steps a quotation allows from its status, in the order a person takes them. */
const steps: Record<
  QuotationDocument["status"],
  readonly { readonly action: QuotationAction; readonly label: string; readonly primary?: true }[]
> = {
  draft: [{ action: "send", label: "Send quotation", primary: true }],
  sent: [
    { action: "accept", label: "Accept quotation", primary: true },
    { action: "reject", label: "Reject quotation" },
  ],
  accepted: [{ action: "convert", label: "Convert to order", primary: true }],
  rejected: [],
  expired: [],
}

const closedNote: Partial<Record<QuotationDocument["status"], string>> = {
  rejected: "This quotation was rejected and cannot move on.",
  expired: "This quotation expired before it was accepted.",
}

function QuotationLinesTable(props: { quotation: QuotationDocument }) {
  const scope = useContext(ApiRuntime)
  const products = createProductsQuery(scope)

  const productName = (id: string) => products.data.find((product) => product.id === id)?.name

  return (
    <div class={layout.scroll} tabindex="0" role="region" aria-label="Quotation lines">
      <table>
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col" class={layout.numeric}>
              Quantity
            </th>
            <th scope="col" class={layout.numeric}>
              List price
            </th>
            <th scope="col" class={layout.numeric}>
              Discount %
            </th>
            <th scope="col" class={layout.numeric}>
              Unit price
            </th>
            <th scope="col" class={layout.numeric}>
              Line total
            </th>
          </tr>
        </thead>
        <tbody>
          <For each={props.quotation.lines}>
            {(line) => (
              <tr>
                <th scope="row">{productName(line.productId) ?? line.productId}</th>
                <td class={layout.numeric}>{line.quantity}</td>
                <td class={layout.numeric}>{formatDecimal(line.listPrice)}</td>
                <td class={layout.numeric}>{line.discountPercent}</td>
                <td class={layout.numeric}>{formatDecimal(line.unitPrice)}</td>
                <td class={layout.numeric}>{formatDecimal(line.lineTotal)}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  )
}

function QuotationSteps(props: { quotation: QuotationDocument; reload: () => Promise<void> }) {
  const scope = useContext(ApiRuntime)
  const navigate = useNavigate()

  const mutation = createQuotationActionMutation(scope, props.quotation.id, (result) => {
    if (Predicate.hasProperty(result, "orderId") && Predicate.isString(result.orderId)) {
      navigate(`/sales/orders/${encodeURIComponent(result.orderId)}`)
    }
  })

  const advance = (action: QuotationAction) => {
    if (!mutation.isPending) mutation.mutate(action)
  }

  return (
    <div class={layout.stack}>
      <div class={layout.row}>
        <For each={steps[props.quotation.status]}>
          {(step) => (
            <Button
              type="button"
              variant={step.primary === true ? "primary" : "secondary"}
              loading={mutation.isPending}
              onClick={() => advance(step.action)}
            >
              {step.label}
            </Button>
          )}
        </For>
      </div>
      <Show when={closedNote[props.quotation.status]}>
        {(note) => <p class={layout.muted}>{note()}</p>}
      </Show>
      <CommandFeedback
        error={mutation.error}
        messages={quotationFailureMessages}
        pending={mutation.isPending}
        success={mutation.isSuccess}
        successMessage="Quotation updated."
        area="quotation"
        reload={props.reload}
        reset={() => mutation.reset()}
      />
    </div>
  )
}

/** The priced lines of a quotation and the steps its status allows. */
export function QuotationLifecycle(props: { id: string }) {
  const scope = useContext(ApiRuntime)
  const query = createQuotationDocumentQuery(scope, props.id)

  return (
    <section class={[surface(), layout.stack]} aria-labelledby="sales-quotation-lines-heading">
      <h3 id="sales-quotation-lines-heading">Quoted lines</h3>
      <QueryBoundary label="quotation lines" retry={() => reloaded(query.refetch())}>
        <Show when={query.data} keyed>
          {(quotation) => (
            <div class={layout.stack}>
              <p>
                <Badge tone={statusTones[quotation.status]}>{quotation.status}</Badge> Valid until{" "}
                {quotation.validUntil}. Total {formatDecimal(quotation.total)}.
              </p>
              <Show
                when={quotation.lines.length > 0}
                fallback={<p role="status">This quotation has no lines.</p>}
              >
                <QuotationLinesTable quotation={quotation} />
              </Show>
              <QuotationSteps quotation={quotation} reload={() => reloaded(query.refetch())} />
            </div>
          )}
        </Show>
      </QueryBoundary>
    </section>
  )
}
