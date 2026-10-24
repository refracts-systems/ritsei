import { createSignal, For, Show, useContext } from "solid-js"
import { today } from "../../shared/form-values.ts"
import { CommandFeedback, QueryBoundary, reloaded } from "../../shared/request-feedback.tsx"
import { createProductsQuery, createWarehousesQuery } from "../../shared/lookups.ts"
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
import { deliveryPayload, remainingQuantity } from "./documents-payloads.ts"
import { createDeliveryMutation, createOrderFulfillmentQuery } from "./documents-queries.ts"
import { deliveryFailureMessages, type OrderFulfillment } from "./documents.ts"

const hasUndelivered = (fulfillment: OrderFulfillment) =>
  fulfillment.lines.some((line) => remainingQuantity(line) > 0)

function DeliveryForm(props: {
  fulfillment: OrderFulfillment
  productName: (id: string) => string | undefined
  close: () => void
  reload: () => Promise<void>
}) {
  const scope = useContext(ApiRuntime)
  const warehouses = createWarehousesQuery(scope)
  const [invalid, setInvalid] = createSignal(false)
  const mutation = createDeliveryMutation(scope, props.close)

  return (
    <Form
      class={layout.stack}
      onSubmit={(value) => {
        const payload = deliveryPayload(value, props.fulfillment)
        setInvalid(payload === undefined)

        if (payload !== undefined && !mutation.isPending) mutation.mutate(payload)
      }}
    >
      <FormField
        label="Warehouse"
        required
        error={
          invalid()
            ? "Choose a warehouse and a date, and deliver at least one unit, never more than is left."
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
      <FormField label="Delivery date" required>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            name="deliveryDate"
            type="date"
            value={today()}
            required
            disabled={mutation.isPending}
          />
        )}
      </FormField>
      <For each={props.fulfillment.lines.filter((line) => remainingQuantity(line) > 0)}>
        {(line) => (
          <FormField
            label={`${props.productName(line.productId) ?? line.productId} (${remainingQuantity(line)} left)`}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                name={`quantity-${line.orderLineId}`}
                inputmode="numeric"
                autocomplete="off"
                value={String(remainingQuantity(line))}
                disabled={mutation.isPending}
              />
            )}
          </FormField>
        )}
      </For>
      <p class={layout.muted}>
        Delivering records the delivery and issues the stock at its moving-average cost in one step.
      </p>
      <CommandFeedback
        error={mutation.error}
        messages={deliveryFailureMessages}
        pending={mutation.isPending}
        success={mutation.isSuccess}
        successMessage="Delivery recorded."
        area="order"
        reload={props.reload}
        reset={() => mutation.reset()}
      />
      <Button variant="primary" type="submit" loading={mutation.isPending}>
        Record delivery
      </Button>
    </Form>
  )
}

function RecordDeliveryDialog(props: {
  fulfillment: OrderFulfillment
  productName: (id: string) => string | undefined
  reload: () => Promise<void>
}) {
  const [open, setOpen] = createSignal(false)

  return (
    <Dialog
      open={open()}
      onOpenChange={setOpen}
      trigger={<span>Record delivery</span>}
      triggerVariant="primary"
      title="Record delivery"
      description="Deliver some or all of what is left on this order."
    >
      <QueryBoundary label="warehouses" retry={props.reload}>
        <DeliveryForm
          fulfillment={props.fulfillment}
          productName={props.productName}
          close={() => setOpen(false)}
          reload={props.reload}
        />
      </QueryBoundary>
    </Dialog>
  )
}

/** How much of a confirmed order is delivered, with the delivery and invoicing steps. */
export function OrderDelivery(props: { orderId: string; reloadOrder: () => Promise<void> }) {
  const scope = useContext(ApiRuntime)
  const query = createOrderFulfillmentQuery(scope, props.orderId)
  const products = createProductsQuery(scope)
  const productName = (id: string) => products.data.find((product) => product.id === id)?.name
  const reload = () => reloaded(Promise.all([query.refetch(), props.reloadOrder()]))

  return (
    <section class={[surface(), layout.stack]} aria-labelledby="sales-order-delivery-heading">
      <h3 id="sales-order-delivery-heading">Delivery</h3>
      <QueryBoundary label="delivery progress" retry={() => reloaded(query.refetch())}>
        <Show when={query.data} keyed>
          {(fulfillment) => (
            <div class={layout.stack}>
              <div class={layout.scroll} tabindex="0" role="region" aria-label="Delivery progress">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col" class={layout.numeric}>
                        Ordered
                      </th>
                      <th scope="col" class={layout.numeric}>
                        Delivered
                      </th>
                      <th scope="col" class={layout.numeric}>
                        Unit price
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={fulfillment.lines}>
                      {(line) => (
                        <tr>
                          <th scope="row">{productName(line.productId) ?? line.productId}</th>
                          <td class={layout.numeric}>{line.quantity}</td>
                          <td class={layout.numeric}>{line.delivered}</td>
                          <td class={layout.numeric}>{formatDecimal(line.unitPrice)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
              <Show
                when={fulfillment.status === "confirmed"}
                fallback={<p class={layout.muted}>Only confirmed orders can be delivered.</p>}
              >
                <div class={layout.row}>
                  <Show
                    when={hasUndelivered(fulfillment)}
                    fallback={<p role="status">Everything on this order has been delivered.</p>}
                  >
                    <RecordDeliveryDialog
                      fulfillment={fulfillment}
                      productName={productName}
                      reload={reload}
                    />
                  </Show>
                  <a href="/billing">Invoice delivered goods in Billing</a>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </QueryBoundary>
    </section>
  )
}
