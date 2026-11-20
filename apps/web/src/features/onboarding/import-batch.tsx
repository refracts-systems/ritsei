import { useMutation, useQueryClient } from "@tanstack/solid-query"
import { For, Show, untrack, useContext } from "solid-js"
import type { RequestFailure } from "../../shared/api.ts"
import type { ImportBatchSummary } from "../../shared/contracts/generated/onboarding.ts"
import { CommandFeedback, QueryBoundary, reloaded } from "../../shared/request-feedback.tsx"
import { ApiRuntime, runRequest } from "../../shared/runtime.ts"
import { createServerQuery, serverQueryKey } from "../../shared/server-query.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { Badge } from "../../ui/primitives/badge.tsx"
import { Button } from "../../ui/primitives/button.tsx"
import { surface } from "../../ui/recipes/surface.ts"
import { errorRowsKey, ImportErrors } from "./import-errors.tsx"
import {
  applyPartyImport,
  getImportBatch,
  importFailureMessages,
  rehearsePartyImport,
} from "./service.ts"
import { StageImportForm } from "./stage-import-form.tsx"

const statusLabel = { staged: "Staged", rehearsed: "Simulated", applied: "Applied" } as const

function BatchSummary(props: { summary: ImportBatchSummary }) {
  const status = () => props.summary.batch.status

  const metrics = () => [
    { label: "Source instance", value: props.summary.batch.sourceInstance },
    { label: "Batch ID", value: props.summary.batch.id },
    { label: "Records", value: props.summary.batch.rowCount },
    { label: "Pending", value: props.summary.pending },
    { label: "Errors", value: props.summary.invalid },
    { label: "Applied records", value: props.summary.applied },
  ]

  return (
    <>
      <div class={layout.actionRow}>
        <h2 id="import-batch-heading">Import batch</h2>
        <Badge tone={status() === "applied" ? "success" : "neutral"}>{statusLabel[status()]}</Badge>
      </div>
      <dl class={layout.detailList}>
        <BatchMetrics values={metrics()} />
      </dl>
      <Show when={props.summary.batch.rehearsal} keyed>
        {(preview) => (
          <>
            <h3>Last simulation</h3>
            <dl class={layout.detailList}>
              <BatchMetrics
                values={[
                  { label: "New Party records", value: preview.accepted },
                  { label: "Existing matches", value: preview.alreadyMapped },
                  { label: "Blocking records", value: preview.blocking },
                ]}
              />
            </dl>
          </>
        )}
      </Show>
    </>
  )
}

function BatchMetrics(props: { values: ReadonlyArray<{ label: string; value: string | number }> }) {
  return (
    <For each={props.values} keyed={(metric) => metric.label}>
      {(metric) => (
        <div class={layout.detailItem}>
          <dt class={layout.detailTerm}>{metric().label}</dt>
          <dd class={layout.detailValue}>{metric().value}</dd>
        </div>
      )}
    </For>
  )
}

function BatchActions(props: {
  summary: ImportBatchSummary
  onChange: (summary: ImportBatchSummary) => Promise<void>
  reload: () => Promise<void>
}) {
  const scope = useContext(ApiRuntime)

  const mutation = useMutation<ImportBatchSummary, RequestFailure, "rehearse" | "apply">(() => ({
    mutationFn: (command) => {
      const execute = command === "rehearse" ? rehearsePartyImport : applyPartyImport

      return runRequest(scope, execute(props.summary.batch.id))
    },
    onSuccess: props.onChange,
  }))

  const unknown = () => mutation.error?.kind === "unknown-outcome"
  const busy = () => mutation.isPending || unknown()
  const canApply = () => props.summary.batch.status === "rehearsed" && props.summary.invalid === 0

  const successMessage = () => {
    if (mutation.variables === "rehearse") return "Simulation saved."

    return props.summary.batch.status === "applied"
      ? "Import applied."
      : "Review the remaining records before continuing."
  }

  return (
    <>
      <Show when={props.summary.batch.status !== "applied"}>
        <p>
          Run a simulation to see what will be created. Applying saves each record, so you can
          resume this batch if the connection drops.
        </p>
        <div class={layout.actionRow}>
          <Button type="button" disabled={busy()} onClick={() => mutation.mutate("rehearse")}>
            Run simulation
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy() || !canApply()}
            onClick={() => mutation.mutate("apply")}
          >
            Apply import
          </Button>
          <Show when={!unknown()}>
            <Button type="button" disabled={mutation.isPending} onClick={() => void props.reload()}>
              Refresh batch
            </Button>
          </Show>
        </div>
      </Show>
      <CommandFeedback
        area="batch"
        error={mutation.error}
        messages={importFailureMessages}
        pending={mutation.isPending}
        success={mutation.isSuccess}
        successMessage={successMessage()}
        reload={props.reload}
        reset={() => mutation.reset()}
      />
      <Show when={props.summary.batch.status === "applied"}>
        <p>
          <a href="/parties">Open Parties</a>
        </p>
      </Show>
    </>
  )
}

export function ImportBatch(props: { batchId: string; onStaged: (id: string) => void }) {
  const scope = useContext(ApiRuntime)
  const client = useQueryClient()
  const batchId = untrack(() => props.batchId)
  const key = ["onboarding", batchId, "summary"] as const
  const rowsKey = serverQueryKey(scope.tenantId, errorRowsKey(batchId))

  const query = createServerQuery<ImportBatchSummary, RequestFailure>({
    tenantId: scope.tenantId,
    key,
    cache: "detail",
    load: ({ signal }) => runRequest(scope, getImportBatch(batchId), signal),
  })

  const refreshRows = () => client.invalidateQueries({ queryKey: rowsKey })
  const reload = () => reloaded(Promise.all([query.refetch(), refreshRows()]))

  return (
    <QueryBoundary label="import batch" retry={reload}>
      <section class={[surface(), layout.stack]} aria-labelledby="import-batch-heading">
        <BatchSummary summary={query.data} />
        <p>Keep the batch ID to reopen this import after signing in again.</p>
        <BatchActions
          summary={query.data}
          reload={reload}
          onChange={async (summary) => {
            client.setQueryData(serverQueryKey(scope.tenantId, key), summary)
            await refreshRows()
          }}
        />
      </section>
      <Show when={query.data.invalid > 0}>
        <ImportErrors batchId={batchId} />
        <StageImportForm
          sourceInstance={query.data.batch.sourceInstance}
          onStaged={props.onStaged}
        />
      </Show>
    </QueryBoundary>
  )
}
