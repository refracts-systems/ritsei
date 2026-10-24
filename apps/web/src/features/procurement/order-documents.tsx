import { createSignal, For, Show, useContext } from "solid-js"
import { today } from "../../shared/form-values.ts"
import { createProductsQuery, createWarehousesQuery } from "../../shared/lookups.ts"
import { CommandFeedback, QueryBoundary, reloaded } from "../../shared/request-feedback.tsx"
import { ApiRuntime } from "../../shared/runtime.ts"
import { formatDecimal } from "../../ui/foundations/format.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { Button } from "../../ui/primitives/button.tsx"
import { Dialog } from "../../ui/primitives/dialog.tsx"
import { FormField } from "../../ui/primitives/form-field.tsx"
import { Form } from "../../ui/primitives/form.tsx"
import { Input } from "../../ui/primitives/input.tsx"
import { Select } from "../../ui/primitives/select.tsx"
import { surface } from "../../ui/recipes/surface.ts"
import { receivable, returnable, stockPayload } from "./documents-payloads.ts"
import {
  createPurchaseMatchingQuery,
  createReleaseMutation,
  createStockMutation,
} from "./documents-queries.ts"
import { type PurchaseMatching, releaseFailureMessages, stockFailureMessages } from "./documents.ts"

type Kind = "receipt" | "return"

type Line = PurchaseMatching["lines"][number]

const copy = {
  receipt: {
    action: "Receive goods",
    title: "Receive goods",
    description:
      "Receive some or all of what is still to come. Stock is valued at the order price.",
    noun: "left to receive",
    success: "Goods received.",
    limit: receivable,
  },
  return: {
    action: "Return to supplier",
    title: "Return to supplier",
    description: "Send back goods that were received. Stock leaves at its recorded cost.",
    noun: "can be returned",
    success: "Return recorded.",
    limit: returnable,
  },
} as const satisfies Record<
  Kind,
  {
    action: string
    title: string
    description: string
    noun: string
    success: string
    limit: (line: Line) => number
  }
>

function StockForm(props: {
  kind: Kind
  matching: PurchaseMatching
  productName: (id: string) => string | undefined
  close: () => void
  reload: () => Promise<void>
}) {
  const scope = useContext(ApiRuntime)
  const warehouses = createWarehousesQuery(scope)
  const [invalid, setInvalid] = createSignal(false)
  const mutation = createStockMutation(scope, props.kind, props.close)
  const words = () => copy[props.kind]

  return (
    <Form
      class={layout.stack}
      onSubmit={(value) => {
        const payload = stockPayload(value, props.matching, words().limit)
        setInvalid(payload === undefined)

        if (payload !== undefined && !mutation.isPending) mutation.mutate(payload)
      }}
    >
      <FormField
        label="Warehouse"
        required
        error={
          invalid()
            ? "Choose a warehouse and a date, and move at least one unit, never more than the limit shown."
            : undefined
        }
      >
        {(fieldProps) => (
          <Select
            {...fieldProps}
            name="warehouseId"
            placeholder="Choose warehouse"
            options={warehouses.data.map((warehouse) => ({
              value: warehouse.id,
              label: warehouse.name,
            }))}
            required
            disabled={mutation.isPending}
          />
        )}
      </FormField>
      <FormField label="Date" required>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            name="date"
            type="date"
            value={today()}
            required
            disabled={mutation.isPending}
          />
        )}
      </FormField>
      <For each={props.matching.lines.filter((line) => words().limit(line) > 0)}>
        {(line) => (
          <FormField
            label={`${props.productName(line.productId) ?? line.productId} (${words().limit(line)} ${words().noun})`}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                name={`quantity-${line.purchaseOrderLineId}`}
                inputmode="numeric"
                autocomplete="off"
                value={String(words().limit(line))}
                disabled={mutation.isPending}
              />
            )}
          </FormField>
        )}
      </For>
      <CommandFeedback
        error={mutation.error}
        messages={stockFailureMessages}
        pending={mutation.isPending}
        success={mutation.isSuccess}
        successMessage={words().success}
        area="purchase order"
        reload={props.reload}
        reset={() => mutation.reset()}
      />
      <Button variant="primary" type="submit" loading={mutation.isPending}>
        {words().action}
      </Button>
    </Form>
  )
}

function StockDialog(props: {
  kind: Kind
  matching: PurchaseMatching
  productName: (id: string) => string | undefined
  reload: () => Promise<void>
}) {
  const [open, setOpen] = createSignal(false)

  return (
    <Dialog
      open={open()}
      onOpenChange={setOpen}
      trigger={<span>{copy[props.kind].action}</span>}
      triggerVariant={props.kind === "receipt" ? "primary" : "secondary"}
      title={copy[props.kind].title}
      description={copy[props.kind].description}
    >
      <QueryBoundary label="warehouses" retry={props.reload}>
        <StockForm
          kind={props.kind}
          matching={props.matching}
          productName={props.productName}
          close={() => setOpen(false)}
          reload={props.reload}
        />
      </QueryBoundary>
    </Dialog>
  )
}

function ReleaseButton(props: { id: string; reload: () => Promise<void> }) {
  const scope = useContext(ApiRuntime)
  const mutation = createReleaseMutation(scope, props.id)

  return (
    <div class={layout.stack}>
      <Button
        type="button"
        variant="primary"
        loading={mutation.isPending}
        onClick={() => {
          if (!mutation.isPending) mutation.mutate()
        }}
      >
        Release purchase order
      </Button>
      <CommandFeedback
        error={mutation.error}
        messages={releaseFailureMessages}
        pending={mutation.isPending}
        success={mutation.isSuccess}
        successMessage="Purchase order released."
        area="purchase order"
        reload={props.reload}
        reset={() => mutation.reset()}
      />
    </div>
  )
}

/** Ordered, received, and returned quantities, and the steps the order's status allows. */
export function OrderDocuments(props: { id: string; reloadOrder: () => Promise<void> }) {
  const scope = useContext(ApiRuntime)
  const query = createPurchaseMatchingQuery(scope, props.id)
  const products = createProductsQuery(scope)
  const productName = (id: string) => products.data.find((product) => product.id === id)?.name
  const reload = () => reloaded(Promise.all([query.refetch(), props.reloadOrder()]))

  return (
    <section class={[surface(), layout.stack]} aria-labelledby="procurement-matching-heading">
      <h3 id="procurement-matching-heading">Receiving</h3>
      <QueryBoundary label="receiving progress" retry={() => reloaded(query.refetch())}>
        <Show when={query.data} keyed>
          {(matching) => (
            <div class={layout.stack}>
              <div class={layout.scroll} tabindex="0" role="region" aria-label="Receiving progress">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col" class={layout.numeric}>
                        Ordered
                      </th>
                      <th scope="col" class={layout.numeric}>
                        Received
                      </th>
                      <th scope="col" class={layout.numeric}>
                        Returned
                      </th>
                      <th scope="col" class={layout.numeric}>
                        Unit price
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={matching.lines}>
                      {(line) => (
                        <tr>
                          <th scope="row">{productName(line.productId) ?? line.productId}</th>
                          <td class={layout.numeric}>{line.ordered}</td>
                          <td class={layout.numeric}>{line.received}</td>
                          <td class={layout.numeric}>{line.returned}</td>
                          <td class={layout.numeric}>{formatDecimal(line.unitPrice)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
              <div class={layout.row}>
                <Show when={matching.status === "draft"}>
                  <ReleaseButton id={matching.purchaseOrderId} reload={reload} />
                </Show>
                <Show when={matching.status === "confirmed"}>
                  <Show
                    when={matching.lines.some((line) => receivable(line) > 0)}
                    fallback={<p role="status">Everything ordered has been received.</p>}
                  >
                    <StockDialog
                      kind="receipt"
                      matching={matching}
                      productName={productName}
                      reload={reload}
                    />
                  </Show>
                  <Show when={matching.lines.some((line) => returnable(line) > 0)}>
                    <StockDialog
                      kind="return"
                      matching={matching}
                      productName={productName}
                      reload={reload}
                    />
                  </Show>
                  <a href="/billing?side=payable">Bill received goods in Billing</a>
                </Show>
              </div>
            </div>
          )}
        </Show>
      </QueryBoundary>
    </section>
  )
}
