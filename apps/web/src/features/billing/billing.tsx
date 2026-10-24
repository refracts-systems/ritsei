import { useNavigate } from "@solidjs/router"
import * as Predicate from "effect/Predicate"
import { createMemo, For, Show, useContext } from "solid-js"
import { QueryBoundary, reloaded } from "../../shared/request-feedback.tsx"
import { ApiRuntime } from "../../shared/runtime.ts"
import { formatDecimal } from "../../ui/foundations/format.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { DataTable } from "../../ui/patterns/data-table.tsx"
import { EntityWorkspace } from "../../ui/patterns/entity-workspace.tsx"
import { Badge } from "../../ui/primitives/badge.tsx"
import { Button } from "../../ui/primitives/button.tsx"
import { FormField } from "../../ui/primitives/form-field.tsx"
import { Form, type FormValue } from "../../ui/primitives/form.tsx"
import { Reference } from "../../ui/primitives/reference.tsx"
import { Select } from "../../ui/primitives/select.tsx"
import { surface } from "../../ui/recipes/surface.ts"
import type { PartyDirectoryEntry } from "../../shared/contracts/generated/party.ts"
import {
  createBillingDocumentQuery,
  createBillingDocumentsQuery,
  createLegalEntitiesQuery,
  createPartyDirectoryQuery,
} from "./queries.ts"
import { InvoiceOrderDialog } from "./invoice-order-dialog.tsx"
import { canRecordPayment, RecordPaymentDialog } from "./record-payment-dialog.tsx"
import type { BillingDocument, BillingSide } from "./service.ts"

const sideOptions = [
  { value: "receivable", label: "Customers (receivable)" },
  { value: "payable", label: "Suppliers (payable)" },
]

const kindLabels: Record<BillingDocument["kind"], string> = {
  customer_invoice: "Invoice",
  customer_credit_note: "Credit note",
  supplier_bill: "Supplier bill",
  supplier_credit_note: "Supplier credit note",
}

const isCreditNote = (document: BillingDocument) =>
  document.kind === "customer_credit_note" || document.kind === "supplier_credit_note"

/** Whether the document still has an amount to settle; credit notes show what they can still offset. */
const isSettled = (document: BillingDocument) => Number(document.openAmount) === 0

function DocumentStatus(props: { document: BillingDocument }) {
  return (
    <Show when={!isSettled(props.document)} fallback={<Badge tone="success">Settled</Badge>}>
      <Badge tone={isCreditNote(props.document) ? "info" : "warning"}>
        {isCreditNote(props.document) ? "Unapplied" : "Open"}
      </Badge>
    </Show>
  )
}

/** Names resolved from the party directory; an unresolved id falls back to the identifier. */
interface Names {
  readonly parties: ReadonlyMap<string, string>
  readonly legalEntities: ReadonlyMap<string, string>
}

const namesFrom = (entries: readonly PartyDirectoryEntry[]): Names => ({
  parties: new Map(entries.map((entry) => [entry.party.id, entry.party.name])),
  legalEntities: new Map(
    entries.flatMap((entry) =>
      entry.legalEntityId === null ? [] : [[entry.legalEntityId, entry.party.name] as const],
    ),
  ),
})

const text = (value: FormValue[string] | undefined) =>
  Predicate.isString(value) ? value.trim() : ""

const sideOf = (value: FormValue[string] | undefined): BillingSide =>
  value === "payable" ? "payable" : "receivable"

function documentHref(id: string, legalEntityId: string, side: BillingSide) {
  return `/billing/${encodeURIComponent(id)}?${new URLSearchParams({ legalEntityId, side })}`
}

function BillingFilters(props: {
  names: Names
  legalEntities: readonly { readonly legalEntityId: string }[]
  legalEntityId: string
  side: BillingSide
}) {
  const navigate = useNavigate()

  return (
    <Form
      class={layout.row}
      aria-label="Billing filters"
      onSubmit={(value) => {
        const legalEntityId = text(value.legalEntityId)
        const query = new URLSearchParams({ side: sideOf(value.side) })

        if (legalEntityId !== "") query.set("legalEntityId", legalEntityId)
        navigate(`/billing?${query}`)
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
      <FormField label="Documents for">
        {(fieldProps) => (
          <Select {...fieldProps} name="side" options={sideOptions} value={props.side} />
        )}
      </FormField>
      <Button variant="primary" type="submit">
        Apply filters
      </Button>
    </Form>
  )
}

function DocumentTable(props: {
  names: Names
  documents: readonly BillingDocument[]
  legalEntityId: string
  side: BillingSide
  selectedDocumentId?: string | undefined
}) {
  return (
    <DataTable
      surface={false}
      caption="Billing documents in this legal entity"
      rows={props.documents}
      getRowId={(document) => document.id}
      getRowClass={(document) =>
        document.id === props.selectedDocumentId ? layout.tableRowSelected : undefined
      }
      columns={[
        {
          id: "number",
          header: "Number",
          rowHeader: true,
          cell: (document) => (
            <a
              class={layout.rowReference}
              href={documentHref(document.id, props.legalEntityId, props.side)}
            >
              {document.number}
            </a>
          ),
        },
        { id: "kind", header: "Type", cell: (document) => kindLabels[document.kind] },
        { id: "date", header: "Date", cell: (document) => document.invoiceDate },
        {
          id: "party",
          header: props.side === "receivable" ? "Customer" : "Supplier",
          cell: (document) => (
            <Reference id={document.partyId} label={props.names.parties.get(document.partyId)} />
          ),
        },
        {
          id: "total",
          header: "Total",
          align: "end",
          cell: (document) => formatDecimal(document.total),
        },
        {
          id: "open",
          header: "Open amount",
          align: "end",
          cell: (document) => formatDecimal(document.openAmount),
        },
        {
          id: "status",
          header: "Status",
          cell: (document) => <DocumentStatus document={document} />,
        },
      ]}
    />
  )
}

function DocumentDetail(props: {
  document: BillingDocument
  names: Names
  reload: () => Promise<void>
}) {
  return (
    <section class={layout.stack} aria-labelledby="billing-document-heading">
      <h2 id="billing-document-heading">
        {kindLabels[props.document.kind]} {props.document.number}
      </h2>
      <Show when={canRecordPayment(props.document)}>
        <div class={layout.actionRow}>
          <RecordPaymentDialog document={props.document} reload={props.reload} />
        </div>
      </Show>
      <dl class={layout.detailList}>
        <div class={layout.detailItem}>
          <dt class={layout.detailTerm}>Status</dt>
          <dd class={layout.detailValue}>
            <DocumentStatus document={props.document} />
          </dd>
        </div>
        <div class={layout.detailItem}>
          <dt class={layout.detailTerm}>
            {props.document.kind.startsWith("customer") ? "Customer" : "Supplier"}
          </dt>
          <dd class={layout.detailValue}>
            <Reference
              id={props.document.partyId}
              label={props.names.parties.get(props.document.partyId)}
            />
          </dd>
        </div>
        <div class={layout.detailItem}>
          <dt class={layout.detailTerm}>Date</dt>
          <dd class={layout.detailValue}>{props.document.invoiceDate}</dd>
        </div>
        <div class={layout.detailItem}>
          <dt class={layout.detailTerm}>Subtotal</dt>
          <dd class={[layout.detailValue, layout.numeric]}>
            {formatDecimal(props.document.subtotal)}
          </dd>
        </div>
        <div class={layout.detailItem}>
          <dt class={layout.detailTerm}>Tax</dt>
          <dd class={[layout.detailValue, layout.numeric]}>
            {formatDecimal(props.document.taxTotal)}
          </dd>
        </div>
        <div class={layout.detailItem}>
          <dt class={layout.detailTerm}>Total</dt>
          <dd class={[layout.detailValue, layout.numeric]}>
            {formatDecimal(props.document.total)}
          </dd>
        </div>
        <div class={layout.detailItem}>
          <dt class={layout.detailTerm}>Open amount</dt>
          <dd class={[layout.detailValue, layout.numeric]}>
            {formatDecimal(props.document.openAmount)}
          </dd>
        </div>
        <Show when={props.document.supplierReference}>
          {(reference) => (
            <div class={layout.detailItem}>
              <dt class={layout.detailTerm}>Supplier reference</dt>
              <dd class={layout.detailValue}>{reference()}</dd>
            </div>
          )}
        </Show>
        <Show when={props.document.sourceId}>
          {(sourceId) => (
            <div class={layout.detailItem}>
              <dt class={layout.detailTerm}>Created from</dt>
              <dd class={layout.detailValue}>
                {props.document.sourceType} <Reference id={sourceId()} />
              </dd>
            </div>
          )}
        </Show>
        <Show when={props.document.creditedInvoiceId}>
          {(creditedId) => (
            <div class={layout.detailItem}>
              <dt class={layout.detailTerm}>Credits</dt>
              <dd class={layout.detailValue}>
                <Reference id={creditedId()} />
              </dd>
            </div>
          )}
        </Show>
      </dl>
      <section class={[surface(), layout.stack]} aria-labelledby="billing-lines-heading">
        <h3 id="billing-lines-heading">Lines</h3>
        <Show
          when={props.document.lines.length > 0}
          fallback={<p role="status">This document has no lines.</p>}
        >
          <div class={layout.scroll}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Description</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Net</th>
                  <th scope="col">Tax</th>
                </tr>
              </thead>
              <tbody>
                <For each={props.document.lines}>
                  {(line) => (
                    <tr>
                      <th scope="row">{line.description}</th>
                      <td class={layout.numeric}>{line.quantity}</td>
                      <td class={layout.numeric}>{formatDecimal(line.netAmount)}</td>
                      <td class={layout.numeric}>{formatDecimal(line.taxAmount)}</td>
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

function SelectedDocument(props: { id: string; names: Names }) {
  const scope = useContext(ApiRuntime)
  const query = createBillingDocumentQuery(scope, props.id)

  return (
    <QueryBoundary label="document" retry={() => reloaded(query.refetch())}>
      <DocumentDetail
        document={query.data}
        names={props.names}
        reload={() => reloaded(query.refetch())}
      />
    </QueryBoundary>
  )
}

function DocumentList(props: {
  names: Names
  legalEntityId: string
  side: BillingSide
  selectedDocumentId?: string | undefined
}) {
  const scope = useContext(ApiRuntime)

  const query = createBillingDocumentsQuery(scope, {
    legalEntityId: props.legalEntityId,
    side: props.side,
  })

  return (
    <QueryBoundary label="billing documents" retry={() => reloaded(query.refetch())}>
      <Show
        when={query.data.length > 0}
        fallback={
          <div class={layout.emptyCollection} role="status">
            <p>
              No {props.side === "receivable" ? "invoices or credit notes" : "supplier bills"} in
              this legal entity yet.
            </p>
            <p>
              {props.side === "receivable"
                ? "Invoices are created from delivered sales orders."
                : "Supplier bills are created from received purchase orders."}
            </p>
          </div>
        }
      >
        <DocumentTable
          names={props.names}
          documents={query.data}
          legalEntityId={props.legalEntityId}
          side={props.side}
          selectedDocumentId={props.selectedDocumentId}
        />
      </Show>
    </QueryBoundary>
  )
}

export function Billing(props: {
  legalEntityId?: string | undefined
  side?: BillingSide | undefined
  selectedDocumentId?: string | undefined
}) {
  const scope = useContext(ApiRuntime)
  const entities = createLegalEntitiesQuery(scope)
  const directory = createPartyDirectoryQuery(scope)
  const names = createMemo(() => namesFrom(directory.data))
  const side = () => props.side ?? "receivable"

  return (
    <QueryBoundary label="legal entities" retry={() => reloaded(entities.refetch())}>
      <Show
        when={entities.data[0]}
        fallback={
          <EntityWorkspace
            title="Billing"
            description={<p>Invoices, credit notes, and supplier bills.</p>}
          >
            <div class={layout.emptyCollection} role="status">
              <p>No legal entity is configured for accounting yet.</p>
              <p>
                Billing documents belong to a legal entity.{" "}
                <a href="/accounting">Configure one in Accounting</a>.
              </p>
            </div>
          </EntityWorkspace>
        }
      >
        {(first) => {
          const legalEntityId = () => props.legalEntityId ?? first().legalEntityId

          return (
            <EntityWorkspace
              title="Billing"
              description={
                <p>
                  Posted invoices, credit notes, and supplier bills with what is still open on each.
                </p>
              }
              headerActions={<InvoiceOrderDialog />}
              toolbar={
                <BillingFilters
                  names={names()}
                  legalEntities={entities.data}
                  legalEntityId={legalEntityId()}
                  side={side()}
                />
              }
              aside={
                props.selectedDocumentId ? (
                  <SelectedDocument id={props.selectedDocumentId} names={names()} />
                ) : undefined
              }
            >
              <DocumentList
                names={names()}
                legalEntityId={legalEntityId()}
                side={side()}
                selectedDocumentId={props.selectedDocumentId}
              />
            </EntityWorkspace>
          )
        }}
      </Show>
    </QueryBoundary>
  )
}
