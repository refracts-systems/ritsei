import { useMutation } from "@tanstack/solid-query"
import { Show, useContext } from "solid-js"
import { failureMessage, type RequestFailure } from "../../shared/api.ts"
import { maxImportRows, type StagedImport } from "../../shared/contracts/generated/onboarding.ts"
import { formText } from "../../shared/form-values.ts"
import { ApiRuntime, runRequest } from "../../shared/runtime.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { Button } from "../../ui/primitives/button.tsx"
import { Form, type FormValue } from "../../ui/primitives/form.tsx"
import { FormField } from "../../ui/primitives/form-field.tsx"
import { Input } from "../../ui/primitives/input.tsx"
import { surface } from "../../ui/recipes/surface.ts"
import { importFailureMessages, stagePartyImport } from "./service.ts"

export function StageImportForm(props: {
  sourceInstance?: string | undefined
  onStaged: (id: string) => void
}) {
  const scope = useContext(ApiRuntime)

  const mutation = useMutation<
    StagedImport,
    RequestFailure,
    { file: File; sourceInstance: string }
  >(() => ({
    mutationFn: (input) => runRequest(scope, stagePartyImport(input.file, input.sourceInstance)),
    onSuccess: ({ summary }) => props.onStaged(summary.batch.id),
  }))

  const submit = (value: FormValue) => {
    if (mutation.isPending || !(value.csv instanceof File)) return

    mutation.mutate({ file: value.csv, sourceInstance: formText(value.sourceInstance) })
  }

  return (
    <section class={[surface(), layout.stack]} aria-labelledby="stage-import-heading">
      <h2 id="stage-import-heading">
        {props.sourceInstance === undefined ? "Stage a Party import" : "Stage a corrected file"}
      </h2>
      <p>
        CSV headers are <code>source_id,kind,name</code> with an optional <code>role</code> column.
        Use <code>person</code> or <code>organization</code> for the kind and a stable ID from the
        source system for each record.
      </p>
      <Form class={layout.stack} aria-labelledby="stage-import-heading" onSubmit={submit}>
        <FormField
          label="Source instance"
          required
          helperText="Use the same name for every export from the same source system and instance."
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="sourceInstance"
              required
              maxlength={120}
              defaultValue={props.sourceInstance}
              readonly={props.sourceInstance !== undefined}
              disabled={mutation.isPending}
            />
          )}
        </FormField>
        <FormField
          label="CSV file"
          required
          helperText={`UTF-8 CSV with up to ${maxImportRows.toLocaleString("en-US")} records. Supported roles are customer, supplier, employee, and partner.`}
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="csv"
              type="file"
              accept=".csv,text/csv"
              required
              disabled={mutation.isPending}
            />
          )}
        </FormField>
        <Show when={mutation.error} keyed>
          {(error) => (
            <p role="alert">
              {error.kind === "unknown-outcome"
                ? "The file may have been staged. Submit the same file and source instance to open its batch."
                : failureMessage(error, importFailureMessages)}
            </p>
          )}
        </Show>
        <Show when={mutation.isPending}>
          <p role="status">Staging CSV…</p>
        </Show>
        <Show when={mutation.data?.alreadyStaged}>
          <p role="status">This file is already staged.</p>
        </Show>
        <div class={layout.actionRow}>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Stage CSV
          </Button>
        </div>
      </Form>
    </section>
  )
}
