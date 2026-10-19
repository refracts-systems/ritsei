import { createSignal, Show, useContext } from "solid-js"
import { CommandFeedback, QueryBoundary } from "../../shared/request-feedback.tsx"
import { ApiRuntime } from "../../shared/runtime.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { DataTable } from "../../ui/patterns/data-table.tsx"
import { Button } from "../../ui/primitives/button.tsx"
import { createDialogOpenChange, Dialog } from "../../ui/primitives/dialog.tsx"
import { FormField } from "../../ui/primitives/form-field.tsx"
import { Form } from "../../ui/primitives/form.tsx"
import { Input } from "../../ui/primitives/input.tsx"
import { Select } from "../../ui/primitives/select.tsx"
import { createTaxCodeMutation, createTaxCodesQuery } from "./queries.ts"
import type { TaxCode } from "./service.ts"

const directionOptions = [
  { value: "sales", label: "Sales" },
  { value: "purchase", label: "Purchases" },
]

function TaxCodeTable(props: { records: readonly TaxCode[] }) {
  return (
    <DataTable
      surface={false}
      tableClass={layout.collectionTable}
      caption="Tax codes in this tenant"
      rows={props.records}
      columns={[
        {
          id: "code",
          header: "Code",
          rowHeader: true,
          cell: (record) => <span class={layout.rowReference}>{record.code}</span>,
        },
        { id: "name", header: "Name", cell: (record) => record.name },
        { id: "rate", header: "Rate (%)", cell: (record) => record.rate },
        {
          id: "direction",
          header: "Applies to",
          cell: (record) => (record.direction === "sales" ? "Sales" : "Purchases"),
        },
      ]}
    />
  )
}

function CreateTaxCodeDialog(props: { reload: () => Promise<unknown> }) {
  const scope = useContext(ApiRuntime)
  const [open, setOpen] = createSignal(false)
  const [invalid, setInvalid] = createSignal(false)
  let formElement: HTMLFormElement | undefined
  const mutation = createTaxCodeMutation(scope, () => {
    formElement?.reset()
    setOpen(false)
  })
  return (
    <Dialog
      open={open()}
      onOpenChange={createDialogOpenChange(mutation, setOpen, setInvalid)}
      trigger={<span>Create tax code</span>}
      triggerVariant="primary"
      title="Create tax code"
      description="Codes are unique within this tenant. Rates are percentages on tax-exclusive amounts."
    >
      <Form
        ref={(element) => {
          formElement = element
        }}
        class={layout.stack}
        onSubmit={(value) => {
          const code = typeof value.code === "string" ? value.code.trim().toUpperCase() : ""
          const name = typeof value.name === "string" ? value.name.trim() : ""
          const rate = typeof value.rate === "string" ? value.rate.trim() : ""
          const direction = value.direction === "purchase" ? "purchase" : "sales"
          const valid = code !== "" && name !== "" && /^d{1,3}(.d{1,4})?$/.test(rate)
          setInvalid(!valid)
          if (valid && !mutation.isPending) mutation.mutate({ code, name, rate, direction })
        }}
      >
        <FormField
          label="Code"
          required
          error={invalid() ? "Enter a code, a name, and a rate such as 11 or 12.5." : undefined}
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="code"
              autocomplete="off"
              required
              disabled={mutation.isPending}
            />
          )}
        </FormField>
        <FormField label="Rate (%)" required>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="rate"
              inputmode="decimal"
              required
              disabled={mutation.isPending}
            />
          )}
        </FormField>
        <FormField label="Applies to" required>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              name="direction"
              options={directionOptions}
              value="sales"
              required
              disabled={mutation.isPending}
            />
          )}
        </FormField>
        <FormField label="Name" required>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="name"
              autocomplete="off"
              required
              disabled={mutation.isPending}
            />
          )}
        </FormField>
        <CommandFeedback
          error={mutation.error}
          pending={mutation.isPending}
          success={mutation.isSuccess}
          successMessage="Tax code created."
          area="tax"
          reload={props.reload}
          reset={() => mutation.reset()}
        />
        <Button variant="primary" type="submit" loading={mutation.isPending}>
          Create tax code
        </Button>
      </Form>
    </Dialog>
  )
}

export function Tax() {
  const scope = useContext(ApiRuntime)
  const query = createTaxCodesQuery(scope)
  return (
    <section class={layout.stack} aria-label="Tax">
      <header class={layout.workspaceHeading}>
        <div class={layout.workspaceTitle}>
          <h1>Tax</h1>
          <p class={layout.workspaceDescription}>Tax codes recorded in this tenant.</p>
        </div>
        <CreateTaxCodeDialog reload={() => query.refetch()} />
      </header>
      <QueryBoundary label="tax codes" retry={() => query.refetch()}>
        <Show
          when={query.data.length > 0}
          fallback={
            <div class={layout.emptyCollection} role="status">
              <p>No tax codes yet.</p>
            </div>
          }
        >
          <TaxCodeTable records={query.data} />
        </Show>
      </QueryBoundary>
    </section>
  )
}
