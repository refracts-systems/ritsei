import { createMemo, Show, useContext } from "solid-js"
import { CommandFeedback, QueryBoundary, reloaded } from "../../shared/request-feedback.tsx"
import { ApiRuntime } from "../../shared/runtime.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { surface } from "../../ui/recipes/surface.ts"
import { type ApprovalRequest, type Decision, decisionFailureMessages } from "./service.ts"
import { RequestTable } from "./approvals.tsx"
import { createApprovalsQuery, createDecisionMutation, createUserAccountsQuery } from "./queries.ts"

/** The most requests the home page lists; the Approvals workspace shows the rest. */
const shown = 5

/**
 * Requesters are named by e-mail address. The accounts are fetched only when there is a request to
 * name, so an empty queue costs the home page nothing beyond the request list.
 */
function PendingQueue(props: {
  requests: readonly ApprovalRequest[]
  busy: boolean
  onDecide: (id: string, decision: Decision) => void
}) {
  const scope = useContext(ApiRuntime)
  const accounts = createUserAccountsQuery(scope)

  const emails = createMemo(
    () => new Map(accounts.data.map((account) => [account.id, account.email])),
  )

  return (
    <>
      <p role="status">
        {props.requests.length === 1
          ? "1 request needs a decision."
          : `${props.requests.length} requests need a decision.`}
      </p>
      <RequestTable
        requests={props.requests.slice(0, shown)}
        emailOf={(id) => emails().get(id) ?? id}
        busy={props.busy}
        onDecide={props.onDecide}
      />
      <a href="/approvals">
        {props.requests.length > shown
          ? `See all ${props.requests.length} requests in Approvals`
          : "Open Approvals"}
      </a>
    </>
  )
}

/**
 * The Dermaga: what is waiting for a decision, on the home page, with the decision one click away.
 * It reads the same pending requests as the Approvals workspace, so there is one source for both.
 */
export default function Dermaga() {
  const scope = useContext(ApiRuntime)
  const query = createApprovalsQuery(scope, "pending")
  const decision = createDecisionMutation(scope)

  return (
    <section class={[surface(), layout.stack]} aria-labelledby="dermaga-heading">
      <h2 id="dermaga-heading">Waiting for you</h2>
      <QueryBoundary label="requests waiting for you" retry={() => reloaded(query.refetch())}>
        <Show
          when={query.data.length > 0}
          fallback={
            <div class={layout.emptyCollection} role="status">
              <p>Nothing is waiting for your decision.</p>
              <p>
                Requests appear here when a purchase order or bill goes above its approval limit.
              </p>
            </div>
          }
        >
          <PendingQueue
            requests={query.data}
            busy={decision.isPending}
            onDecide={(id, choice) => {
              if (!decision.isPending) decision.mutate({ id, decision: choice })
            }}
          />
        </Show>
      </QueryBoundary>
      <CommandFeedback
        error={decision.error}
        messages={decisionFailureMessages}
        pending={decision.isPending}
        success={decision.isSuccess}
        successMessage="Decision recorded."
        area="requests"
        reload={() => reloaded(query.refetch())}
        reset={() => decision.reset()}
      />
    </section>
  )
}
