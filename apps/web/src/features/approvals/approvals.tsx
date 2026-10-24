import { useNavigate } from "@solidjs/router"
import { createMemo, Show, useContext } from "solid-js"
import { formText } from "../../shared/form-values.ts"
import { CommandFeedback, QueryBoundary, reloaded } from "../../shared/request-feedback.tsx"
import { ApiRuntime } from "../../shared/runtime.ts"
import { formatDecimal } from "../../ui/foundations/format.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { DataTable } from "../../ui/patterns/data-table.tsx"
import { EntityWorkspace } from "../../ui/patterns/entity-workspace.tsx"
import { Badge } from "../../ui/primitives/badge.tsx"
import { Button } from "../../ui/primitives/button.tsx"
import { FormField } from "../../ui/primitives/form-field.tsx"
import { Form } from "../../ui/primitives/form.tsx"
import { Select } from "../../ui/primitives/select.tsx"
import { surface } from "../../ui/recipes/surface.ts"
import { createApprovalsQuery, createDecisionMutation, createUserAccountsQuery } from "./queries.ts"
import {
  type ApprovalRequest,
  type ApprovalStatus,
  decisionFailureMessages,
  subjectHref,
  subjectLabel,
} from "./service.ts"

const statusOptions = [
  { value: "pending", label: "Waiting for a decision" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
]

const subjectName = (request: ApprovalRequest): string => subjectLabel(request.subjectType)

const statusTones = { pending: "warning", approved: "success", rejected: "danger" } as const

function StatusFilter(props: { status: ApprovalStatus | undefined }) {
  const navigate = useNavigate()

  return (
    <Form
      class={layout.row}
      aria-label="Approval filters"
      onSubmit={(value) => {
        const status = formText(value.status)
        navigate(status === "" ? "/approvals" : `/approvals?status=${encodeURIComponent(status)}`)
      }}
    >
      <FormField label="Show">
        {(fieldProps) => (
          <Select
            {...fieldProps}
            name="status"
            placeholder="All requests"
            options={statusOptions}
            value={props.status ?? ""}
          />
        )}
      </FormField>
      <Button variant="primary" type="submit">
        Apply filters
      </Button>
    </Form>
  )
}

function RequestTable(props: {
  requests: readonly ApprovalRequest[]
  emailOf: (id: string) => string
  onDecide: (id: string, decision: "approve" | "reject") => void
  busy: boolean
}) {
  return (
    <DataTable
      surface={false}
      caption="Approval requests"
      rows={props.requests}
      getRowId={(request) => request.id}
      columns={[
        {
          id: "subject",
          header: "Request for",
          rowHeader: true,
          cell: (request) => {
            const label = subjectName(request)
            const href = subjectHref(request.subjectType, request.subjectId)

            return href === undefined ? label : <a href={href}>{label}</a>
          },
        },
        { id: "reason", header: "Why", cell: (request) => request.reason },
        {
          id: "amount",
          header: "Amount",
          align: "end",
          cell: (request) => formatDecimal(request.amount),
        },
        { id: "by", header: "Requested by", cell: (request) => props.emailOf(request.requestedBy) },
        {
          id: "status",
          header: "Status",
          cell: (request) => <Badge tone={statusTones[request.status]}>{request.status}</Badge>,
        },
        {
          id: "decision",
          header: "Decision",
          cell: (request) =>
            request.status === "pending" ? (
              <div class={layout.row}>
                <Button
                  type="button"
                  variant="primary"
                  disabled={props.busy}
                  aria-label={`Approve ${subjectName(request)} for ${request.amount}`}
                  onClick={() => props.onDecide(request.id, "approve")}
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  disabled={props.busy}
                  aria-label={`Reject ${subjectName(request)} for ${request.amount}`}
                  onClick={() => props.onDecide(request.id, "reject")}
                >
                  Reject
                </Button>
              </div>
            ) : (
              `by ${props.emailOf(request.decidedBy ?? "")}`
            ),
        },
      ]}
    />
  )
}

function RequestList(props: { status: ApprovalStatus | undefined }) {
  const scope = useContext(ApiRuntime)
  const query = createApprovalsQuery(scope, props.status)
  const accounts = createUserAccountsQuery(scope)
  const decision = createDecisionMutation(scope)

  const emails = createMemo(
    () => new Map(accounts.data.map((account) => [account.id, account.email])),
  )

  const emailOf = (id: string) => emails().get(id) ?? id

  return (
    <section class={[surface(), layout.stack]} aria-labelledby="approvals-heading">
      <h2 id="approvals-heading">Requests</h2>
      <QueryBoundary label="approval requests" retry={() => reloaded(query.refetch())}>
        <Show
          when={query.data.length > 0}
          fallback={
            <div class={layout.emptyCollection} role="status">
              <p>
                {props.status === "pending"
                  ? "Nothing is waiting for a decision."
                  : "No approval requests match this filter."}
              </p>
              <p>
                Requests appear here when a purchase order or bill goes above its approval limit.
              </p>
            </div>
          }
        >
          <RequestTable
            requests={query.data}
            emailOf={emailOf}
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
        area="approvals"
        reload={() => reloaded(query.refetch())}
        reset={() => decision.reset()}
      />
    </section>
  )
}

export function Approvals(props: { status?: ApprovalStatus | undefined }) {
  return (
    <EntityWorkspace
      title="Approvals"
      description={
        <p>
          Requests that need a decision before work can continue. A request is decided by someone
          other than the person who raised it.
        </p>
      }
      toolbar={<StatusFilter status={props.status} />}
    >
      <RequestList status={props.status} />
    </EntityWorkspace>
  )
}
