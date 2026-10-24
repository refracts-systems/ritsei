import { useNavigate } from "@solidjs/router"
import { createSignal, For, Show, useContext } from "solid-js"
import { today } from "../../shared/form-values.ts"
import { createProductsQuery } from "../../shared/lookups.ts"
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
import { billableQuantity, billPayload } from "./payloads.ts"
import {
  createBillMutation,
  createOrderMatchingQuery,
  createReleasedOrdersQuery,
} from "./queries.ts"
import { billFailureMessages } from "./service.ts"

function BillForm(props: { orderId: string; close: () => void; onCreated: (id: string) => void }) {
  const scope = useContext(ApiRuntime)
  const matching = createOrderMatchingQuery(scope, props.orderId)
  const products = createProductsQuery(scope)
  const [invalid, setInvalid] = createSignal(false)
  const productName = (id: string) => products.data.find((product) => product.id === id)?.name

  const mutation = createBillMutation(scope, (id) => {
    props.close()
    props.onCreated(id)
  })

  return (
    <Form
      class={layout.stack}
      aria-label="Supplier bill"
      onSubmit={(value) => {
        const payload = billPayload(value, matching.data)
        setInvalid(payload === undefined)

        if (payload !== undefined && !mutation.isPending) mutation.mutate(payload)
      }}
    >
      <FormField
        label="Supplier reference"
        required
        error={
          invalid()
            ? "Enter the supplier's invoice number and a date, and bill at least one line with a whole quantity and a price such as 6.00."
            : undefined
        }
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            name="supplierReference"
            autocomplete="off"
            required
            disabled={mutation.isPending}
          />
        )}
      </FormField>
      <FormField label="Bill date" required>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            name="billDate"
            type="date"
            value={today()}
            required
            disabled={mutation.isPending}
          />
        )}
      </FormField>
      <For each={matching.data.lines}>
        {(line) => (
          <div class={layout.row}>
            <FormField
              label={`${productName(line.productId) ?? line.productId} (${billableQuantity(line)} received)`}
            >
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  name={`quantity-${line.purchaseOrderLineId}`}
                  inputmode="numeric"
                  autocomplete="off"
                  value={String(billableQuantity(line))}
                  disabled={mutation.isPending}
                />
              )}
            </FormField>
            <FormField label={`Unit price (${formatDecimal(line.unitPrice)} ordered)`}>
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  name={`unitPrice-${line.purchaseOrderLineId}`}
                  inputmode="decimal"
                  autocomplete="off"
                  value={line.unitPrice}
                  disabled={mutation.isPending}
                />
              )}
            </FormField>
          </div>
        )}
      </For>
      <p class={layout.muted}>
        The bill is matched against what was ordered and received. A price different from the order
        posts the difference as a purchase price variance.
      </p>
      <CommandFeedback
        error={mutation.error}
        messages={billFailureMessages}
        pending={mutation.isPending}
        success={mutation.isSuccess}
        successMessage="Supplier bill created."
        area="billing"
        reload={() => reloaded(matching.refetch())}
        reset={() => mutation.reset()}
      />
      <Button variant="primary" type="submit" loading={mutation.isPending}>
        Create supplier bill
      </Button>
    </Form>
  )
}

function OrderPicker(props: { close: () => void; onCreated: (id: string) => void }) {
  const scope = useContext(ApiRuntime)
  const orders = createReleasedOrdersQuery(scope)
  const [orderId, setOrderId] = createSignal("")

  return (
    <div class={layout.stack}>
      <Show
        when={orders.data.length > 0}
        fallback={
          <p role="status">
            There are no released purchase orders. Release an order and receive goods before
            billing.
          </p>
        }
      >
        <FormField label="Purchase order" required>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              placeholder="Choose a released order"
              options={orders.data.map((order) => ({
                value: order.id,
                label: `${formatDecimal(order.total)} · ${order.id.slice(0, 8)}`,
              }))}
              onChange={(event) => setOrderId(event.currentTarget.value)}
              required
            />
          )}
        </FormField>
        <Show when={orderId()} keyed>
          {(id) => (
            <QueryBoundary label="order lines" retry={() => reloaded(orders.refetch())}>
              <BillForm orderId={id} close={props.close} onCreated={props.onCreated} />
            </QueryBoundary>
          )}
        </Show>
      </Show>
    </div>
  )
}

/** Creates a supplier bill from a released purchase order, matched against what was received. */
export function SupplierBillDialog() {
  const navigate = useNavigate()
  const [open, setOpen] = createSignal(false)

  return (
    <Dialog
      open={open()}
      onOpenChange={setOpen}
      trigger={<span>Create supplier bill</span>}
      triggerVariant="primary"
      title="Create supplier bill"
      description="Bill received goods against a released purchase order (three-way match)."
    >
      <QueryBoundary label="purchase orders" retry={() => Promise.resolve()}>
        <OrderPicker
          close={() => setOpen(false)}
          onCreated={(id) => navigate(`/billing/${encodeURIComponent(id)}?side=payable`)}
        />
      </QueryBoundary>
    </Dialog>
  )
}
