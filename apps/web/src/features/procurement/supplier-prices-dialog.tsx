import { createSignal, Show, useContext } from "solid-js"
import { createProductsQuery } from "../../shared/lookups.ts"
import { CommandFeedback, QueryBoundary, reloaded } from "../../shared/request-feedback.tsx"
import { ApiRuntime } from "../../shared/runtime.ts"
import { formatDecimal } from "../../ui/foundations/format.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { DataTable } from "../../ui/patterns/data-table.tsx"
import { Button } from "../../ui/primitives/button.tsx"
import { Dialog } from "../../ui/primitives/dialog.tsx"
import { FormField } from "../../ui/primitives/form-field.tsx"
import { Form } from "../../ui/primitives/form.tsx"
import { Input } from "../../ui/primitives/input.tsx"
import { Select } from "../../ui/primitives/select.tsx"
import { createSetPriceMutation, createSupplierPricesQuery } from "./documents-queries.ts"
import { pricePayload } from "./documents-payloads.ts"
import { priceFailureMessages } from "./documents.ts"

function PriceList(props: { supplierAccountId: string }) {
  const scope = useContext(ApiRuntime)
  const prices = createSupplierPricesQuery(scope, props.supplierAccountId)
  const products = createProductsQuery(scope)
  const mutation = createSetPriceMutation(scope)
  const [invalid, setInvalid] = createSignal(false)
  const nameOf = (id: string) => products.data.find((product) => product.id === id)?.name ?? id

  return (
    <div class={layout.stack}>
      <Show
        when={prices.data.length > 0}
        fallback={<p role="status">No prices are set for this supplier yet.</p>}
      >
        <DataTable
          surface={false}
          caption="Supplier prices"
          rows={prices.data}
          getRowId={(price) => price.productId}
          columns={[
            {
              id: "product",
              header: "Product",
              rowHeader: true,
              cell: (price) => nameOf(price.productId),
            },
            {
              id: "price",
              header: "Unit price",
              align: "end",
              cell: (price) => formatDecimal(price.unitPrice),
            },
          ]}
        />
      </Show>
      <Form
        class={layout.row}
        aria-label="Set a supplier price"
        onSubmit={(value) => {
          const payload = pricePayload(value, props.supplierAccountId)
          setInvalid(payload === undefined)

          if (payload !== undefined && !mutation.isPending) mutation.mutate(payload)
        }}
      >
        <FormField
          label="Product"
          required
          error={invalid() ? "Choose a product and enter a price such as 6.50." : undefined}
        >
          {(fieldProps) => (
            <Select
              {...fieldProps}
              name="productId"
              placeholder="Choose product"
              options={products.data.map((product) => ({
                value: product.id,
                label: `${product.code} · ${product.name}`,
              }))}
              required
              disabled={mutation.isPending}
            />
          )}
        </FormField>
        <FormField label="Unit price" required>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="unitPrice"
              inputmode="decimal"
              autocomplete="off"
              required
              disabled={mutation.isPending}
            />
          )}
        </FormField>
        <Button variant="primary" type="submit" loading={mutation.isPending}>
          Set price
        </Button>
      </Form>
      <p class={layout.muted}>Setting a price for a product that has one replaces it.</p>
      <CommandFeedback
        error={mutation.error}
        messages={priceFailureMessages}
        pending={mutation.isPending}
        success={mutation.isSuccess}
        successMessage="Price saved."
        area="supplier prices"
        reload={() => reloaded(prices.refetch())}
        reset={() => mutation.reset()}
      />
    </div>
  )
}

/** The prices a supplier charges, used when a purchase order line has no price of its own. */
export function SupplierPricesDialog(props: {
  supplierAccountId: string
  reload: () => Promise<void>
}) {
  return (
    <Dialog
      trigger={<span>Prices</span>}
      title="Supplier prices"
      description="Prices apply to purchase order lines that do not enter a unit price."
    >
      <QueryBoundary label="supplier prices" retry={props.reload}>
        <PriceList supplierAccountId={props.supplierAccountId} />
      </QueryBoundary>
    </Dialog>
  )
}
