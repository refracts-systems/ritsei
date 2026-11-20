import { createSignal, For, Show, useContext } from "solid-js"
import {
  type CustomFieldDefinition,
  type CustomFieldValues,
  fieldValue,
  valuesPayload,
} from "../../shared/custom-field-values.ts"
import { CustomFieldInput, CustomFieldList } from "../../shared/custom-fields.tsx"
import { formText } from "../../shared/form-values.ts"
import { CommandFeedback, QueryBoundary, reloaded } from "../../shared/request-feedback.tsx"
import { ApiRuntime } from "../../shared/runtime.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { Button } from "../../ui/primitives/button.tsx"
import { Dialog } from "../../ui/primitives/dialog.tsx"
import { FormField } from "../../ui/primitives/form-field.tsx"
import { Form } from "../../ui/primitives/form.tsx"
import { Input } from "../../ui/primitives/input.tsx"
import { Select } from "../../ui/primitives/select.tsx"
import { surface } from "../../ui/recipes/surface.ts"
import {
  createCustomerFieldsQuery,
  createCustomerFieldValuesQuery,
  createDefineFieldMutation,
  createSetFieldValuesMutation,
} from "./custom-fields-queries.ts"
import { customFieldFailureMessages, definitionPayload } from "./custom-fields.ts"

const kindOptions = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes or no" },
  { value: "choice", label: "One of a list" },
]

function EditValuesDialog(props: {
  customerId: string
  definitions: readonly CustomFieldDefinition[]
  values: CustomFieldValues
}) {
  const scope = useContext(ApiRuntime)
  const [open, setOpen] = createSignal(false)
  const mutation = createSetFieldValuesMutation(scope, () => setOpen(false))

  return (
    <Dialog
      open={open()}
      onOpenChange={setOpen}
      trigger={<span>Edit custom fields</span>}
      title="Edit custom fields"
      description="Only the fields you change are saved. Clear a field to remove its value."
    >
      <Form
        class={layout.stack}
        onSubmit={(value) => {
          const changed = valuesPayload(value, props.definitions, props.values)

          if (Object.keys(changed).length === 0) {
            setOpen(false)

            return
          }

          if (!mutation.isPending)
            mutation.mutate({ customerId: props.customerId, values: changed })
        }}
      >
        <For each={props.definitions}>
          {(definition) => (
            <CustomFieldInput
              definition={definition}
              value={String(fieldValue(props.values, definition.key) ?? "")}
            />
          )}
        </For>
        <CommandFeedback
          error={mutation.error}
          messages={customFieldFailureMessages}
          pending={mutation.isPending}
          success={mutation.isSuccess}
          successMessage="Custom fields saved."
          area="custom fields"
          reload={() => Promise.resolve()}
          reset={() => mutation.reset()}
        />
        <Button variant="primary" type="submit" loading={mutation.isPending}>
          Save fields
        </Button>
      </Form>
    </Dialog>
  )
}

function AddFieldDialog() {
  const scope = useContext(ApiRuntime)
  const [open, setOpen] = createSignal(false)
  const [invalid, setInvalid] = createSignal(false)
  const [kind, setKind] = createSignal("text")
  const mutation = createDefineFieldMutation(scope, () => setOpen(false))

  return (
    <Dialog
      open={open()}
      onOpenChange={setOpen}
      trigger={<span>Add a field</span>}
      title="Add a customer field"
      description="The field appears on every customer. Its key cannot be changed later."
    >
      <Form
        class={layout.stack}
        onSubmit={(value) => {
          const payload = definitionPayload(value)
          setInvalid(payload === undefined)

          if (payload !== undefined && !mutation.isPending) mutation.mutate(payload)
        }}
      >
        <FormField
          label="Label"
          required
          error={
            invalid()
              ? "Enter a label, a key of lowercase letters, digits and underscores, and the choices for a list."
              : undefined
          }
        >
          {(fieldProps) => <Input {...fieldProps} name="label" autocomplete="off" required />}
        </FormField>
        <FormField label="Key" required helperText="For example account_manager">
          {(fieldProps) => (
            <Input {...fieldProps} name="key" autocomplete="off" spellcheck={false} required />
          )}
        </FormField>
        <FormField label="Kind" required>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              name="kind"
              options={kindOptions}
              value={kind()}
              onChange={(event) => setKind(formText(event.currentTarget.value))}
            />
          )}
        </FormField>
        <Show when={kind() === "choice"}>
          <FormField label="Choices" helperText="Separate the choices with commas">
            {(fieldProps) => <Input {...fieldProps} name="choices" autocomplete="off" />}
          </FormField>
        </Show>
        <FormField label="Required">
          {(fieldProps) => (
            <label class={layout.row}>
              <input {...fieldProps} type="checkbox" name="required" value="true" />
              Every customer needs a value
            </label>
          )}
        </FormField>
        <CommandFeedback
          error={mutation.error}
          messages={customFieldFailureMessages}
          pending={mutation.isPending}
          success={mutation.isSuccess}
          successMessage="Field added."
          area="custom fields"
          reload={() => Promise.resolve()}
          reset={() => mutation.reset()}
        />
        <Button variant="primary" type="submit" loading={mutation.isPending}>
          Add field
        </Button>
      </Form>
    </Dialog>
  )
}

/** The fields a tenant added to customers, with this customer's values. */
export function CustomerFields(props: { customerId: string }) {
  const scope = useContext(ApiRuntime)
  const definitions = createCustomerFieldsQuery(scope)
  const values = createCustomerFieldValuesQuery(scope, props.customerId)

  return (
    <section class={[surface(), layout.stack]} aria-labelledby="customer-fields-heading">
      <h3 id="customer-fields-heading">Custom fields</h3>
      <QueryBoundary
        label="custom fields"
        retry={() => reloaded(Promise.all([definitions.refetch(), values.refetch()]))}
      >
        <Show
          when={definitions.data.length > 0}
          fallback={<p role="status">No custom fields are defined for customers yet.</p>}
        >
          <CustomFieldList definitions={definitions.data} values={values.data} />
        </Show>
        <div class={layout.actionRow}>
          <Show when={definitions.data.length > 0}>
            <EditValuesDialog
              customerId={props.customerId}
              definitions={definitions.data}
              values={values.data}
            />
          </Show>
          <AddFieldDialog />
        </div>
      </QueryBoundary>
    </section>
  )
}
