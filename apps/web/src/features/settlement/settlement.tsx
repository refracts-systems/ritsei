import { useNavigate } from "@solidjs/router"
import { createMemo, For, Show, useContext } from "solid-js"
import { formText as text, isDate, today } from "../../shared/form-values.ts"
import { type Names, namesFrom } from "../../shared/party-names.ts"
import { QueryBoundary, reloaded } from "../../shared/request-feedback.tsx"
import { createPartyDirectoryQuery } from "../../shared/lookups.ts"
import { ApiRuntime } from "../../shared/runtime.ts"
import { formatDecimal } from "../../ui/foundations/format.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { DataTable } from "../../ui/patterns/data-table.tsx"
import { EntityWorkspace } from "../../ui/patterns/entity-workspace.tsx"
import { Badge } from "../../ui/primitives/badge.tsx"
import { Button } from "../../ui/primitives/button.tsx"
import { FormField } from "../../ui/primitives/form-field.tsx"
import { Form } from "../../ui/primitives/form.tsx"
import { Input } from "../../ui/primitives/input.tsx"
import { Reference } from "../../ui/primitives/reference.tsx"
import { Select } from "../../ui/primitives/select.tsx"
import { surface } from "../../ui/recipes/surface.ts"
import type { PartyDirectoryEntry } from "../../shared/contracts/generated/party.ts"
import {
  createAgingQuery,
  createDocumentNumbersQuery,
  createLegalEntitiesQuery,
  createPaymentsQuery,
  createStatementQuery,
} from "./queries.ts"
import type { PaymentDirection, Payment, SettlementSide } from "./service.ts"

const directionOptions = [
  { value: "incoming", label: "Received from customers" },
  { value: "outgoing", label: "Paid to suppliers" },
]

const monthStart = () => `${today().slice(0, 8)}01`

const sideOf = (direction: PaymentDirection): SettlementSide =>
  direction === "incoming" ? "receivable" : "payable"

export interface SettlementRoute {
  readonly selectedPaymentId?: string | undefined
  readonly legalEntityId?: string | undefined
  readonly direction?: PaymentDirection | undefined
  readonly asOf?: string | undefined
  readonly statementPartyId?: string | undefined
  readonly from?: string | undefined
  readonly to?: string | undefined
}

const searchOf = (route: {
  legalEntityId: string
  direction: PaymentDirection
  asOf: string
  statementPartyId?: string | undefined
  from?: string | undefined
  to?: string | undefined
}) => {
  const query = new URLSearchParams({
    legalEntityId: route.legalEntityId,
    direction: route.direction,
    asOf: route.asOf,
  })

  if (route.statementPartyId !== undefined) query.set("statementPartyId", route.statementPartyId)

  if (route.from !== undefined) query.set("from", route.from)

  if (route.to !== undefined) query.set("to", route.to)

  return query
}

function SettlementFilters(props: {
  names: Names
  legalEntities: readonly { readonly legalEntityId: string }[]
  legalEntityId: string
  direction: PaymentDirection
  asOf: string
}) {
  const navigate = useNavigate()

  return (
    <Form
      class={layout.row}
      aria-label="Payment filters"
      onSubmit={(value) => {
        const asOf = text(value.asOf)
        navigate(
          `/settlement?${searchOf({
            legalEntityId: text(value.legalEntityId),
            direction: value.direction === "outgoing" ? "outgoing" : "incoming",
            asOf: isDate(asOf) ? asOf : today(),
          })}`,
        )
      }}
    >
      <FormField label="Legal entity">
        {(fieldProps) => (
          <Select
            {...fieldProps}
            name="legalEntityId"
            options={props.legalEntities.map((entity) => ({
              value: entity.legalEntityId,
              label: props.names.legalEntities.get(entity.legalEntityId) ?? entity.legalEntityId,
            }))}
            value={props.legalEntityId}
          />
        )}
      </FormField>
      <FormField label="Payments">
        {(fieldProps) => (
          <Select
            {...fieldProps}
            name="direction"
            options={directionOptions}
            value={props.direction}
          />
        )}
      </FormField>
      <FormField label="Aging as of">
        {(fieldProps) => <Input {...fieldProps} name="asOf" type="date" value={props.asOf} />}
      </FormField>
      <Button variant="primary" type="submit">
        Apply filters
      </Button>
    </Form>
  )
}

const allocationStatus = (payment: Payment) => {
  if (Number(payment.unallocatedAmount) === 0)
    return { label: "Allocated", tone: "success" } as const

  if (payment.unallocatedAmount === payment.amount) {
    return { label: "Unallocated", tone: "warning" } as const
  }

  return { label: "Partly allocated", tone: "info" } as const
}

function PaymentTable(props: {
  names: Names
  payments: readonly Payment[]
  route: { legalEntityId: string; direction: PaymentDirection; asOf: string }
  selectedPaymentId?: string | undefined
}) {
  return (
    <DataTable
      surface={false}
      caption="Payments in this legal entity"
      rows={props.payments}
      getRowId={(payment) => payment.id}
      getRowClass={(payment) =>
        payment.id === props.selectedPaymentId ? layout.tableRowSelected : undefined
      }
      columns={[
        {
          id: "number",
          header: "Number",
          rowHeader: true,
          cell: (payment) => (
            <a
              class={layout.rowReference}
              href={`/settlement/${encodeURIComponent(payment.id)}?${searchOf(props.route)}`}
            >
              {payment.number}
            </a>
          ),
        },
        { id: "date", header: "Date", cell: (payment) => payment.paymentDate },
        {
          id: "party",
          header: props.route.direction === "incoming" ? "Customer" : "Supplier",
          cell: (payment) => (
            <Reference id={payment.partyId} label={props.names.parties.get(payment.partyId)} />
          ),
        },
        {
          id: "amount",
          header: "Amount",
          align: "end",
          cell: (payment) => formatDecimal(payment.amount),
        },
        {
          id: "unallocated",
          header: "Unallocated",
          align: "end",
          cell: (payment) => formatDecimal(payment.unallocatedAmount),
        },
        {
          id: "status",
          header: "Status",
          cell: (payment) => {
            const status = allocationStatus(payment)

            return <Badge tone={status.tone}>{status.label}</Badge>
          },
        },
      ]}
    />
  )
}

function PaymentDetail(props: {
  names: Names
  payment: Payment
  numbers: ReadonlyMap<string, string>
}) {
  return (
    <section class={layout.stack} aria-labelledby="settlement-payment-heading">
      <h2 id="settlement-payment-heading">Payment {props.payment.number}</h2>
      <dl class={layout.detailList}>
        <div class={layout.detailItem}>
          <dt class={layout.detailTerm}>
            {props.payment.direction === "incoming" ? "Received from" : "Paid to"}
          </dt>
          <dd class={layout.detailValue}>
            <Reference
              id={props.payment.partyId}
              label={props.names.parties.get(props.payment.partyId)}
            />
          </dd>
        </div>
        <div class={layout.detailItem}>
          <dt class={layout.detailTerm}>Date</dt>
          <dd class={layout.detailValue}>{props.payment.paymentDate}</dd>
        </div>
        <div class={layout.detailItem}>
          <dt class={layout.detailTerm}>Amount</dt>
          <dd class={[layout.detailValue, layout.numeric]}>
            {formatDecimal(props.payment.amount)}
          </dd>
        </div>
        <div class={layout.detailItem}>
          <dt class={layout.detailTerm}>Unallocated</dt>
          <dd class={[layout.detailValue, layout.numeric]}>
            {formatDecimal(props.payment.unallocatedAmount)}
          </dd>
        </div>
      </dl>
      <section class={[surface(), layout.stack]} aria-labelledby="settlement-allocations-heading">
        <h3 id="settlement-allocations-heading">Settled documents</h3>
        <Show
          when={props.payment.allocations.length > 0}
          fallback={<p role="status">This payment is not allocated to any document yet.</p>}
        >
          <div class={layout.scroll} tabindex="0" role="region" aria-label="Settled documents">
            <table>
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                <For each={props.payment.allocations}>
                  {(allocation) => (
                    <tr>
                      <th scope="row">
                        <a href={`/billing/${encodeURIComponent(allocation.invoiceId)}`}>
                          {props.numbers.get(allocation.invoiceId) ?? allocation.invoiceId}
                        </a>
                      </th>
                      <td class={layout.numeric}>{formatDecimal(allocation.amount)}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </section>
    </section>
  )
}

const agingColumns = [
  { id: "current", header: "Current" },
  { id: "days1To30", header: "1–30 days" },
  { id: "days31To60", header: "31–60 days" },
  { id: "days61To90", header: "61–90 days" },
  { id: "over90", header: "Over 90 days" },
  { id: "unapplied", header: "Unapplied" },
  { id: "total", header: "Total" },
] as const

function AgingSection(props: {
  names: Names
  legalEntityId: string
  side: SettlementSide
  asOf: string
}) {
  const scope = useContext(ApiRuntime)

  const query = createAgingQuery(scope, {
    legalEntityId: props.legalEntityId,
    side: props.side,
    asOf: props.asOf,
  })

  return (
    <section class={[surface(), layout.stack]} aria-labelledby="settlement-aging-heading">
      <h2 id="settlement-aging-heading">
        {props.side === "receivable" ? "Receivables" : "Payables"} aging as of {props.asOf}
      </h2>
      <QueryBoundary label="aging" retry={() => reloaded(query.refetch())}>
        <Show
          when={query.data.rows.length > 0}
          fallback={<p role="status">Nothing is open on this side as of this date.</p>}
        >
          <div class={layout.scroll} tabindex="0" role="region" aria-label="Aging by customer">
            <table>
              <caption>Open amounts by age, in the legal entity currency</caption>
              <thead>
                <tr>
                  <th scope="col">{props.side === "receivable" ? "Customer" : "Supplier"}</th>
                  <For each={agingColumns}>
                    {(column) => (
                      <th scope="col" class={layout.numeric}>
                        {column.header}
                      </th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={query.data.rows}>
                  {(row) => (
                    <tr>
                      <th scope="row">
                        <Reference id={row.partyId} label={props.names.parties.get(row.partyId)} />
                      </th>
                      <For each={agingColumns}>
                        {(column) => (
                          <td class={layout.numeric}>{formatDecimal(row[column.id])}</td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <For each={agingColumns}>
                    {(column) => (
                      <td class={layout.numeric}>{formatDecimal(query.data.totals[column.id])}</td>
                    )}
                  </For>
                </tr>
              </tfoot>
            </table>
          </div>
        </Show>
      </QueryBoundary>
    </section>
  )
}

const statementKinds = {
  invoice: "Invoice",
  credit_note: "Credit note",
  payment: "Payment",
} as const

function StatementTable(props: {
  names: Names
  legalEntityId: string
  partyId: string
  from: string
  to: string
}) {
  const scope = useContext(ApiRuntime)

  const query = createStatementQuery(scope, {
    legalEntityId: props.legalEntityId,
    partyId: props.partyId,
    from: props.from,
    to: props.to,
  })

  return (
    <QueryBoundary label="statement" retry={() => reloaded(query.refetch())}>
      <div class={layout.scroll} tabindex="0" role="region" aria-label="Customer statement entries">
        <table>
          <caption>
            Statement for {props.names.parties.get(props.partyId) ?? props.partyId}, {props.from} to{" "}
            {props.to}
          </caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Document</th>
              <th scope="col">Type</th>
              <th scope="col" class={layout.numeric}>
                Amount
              </th>
              <th scope="col" class={layout.numeric}>
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" colspan={4}>
                Opening balance
              </th>
              <td class={layout.numeric}>{formatDecimal(query.data.openingBalance)}</td>
            </tr>
            <For each={query.data.entries}>
              {(entry) => (
                <tr>
                  <td>{entry.date}</td>
                  <td>{entry.number}</td>
                  <td>{statementKinds[entry.kind]}</td>
                  <td class={layout.numeric}>{formatDecimal(entry.amount)}</td>
                  <td class={layout.numeric}>{formatDecimal(entry.balance)}</td>
                </tr>
              )}
            </For>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colspan={4}>
                Closing balance
              </th>
              <td class={layout.numeric}>{formatDecimal(query.data.closingBalance)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </QueryBoundary>
  )
}

function StatementSection(props: {
  names: Names
  directory: readonly PartyDirectoryEntry[]
  route: SettlementRoute & { legalEntityId: string; direction: PaymentDirection; asOf: string }
}) {
  const navigate = useNavigate()
  const from = () => props.route.from ?? monthStart()
  const to = () => props.route.to ?? today()

  return (
    <section class={[surface(), layout.stack]} aria-labelledby="settlement-statement-heading">
      <h2 id="settlement-statement-heading">Customer statement</h2>
      <Form
        class={layout.row}
        aria-label="Statement"
        onSubmit={(value) => {
          const partyId = text(value.statementPartyId)
          const fromDate = text(value.from)
          const toDate = text(value.to)

          if (partyId === "" || !isDate(fromDate) || !isDate(toDate)) return
          navigate(
            `/settlement?${searchOf({
              ...props.route,
              statementPartyId: partyId,
              from: fromDate,
              to: toDate,
            })}`,
          )
        }}
      >
        <FormField label="Customer">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              name="statementPartyId"
              placeholder="Choose a customer"
              options={props.directory.map((entry) => ({
                value: entry.party.id,
                label: entry.party.name,
              }))}
              value={props.route.statementPartyId ?? ""}
              required
            />
          )}
        </FormField>
        <FormField label="From">
          {(fieldProps) => (
            <Input {...fieldProps} name="from" type="date" value={from()} required />
          )}
        </FormField>
        <FormField label="To">
          {(fieldProps) => <Input {...fieldProps} name="to" type="date" value={to()} required />}
        </FormField>
        <Button type="submit">Show statement</Button>
      </Form>
      <Show
        when={props.route.statementPartyId}
        fallback={<p role="status">Choose a customer to see what they were billed and paid.</p>}
      >
        {(partyId) => (
          <StatementTable
            names={props.names}
            legalEntityId={props.route.legalEntityId}
            partyId={partyId()}
            from={from()}
            to={to()}
          />
        )}
      </Show>
    </section>
  )
}

type WorkspaceRoute = SettlementRoute & {
  legalEntityId: string
  direction: PaymentDirection
  asOf: string
}

function PaymentRegister(props: { names: Names; route: WorkspaceRoute }) {
  const scope = useContext(ApiRuntime)

  const payments = createPaymentsQuery(scope, {
    legalEntityId: props.route.legalEntityId,
    direction: props.route.direction,
  })

  return (
    <section class={[surface(), layout.stack]} aria-labelledby="settlement-payments-heading">
      <h2 id="settlement-payments-heading">Payment register</h2>
      <QueryBoundary label="payments" retry={() => reloaded(payments.refetch())}>
        <Show
          when={payments.data.length > 0}
          fallback={
            <div class={layout.emptyCollection} role="status">
              <p>
                No payments {props.route.direction === "incoming" ? "received" : "made"} in this
                legal entity yet.
              </p>
              <p>
                Record a payment from an open document in <a href="/billing">Billing</a>.
              </p>
            </div>
          }
        >
          <PaymentTable
            names={props.names}
            payments={payments.data}
            route={props.route}
            selectedPaymentId={props.route.selectedPaymentId}
          />
        </Show>
      </QueryBoundary>
    </section>
  )
}

function SelectedPayment(props: { names: Names; route: WorkspaceRoute }) {
  const scope = useContext(ApiRuntime)

  const payments = createPaymentsQuery(scope, {
    legalEntityId: props.route.legalEntityId,
    direction: props.route.direction,
  })

  const numbersQuery = createDocumentNumbersQuery(scope, {
    legalEntityId: props.route.legalEntityId,
    side: sideOf(props.route.direction),
  })

  const numbers = createMemo(() => new Map(numbersQuery.data.map((item) => [item.id, item.number])))

  const selected = () =>
    payments.data.find((payment) => payment.id === props.route.selectedPaymentId)

  return (
    <QueryBoundary label="payment" retry={() => reloaded(payments.refetch())}>
      <Show
        when={selected()}
        fallback={<p role="status">This payment is not in the current register.</p>}
      >
        {(payment) => <PaymentDetail names={props.names} payment={payment()} numbers={numbers()} />}
      </Show>
    </QueryBoundary>
  )
}

function PaymentsWorkspace(props: {
  names: Names
  directory: readonly PartyDirectoryEntry[]
  legalEntities: readonly { readonly legalEntityId: string }[]
  route: WorkspaceRoute
}) {
  return (
    <EntityWorkspace
      title="Payments"
      description={
        <p>
          Money received from customers and paid to suppliers, how each payment was allocated, and
          what is still outstanding by age.
        </p>
      }
      toolbar={
        <SettlementFilters
          names={props.names}
          legalEntities={props.legalEntities}
          legalEntityId={props.route.legalEntityId}
          direction={props.route.direction}
          asOf={props.route.asOf}
        />
      }
      aside={
        props.route.selectedPaymentId === undefined ? undefined : (
          <SelectedPayment names={props.names} route={props.route} />
        )
      }
    >
      <PaymentRegister names={props.names} route={props.route} />
      <AgingSection
        names={props.names}
        legalEntityId={props.route.legalEntityId}
        side={sideOf(props.route.direction)}
        asOf={props.route.asOf}
      />
      <Show when={props.route.direction === "incoming"}>
        <StatementSection names={props.names} directory={props.directory} route={props.route} />
      </Show>
    </EntityWorkspace>
  )
}

export function Settlement(props: SettlementRoute) {
  const scope = useContext(ApiRuntime)
  const entities = createLegalEntitiesQuery(scope)
  const directory = createPartyDirectoryQuery(scope)
  const names = createMemo(() => namesFrom(directory.data))

  return (
    <QueryBoundary label="legal entities" retry={() => reloaded(entities.refetch())}>
      <Show
        when={entities.data[0]}
        fallback={
          <EntityWorkspace title="Payments" description={<p>Payments, aging, and statements.</p>}>
            <div class={layout.emptyCollection} role="status">
              <p>No legal entity is configured for accounting yet.</p>
              <p>
                Payments belong to a legal entity.{" "}
                <a href="/accounting">Configure one in Accounting</a>.
              </p>
            </div>
          </EntityWorkspace>
        }
      >
        {(first) => (
          <QueryBoundary label="payments" retry={() => reloaded(entities.refetch())}>
            <PaymentsWorkspace
              names={names()}
              directory={directory.data}
              legalEntities={entities.data}
              route={{
                ...props,
                legalEntityId: props.legalEntityId ?? first().legalEntityId,
                direction: props.direction ?? "incoming",
                asOf: props.asOf ?? today(),
              }}
            />
          </QueryBoundary>
        )}
      </Show>
    </QueryBoundary>
  )
}
