import { createSignal, For, Show, useContext } from "solid-js"
import type { RequestFailure } from "../../shared/api.ts"
import type { ImportRow } from "../../shared/contracts/generated/onboarding.ts"
import { QueryBoundary, reloaded } from "../../shared/request-feedback.tsx"
import { ApiRuntime, runRequest } from "../../shared/runtime.ts"
import { createServerQuery } from "../../shared/server-query.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { Button } from "../../ui/primitives/button.tsx"
import { surface } from "../../ui/recipes/surface.ts"
import { importRowPageSize, listImportErrors } from "./service.ts"

export const errorRowsKey = (batchId: string) => ["onboarding", batchId, "errors"] as const

function ErrorPage(props: { batchId: string; after: number; setAfter: (row: number) => void }) {
  const scope = useContext(ApiRuntime)

  const query = createServerQuery<readonly ImportRow[], RequestFailure>({
    tenantId: scope.tenantId,
    key: [...errorRowsKey(props.batchId), props.after],
    load: ({ signal }) => runRequest(scope, listImportErrors(props.batchId, props.after), signal),
  })

  return (
    <QueryBoundary label="row errors" retry={() => reloaded(query.refetch())}>
      <Show
        when={query.data.length > 0}
        fallback={<p role="status">No row errors on this page.</p>}
      >
        <ul class={layout.stack}>
          <For each={query.data.slice(0, importRowPageSize)}>
            {(row) => (
              <li>
                <h3>Record {row.rowNumber}</h3>
                <ul>
                  <For each={row.errors}>
                    {(error) => (
                      <li class={layout.detailValue}>
                        {error.field === null ? "" : `${error.field} · `}
                        <span>{error.message}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div class={layout.actionRow}>
        <Show when={props.after > 0}>
          <Button type="button" onClick={() => props.setAfter(0)}>
            First errors
          </Button>
        </Show>
        <Show when={query.data[importRowPageSize - 1]} keyed>
          {(last) => (
            <Show when={query.data.length > importRowPageSize}>
              <Button type="button" onClick={() => props.setAfter(last.rowNumber)}>
                Next errors
              </Button>
            </Show>
          )}
        </Show>
      </div>
    </QueryBoundary>
  )
}

export function ImportErrors(props: { batchId: string }) {
  const [page, setPage] = createSignal({ after: 0 })

  return (
    <section class={[surface(), layout.stack]} aria-labelledby="import-errors-heading">
      <h2 id="import-errors-heading">Row errors</h2>
      <p>
        Correct these records in the CSV and stage the corrected file using the same source
        instance.
      </p>
      <Show when={page()} keyed>
        {(current) => (
          <ErrorPage
            batchId={props.batchId}
            after={current.after}
            setAfter={(after) => setPage({ after })}
          />
        )}
      </Show>
    </section>
  )
}
