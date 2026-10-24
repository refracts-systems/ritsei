import { createSignal, Show, useContext } from "solid-js"
import { QueryBoundary } from "../../shared/request-feedback.tsx"
import { ApiRuntime } from "../../shared/runtime.ts"
import { formatDecimal } from "../../ui/foundations/format.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { DocumentFlow as DocumentFlowList } from "../../ui/patterns/document-flow.tsx"
import { surface } from "../../ui/recipes/surface.ts"
import { type ChainRequest, createDocumentChainQuery } from "./queries.ts"
import { nodeHref, nodeKinds } from "./service.ts"

// The query is created under the boundary, so a failing or slow flow never hides its document.
function FlowItems(props: ChainRequest & { readonly attempt: number }) {
  const scope = useContext(ApiRuntime)
  const query = createDocumentChainQuery(scope, props, props.attempt)

  return (
    <DocumentFlowList
      label="Documents in this flow"
      items={query.data.nodes.map((node) => ({
        kind: nodeKinds[node.type],
        label: node.number ?? nodeKinds[node.type],
        state: node.state,
        amount: node.amount === null ? undefined : formatDecimal(node.amount),
        date: node.date ?? undefined,
        href: nodeHref(node, query.data.legalEntityId),
        current: node.current,
      }))}
    />
  )
}

/** The documents before and after one document, each a link to its workspace where it has one. */
export function DocumentFlow(props: ChainRequest) {
  const [attempt, setAttempt] = createSignal(0)

  return (
    <section class={[surface(), layout.stack]} aria-labelledby={`flow-${props.documentId}`}>
      <h3 id={`flow-${props.documentId}`}>Document flow</h3>
      <QueryBoundary
        label="document flow"
        retry={() => {
          setAttempt((current) => current + 1)

          return Promise.resolve()
        }}
      >
        {/* A new document or a retry builds a new query instead of reusing the previous one. */}
        <Show when={{ id: props.documentId, attempt: attempt() }} keyed>
          {(target) => (
            <FlowItems
              documentType={props.documentType}
              documentId={target.id}
              feature={props.feature}
              attempt={target.attempt}
            />
          )}
        </Show>
      </QueryBoundary>
    </section>
  )
}
