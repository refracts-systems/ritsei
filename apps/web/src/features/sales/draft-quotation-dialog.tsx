import { useNavigate } from "@solidjs/router"
import { createSignal, For, Show, useContext } from "solid-js"
import { CommandFeedback, QueryBoundary } from "../../shared/request-feedback.tsx"
import { ApiRuntime } from "../../shared/runtime.ts"
import type { Customer } from "../../shared/contracts/generated/sales.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { Button } from "../../ui/primitives/button.tsx"
import { Dialog } from "../../ui/primitives/dialog.tsx"
import { FormField } from "../../ui/primitives/form-field.tsx"
import { Form } from "../../ui/primitives/form.tsx"
import { Input } from "../../ui/primitives/input.tsx"
import { Select } from "../../ui/primitives/select.tsx"
import { quotationPayload } from "./documents-payloads.ts"
import { createDraftQuotationMutation, createProductsQuery } from "./documents-queries.ts"
import { quotationFailureMessages } from "./documents.ts"

const inThirtyDays = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)

function QuotationLine(props: {
  index: number
  products: readonly { readonly id: string; readonly code: string; readonly name: string }[]
  disabled: boolean
}) {
  return (
    <div class={layout.row}>
      <FormField label={`Product ${props.index + 1}`}>
        {(fieldProps) => (
          <Select
            {...fieldProps}
            name={`productId-${props.index}`}
            placeholder="Choose product"
            options={props.products.map((product) => ({
              value: product.id,
              label: `${product.code} · ${product.name}`,
            }))}
            disabled={props.disabled}
          />
        )}
      </FormField>
      <FormField label={`Quantity ${props.index + 1}`}>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            name={`quantity-${props.index}`}
            inputmode="numeric"
            autocomplete="off"
            value="1"
            disabled={props.disabled}
          />
        )}
      </FormField>
      <FormField label={`Discount % ${props.index + 1}`}>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            name={`discount-${props.index}`}
            inputmode="decimal"
            autocomplete="off"
            placeholder="0"
            disabled={props.disabled}
          />
        )}
      </FormField>
    </div>
  )
}

function DraftQuotationForm(props: {
  customers: readonly Customer[]
  close: () => void
  onCreated: (id: string) => void
  reload: () => Promise<void>
}) {
  const scope = useContext(ApiRuntime)
  const products = createProductsQuery(scope)
  const [lineCount, setLineCount] = createSignal(1)
  const [invalid, setInvalid] = createSignal(false)

  const mutation = createDraftQuotationMutation(scope, (quotation) => {
    props.close()
    props.onCreated(quotation.id)
  })

  return (
    <Form
      class={layout.stack}
      onSubmit={(value) => {
        const payload = quotationPayload(value, lineCount())
        setInvalid(payload === undefined)

        if (payload !== undefined && !mutation.isPending) mutation.mutate(payload)
      }}
    >
      <FormField
        label="Customer"
        required
        error={
          invalid()
            ? "Choose a customer and a valid-until date, and fill each used line with a whole quantity and a discount up to 100."
            : undefined
        }
      >
        {(fieldProps) => (
          <Select
            {...fieldProps}
            name="customerId"
            placeholder="Choose customer"
            options={props.customers.map((customer) => ({
              value: customer.id,
              label: `${customer.name} · ${customer.email}`,
            }))}
            required
            disabled={mutation.isPending}
          />
        )}
      </FormField>
      <FormField label="Valid until" required>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            name="validUntil"
            type="date"
            value={inThirtyDays()}
            required
            disabled={mutation.isPending}
          />
        )}
      </FormField>
      <For each={Array.from({ length: lineCount() }, (_, index) => index)}>
        {(index) => (
          <QuotationLine index={index} products={products.data} disabled={mutation.isPending} />
        )}
      </For>
      <div class={layout.row}>
        <Button
          type="button"
          onClick={() => setLineCount((count) => count + 1)}
          disabled={mutation.isPending || lineCount() >= 20}
        >
          Add line
        </Button>
      </div>
      <p class={layout.muted}>
        Prices come from the customer's price list; a discount applies to the list price. Lines
        without a product are ignored.
      </p>
      <CommandFeedback
        error={mutation.error}
        messages={quotationFailureMessages}
        pending={mutation.isPending}
        success={mutation.isSuccess}
        successMessage="Quotation created."
        area="sales"
        reload={props.reload}
        reset={() => mutation.reset()}
      />
      <Button variant="primary" type="submit" loading={mutation.isPending}>
        Create quotation
      </Button>
    </Form>
  )
}

/** Drafts a priced quotation: the customer's price list and the products' tax defaults apply. */
export function DraftQuotationDialog(props: {
  customers: () => readonly Customer[]
  reload: () => Promise<void>
}) {
  const navigate = useNavigate()
  const [open, setOpen] = createSignal(false)

  return (
    <Dialog
      open={open()}
      onOpenChange={setOpen}
      trigger={<span>Create quotation</span>}
      title="Create quotation"
      description="Quote products from the customer's price list. The quotation stays a draft until it is sent."
    >
      <Show
        when={props.customers().length > 0}
        fallback={<p role="status">Create a customer before creating a quotation.</p>}
      >
        <QueryBoundary label="products" retry={props.reload}>
          <DraftQuotationForm
            customers={props.customers()}
            close={() => setOpen(false)}
            reload={props.reload}
            onCreated={(id) => navigate(`/sales/quotations/${encodeURIComponent(id)}`)}
          />
        </QueryBoundary>
      </Show>
    </Dialog>
  )
}
