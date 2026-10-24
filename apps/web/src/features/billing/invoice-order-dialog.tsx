import { useNavigate } from "@solidjs/router"
import { createSignal, Show, useContext } from "solid-js"
import { today } from "../../shared/form-values.ts"
import { CommandFeedback, reloaded } from "../../shared/request-feedback.tsx"
import { ApiRuntime } from "../../shared/runtime.ts"
import { formatDecimal } from "../../ui/foundations/format.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { Button } from "../../ui/primitives/button.tsx"
import { Dialog } from "../../ui/primitives/dialog.tsx"
import { FormField } from "../../ui/primitives/form-field.tsx"
import { Form } from "../../ui/primitives/form.tsx"
import { Input } from "../../ui/primitives/input.tsx"
import { Select } from "../../ui/primitives/select.tsx"
import {
  createConfirmedOrdersQuery,
  createCustomersQuery,
  createInvoiceMutation,
} from "./queries.ts"
import { invoicePayload } from "./payloads.ts"
import { invoiceFailureMessages } from "./service.ts"

function InvoiceOrderForm(props: { onCreated: (id: string) => void; close: () => void }) {
  const scope = useContext(ApiRuntime)
  const orders = createConfirmedOrdersQuery(scope)
  const customers = createCustomersQuery(scope)
  const [invalid, setInvalid] = createSignal(false)

  const mutation = createInvoiceMutation(scope, (id) => {
    props.close()
    props.onCreated(id)
  })

  const customerName = (customerId: string) =>
    customers.data.find((customer) => customer.id === customerId)?.name

  return (
    <Form
      class={layout.stack}
      onSubmit={(value) => {
        const payload = invoicePayload(value)
        setInvalid(payload === undefined)

        if (payload !== undefined && !mutation.isPending) mutation.mutate(payload)
      }}
    >
      <Show
        when={orders.data.length > 0}
        fallback={
          <p role="status">
            There are no confirmed orders. Confirm a sales order and deliver it before invoicing.
          </p>
        }
      >
        <FormField
          label="Sales order"
          required
          error={invalid() ? "Choose an order and an invoice date." : undefined}
        >
          {(fieldProps) => (
            <Select
              {...fieldProps}
              name="orderId"
              placeholder="Choose a confirmed order"
              options={orders.data.map((order) => ({
                value: order.id,
                label: `${customerName(order.customerId) ?? "Customer"} · ${formatDecimal(order.total)} · ${order.id.slice(0, 8)}`,
              }))}
              required
              disabled={mutation.isPending}
            />
          )}
        </FormField>
        <FormField label="Invoice date" required>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="invoiceDate"
              type="date"
              value={today()}
              required
              disabled={mutation.isPending}
            />
          )}
        </FormField>
        <p class={layout.muted}>
          The invoice covers what has been delivered and not yet invoiced on this order.
        </p>
        <CommandFeedback
          error={mutation.error}
          messages={invoiceFailureMessages}
          pending={mutation.isPending}
          success={mutation.isSuccess}
          successMessage="Invoice created."
          area="billing"
          reload={() => reloaded(orders.refetch())}
          reset={() => mutation.reset()}
        />
        <Button variant="primary" type="submit" loading={mutation.isPending}>
          Create invoice
        </Button>
      </Show>
    </Form>
  )
}

/** Creates a customer invoice from the delivered quantities of a confirmed sales order. */
export function InvoiceOrderDialog() {
  const navigate = useNavigate()
  const [open, setOpen] = createSignal(false)

  return (
    <Dialog
      open={open()}
      onOpenChange={setOpen}
      trigger={<span>Create invoice</span>}
      triggerVariant="primary"
      title="Create invoice"
      description="Invoice the delivered, not yet invoiced quantities of a confirmed sales order."
    >
      <InvoiceOrderForm
        close={() => setOpen(false)}
        onCreated={(id) => navigate(`/billing/${encodeURIComponent(id)}`)}
      />
    </Dialog>
  )
}
