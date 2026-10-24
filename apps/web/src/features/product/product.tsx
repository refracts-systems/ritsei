import * as Match from "effect/Match"
import * as Predicate from "effect/Predicate"
import { createSignal, Show, useContext } from "solid-js"
import { CommandFeedback, QueryBoundary, reloaded } from "../../shared/request-feedback.tsx"
import { ApiRuntime } from "../../shared/runtime.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { DataTable } from "../../ui/patterns/data-table.tsx"
import { Button } from "../../ui/primitives/button.tsx"
import { createDialogOpenChange, Dialog } from "../../ui/primitives/dialog.tsx"
import { FormField } from "../../ui/primitives/form-field.tsx"
import { Form, type FormValue } from "../../ui/primitives/form.tsx"
import { Input } from "../../ui/primitives/input.tsx"
import { Select } from "../../ui/primitives/select.tsx"
import { createProductMutation, createProductsQuery } from "./queries.ts"
import type { Product } from "./service.ts"

const typeLabels = {
  stockable: "Stockable",
  consumable: "Consumable",
  service: "Service",
} as const

const typeOptions = Object.entries(typeLabels).map(([value, label]) => ({ value, label }))

const text = (value: FormValue[string] | undefined) =>
  Predicate.isString(value) ? value.trim() : ""

/** The selected product type; anything else falls back to stockable, the form default. */
const productTypeOf = (value: string) =>
  Match.value(value).pipe(
    Match.when("consumable", () => "consumable" as const),
    Match.when("service", () => "service" as const),
    Match.orElse(() => "stockable" as const),
  )

/** The create payload, or undefined when the code or name is missing. */
const productPayload = (value: FormValue) => {
  const payload = {
    code: text(value.code).toUpperCase(),
    name: text(value.name),
    type: productTypeOf(text(value.type)),
  }

  return payload.code !== "" && payload.name !== "" ? payload : undefined
}

function ProductTable(props: { records: readonly Product[] }) {
  return (
    <DataTable
      surface={false}
      tableClass={layout.collectionTable}
      caption="Products in this tenant"
      rows={props.records}
      columns={[
        {
          id: "code",
          header: "Code",
          rowHeader: true,
          cell: (record) => <span class={layout.rowReference}>{record.code}</span>,
        },
        { id: "name", header: "Name", cell: (record) => record.name },
        { id: "type", header: "Type", cell: (record) => typeLabels[record.type] },
        { id: "unit", header: "Unit", cell: (record) => record.unitOfMeasure },
      ]}
    />
  )
}

function CreateProductDialog(props: { reload: () => Promise<void> }) {
  const scope = useContext(ApiRuntime)
  const [open, setOpen] = createSignal(false)
  const [invalid, setInvalid] = createSignal(false)
  let formElement: HTMLFormElement | undefined

  const mutation = createProductMutation(scope, () => {
    formElement?.reset()
    setOpen(false)
  })

  return (
    <Dialog
      open={open()}
      onOpenChange={createDialogOpenChange(mutation, setOpen, setInvalid)}
      trigger={<span>Create product</span>}
      triggerVariant="primary"
      title="Create product"
      description="Codes are unique within this tenant. Stockable products keep stock in Inventory."
    >
      <Form
        ref={(element) => {
          formElement = element
        }}
        class={layout.stack}
        onSubmit={(value) => {
          const payload = productPayload(value)
          setInvalid(payload === undefined)

          if (payload !== undefined && !mutation.isPending) mutation.mutate(payload)
        }}
      >
        <FormField label="Code" required error={invalid() ? "Enter a code and a name." : undefined}>
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
        <FormField label="Type" required>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              name="type"
              options={typeOptions}
              value="stockable"
              required
              disabled={mutation.isPending}
            />
          )}
        </FormField>
        <CommandFeedback
          error={mutation.error}
          pending={mutation.isPending}
          success={mutation.isSuccess}
          successMessage="Product created."
          area="product"
          reload={props.reload}
          reset={() => mutation.reset()}
        />
        <Button variant="primary" type="submit" loading={mutation.isPending}>
          Create product
        </Button>
      </Form>
    </Dialog>
  )
}

export function Products() {
  const scope = useContext(ApiRuntime)
  const query = createProductsQuery(scope)

  return (
    <section class={layout.stack} aria-label="Products">
      <header class={layout.workspaceHeading}>
        <div class={layout.workspaceTitle}>
          <h1>Products</h1>
          <p class={layout.workspaceDescription}>
            Goods and services that sales, purchasing, billing, and inventory share.
          </p>
        </div>
        <CreateProductDialog reload={() => reloaded(query.refetch())} />
      </header>
      <QueryBoundary label="products" retry={() => reloaded(query.refetch())}>
        <Show
          when={query.data.length > 0}
          fallback={
            <div class={layout.emptyCollection} role="status">
              <p>No products yet.</p>
            </div>
          }
        >
          <ProductTable records={query.data} />
        </Show>
      </QueryBoundary>
    </section>
  )
}
