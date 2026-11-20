import * as Schema from "effect/Schema"
import { createSignal, Show } from "solid-js"
import { formText } from "../../shared/form-values.ts"
import { Uuid } from "../../shared/schemas.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { EntityWorkspace } from "../../ui/patterns/entity-workspace.tsx"
import { Button } from "../../ui/primitives/button.tsx"
import { Form } from "../../ui/primitives/form.tsx"
import { FormField } from "../../ui/primitives/form-field.tsx"
import { Input } from "../../ui/primitives/input.tsx"
import { surface } from "../../ui/recipes/surface.ts"
import { ImportBatch } from "./import-batch.tsx"
import { StageImportForm } from "./stage-import-form.tsx"

function OpenImport(props: { openBatch: (id: string) => void }) {
  const [invalid, setInvalid] = createSignal(false)
  const isValidId = Schema.is(Uuid)

  return (
    <section class={[surface(), layout.stack]} aria-labelledby="open-import-heading">
      <h2 id="open-import-heading">Open an existing batch</h2>
      <Form
        class={layout.stack}
        aria-labelledby="open-import-heading"
        onSubmit={(values) => {
          const id = formText(values.batchId)

          if (isValidId(id)) props.openBatch(id)
          else setInvalid(true)
        }}
      >
        <FormField
          label="Batch ID"
          required
          error={invalid() ? "Enter a valid batch ID." : undefined}
        >
          {(fieldProps) => <Input {...fieldProps} name="batchId" required autocomplete="off" />}
        </FormField>
        <div class={layout.actionRow}>
          <Button type="submit">Open batch</Button>
        </div>
      </Form>
    </section>
  )
}

export function Onboarding(props: {
  batchId: string | undefined
  openBatch: (id: string) => void
}) {
  return (
    <EntityWorkspace
      title="Data imports"
      description={<p>Import people and organizations into the Party directory.</p>}
      headerActions={
        <Show when={props.batchId}>
          <a href="/onboarding">Start a new import</a>
        </Show>
      }
    >
      <Show
        when={props.batchId}
        keyed
        fallback={
          <>
            <StageImportForm onStaged={props.openBatch} />
            <OpenImport openBatch={props.openBatch} />
          </>
        }
      >
        {(id) => <ImportBatch batchId={id} onStaged={props.openBatch} />}
      </Show>
    </EntityWorkspace>
  )
}
