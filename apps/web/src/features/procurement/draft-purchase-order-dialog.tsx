import { useNavigate } from "@solidjs/router"
import { createSignal, For, Show, useContext } from "solid-js"
import { createPartyDirectoryQuery, createProductsQuery } from "../../shared/lookups.ts"
import { namesFrom } from "../../shared/party-names.ts"
import type { SupplierAccount } from "../../shared/contracts/generated/procurement.ts"
import { CommandFeedback, QueryBoundary } from "../../shared/request-feedback.tsx"
import { ApiRuntime } from "../../shared/runtime.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { Button } from "../../ui/primitives/button.tsx"
import { Dialog } from "../../ui/primitives/dialog.tsx"
import { FormField } from "../../ui/primitives/form-field.tsx"
import { Form } from "../../ui/primitives/form.tsx"
import { Input } from "../../ui/primitives/input.tsx"
import { Select } from "../../ui/primitives/select.tsx"
import { draftPayload } from "./documents-payloads.ts"
import { createDraftPurchaseOrderMutation } from "./documents-queries.ts"
import { draftFailureMessages } from "./documents.ts"

function OrderLine(props: {
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
      <FormField label={`Unit price ${props.index + 1}`}>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            name={`unitPrice-${props.index}`}
            inputmode="decimal"
            autocomplete="off"
            placeholder="Supplier price"
            disabled={props.disabled}
          />
        )}
      </FormField>
    </div>
  )
}

function DraftForm(props: {
  supplierAccounts: readonly SupplierAccount[]
  close: () => void
  onCreated: (id: string) => void
  reload: () => Promise<void>
}) {
  const scope = useContext(ApiRuntime)
  const products = createProductsQuery(scope)
  const directory = createPartyDirectoryQuery(scope)
  const [lineCount, setLineCount] = createSignal(1)
  const [invalid, setInvalid] = createSignal(false)
  const names = () => namesFrom(directory.data)

  const mutation = createDraftPurchaseOrderMutation(scope, (order) => {
    props.close()
    props.onCreated(order.purchaseOrderId)
  })

  return (
    <Form
      class={layout.stack}
      onSubmit={(value) => {
        const payload = draftPayload(value, lineCount())
        setInvalid(payload === undefined)

        if (payload !== undefined && !mutation.isPending) mutation.mutate(payload)
      }}
    >
      <FormField
        label="Supplier"
        required
        error={
          invalid()
            ? "Choose a supplier and fill each used line with a whole quantity and, optionally, a unit price such as 6.50."
            : undefined
        }
      >
        {(fieldProps) => (
          <Select
            {...fieldProps}
            name="supplierAccountId"
            placeholder="Choose supplier"
            options={props.supplierAccounts.map((account) => ({
              value: account.id,
              label: names().parties.get(account.partyId) ?? account.id,
            }))}
            required
            disabled={mutation.isPending}
          />
        )}
      </FormField>
      <For each={Array.from({ length: lineCount() }, (_, index) => index)}>
        {(index) => (
          <OrderLine index={index} products={products.data} disabled={mutation.isPending} />
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
        Leave the unit price empty to use the supplier's price. An order above the approval limit is
        created as a draft with an approval request pending.
      </p>
      <CommandFeedback
        error={mutation.error}
        messages={draftFailureMessages}
        pending={mutation.isPending}
        success={mutation.isSuccess}
        successMessage="Purchase order drafted."
        area="procurement"
        reload={props.reload}
        reset={() => mutation.reset()}
      />
      <Button variant="primary" type="submit" loading={mutation.isPending}>
        Create purchase order
      </Button>
    </Form>
  )
}

/** Drafts a priced purchase order from products; supplier prices apply unless a line overrides. */
export function DraftPurchaseOrderDialog(props: {
  supplierAccounts: () => readonly SupplierAccount[]
  reload: () => Promise<void>
}) {
  const navigate = useNavigate()
  const [open, setOpen] = createSignal(false)

  return (
    <Dialog
      open={open()}
      onOpenChange={setOpen}
      trigger={<span>Create purchase order</span>}
      title="Create purchase order"
      description="Order products from a supplier. The order stays a draft until it is released."
    >
      <Show
        when={props.supplierAccounts().length > 0}
        fallback={<p role="status">Create a supplier account before creating a purchase order.</p>}
      >
        <QueryBoundary label="products" retry={props.reload}>
          <DraftForm
            supplierAccounts={props.supplierAccounts()}
            close={() => setOpen(false)}
            reload={props.reload}
            onCreated={(id) => navigate(`/procurement/${encodeURIComponent(id)}`)}
          />
        </QueryBoundary>
      </Show>
    </Dialog>
  )
}
