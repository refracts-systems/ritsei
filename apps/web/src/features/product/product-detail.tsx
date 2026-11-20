import { createSignal, For, Show, useContext } from "solid-js"
import {
  type CustomFieldDefinition,
  type CustomFieldValues,
  fieldValue,
  valuesPayload,
} from "../../shared/custom-field-values.ts"
import { CustomFieldInput, CustomFieldList } from "../../shared/custom-fields.tsx"
import { CommandFeedback, QueryBoundary, reloaded } from "../../shared/request-feedback.tsx"
import { ApiRuntime } from "../../shared/runtime.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { EntityWorkspace } from "../../ui/patterns/entity-workspace.tsx"
import { Button } from "../../ui/primitives/button.tsx"
import { Dialog } from "../../ui/primitives/dialog.tsx"
import { Form } from "../../ui/primitives/form.tsx"
import { surface } from "../../ui/recipes/surface.ts"
import {
  createProductFieldsQuery,
  createProductFieldValuesQuery,
  createProductQuery,
  createSetProductFieldValuesMutation,
} from "./queries.ts"
import { productTypeLabels } from "./service.ts"

const fieldFailureMessages = {
  CustomFieldDocumentTypeNotReleased:
    "Custom fields are unavailable for products. Contact your administrator.",
  CustomFieldNotDefined: "A field is no longer defined. Close the editor and reload the product.",
  CustomFieldValueInvalid: "A value does not fit its field. Check the field format or choices.",
  CustomFieldRequired: "A required field is empty. Fill it in before saving.",
  ProductNotFound: "This product is no longer available. Open another product from the list.",
}

function EditProductFields(props: {
  productId: string
  definitions: readonly CustomFieldDefinition[]
  values: CustomFieldValues
  reload: () => Promise<void>
}) {
  const scope = useContext(ApiRuntime)

  const [draft, setDraft] = createSignal<{
    definitions: readonly CustomFieldDefinition[]
    values: CustomFieldValues
  }>()

  const close = () => setDraft(undefined)
  const mutation = createSetProductFieldValuesMutation(scope, close)
  const unknownOutcome = () => mutation.error?.kind === "unknown-outcome"
  const blocked = () => mutation.isPending || unknownOutcome()

  return (
    <Dialog
      open={draft() !== undefined}
      onOpenChange={(open) => {
        if (mutation.isPending) return

        if (open) {
          if (!unknownOutcome()) mutation.reset()
          setDraft({ definitions: props.definitions, values: props.values })
        } else {
          close()
        }
      }}
      trigger={<span>Edit custom fields</span>}
      title="Edit custom fields"
      description="Clear an optional field to remove its value."
    >
      <Show when={draft()} keyed>
        {(initial) => (
          <Form
            class={layout.stack}
            onSubmit={(value) => {
              if (blocked()) return

              const values = valuesPayload(value, initial.definitions, initial.values)

              if (Object.keys(values).length > 0) {
                mutation.mutate({ productId: props.productId, values })
              } else {
                close()
              }
            }}
          >
            <For each={initial.definitions}>
              {(definition) => (
                <CustomFieldInput
                  definition={definition}
                  value={String(fieldValue(initial.values, definition.key) ?? "")}
                  disabled={mutation.isPending}
                />
              )}
            </For>
            <CommandFeedback
              error={mutation.error}
              messages={fieldFailureMessages}
              pending={mutation.isPending}
              success={false}
              successMessage=""
              area="custom fields"
              reload={props.reload}
              reset={() => {
                mutation.reset()
                close()
              }}
            />
            <Button
              variant="primary"
              type="submit"
              loading={mutation.isPending}
              disabled={blocked()}
            >
              Save fields
            </Button>
          </Form>
        )}
      </Show>
    </Dialog>
  )
}

function ProductFields(props: { id: string }) {
  const scope = useContext(ApiRuntime)
  const definitions = createProductFieldsQuery(scope)
  const values = createProductFieldValuesQuery(scope, props.id)
  const reload = () => reloaded(Promise.all([definitions.refetch(), values.refetch()]))

  return (
    <section class={[surface(), layout.stack]} aria-labelledby="product-fields-heading">
      <h2 id="product-fields-heading">Custom fields</h2>
      <QueryBoundary label="custom fields" retry={reload}>
        <Show
          when={definitions.data.length > 0}
          fallback={
            <p role="status">
              No custom fields are defined for products yet. Ask your administrator to configure
              them.
            </p>
          }
        >
          <CustomFieldList definitions={definitions.data} values={values.data} />
          <div class={layout.actionRow}>
            <EditProductFields
              productId={props.id}
              definitions={definitions.data}
              values={values.data}
              reload={reload}
            />
          </div>
        </Show>
      </QueryBoundary>
    </section>
  )
}

export function ProductDetail(props: { id: string }) {
  const scope = useContext(ApiRuntime)
  const query = createProductQuery(scope, props.id)

  return (
    <EntityWorkspace
      title="Product details"
      headerActions={<a href="/product">Back to Products</a>}
    >
      <QueryBoundary label="product" retry={() => reloaded(query.refetch())}>
        <section class={[surface(), layout.stack]} aria-labelledby="product-name">
          <h2 id="product-name">{query.data.name}</h2>
          <dl class={layout.detailList}>
            <For
              each={[
                ["Code", query.data.code],
                ["Type", productTypeLabels[query.data.type]],
                ["Category", query.data.category ?? "Not set"],
                ["Unit", query.data.unitOfMeasure],
                ["Status", query.data.active ? "Active" : "Inactive"],
              ]}
            >
              {([label, value]) => (
                <div class={layout.detailItem}>
                  <dt class={layout.detailTerm}>{label}</dt>
                  <dd class={layout.detailValue}>{value}</dd>
                </div>
              )}
            </For>
          </dl>
        </section>
        <ProductFields id={props.id} />
      </QueryBoundary>
    </EntityWorkspace>
  )
}
