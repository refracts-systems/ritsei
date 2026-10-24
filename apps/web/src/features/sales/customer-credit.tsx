import { createSignal, Show, useContext } from "solid-js"
import { CommandFeedback, QueryBoundary, reloaded } from "../../shared/request-feedback.tsx"
import { ApiRuntime } from "../../shared/runtime.ts"
import { formatDecimal } from "../../ui/foundations/format.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { Button } from "../../ui/primitives/button.tsx"
import { Dialog } from "../../ui/primitives/dialog.tsx"
import { FormField } from "../../ui/primitives/form-field.tsx"
import { Form } from "../../ui/primitives/form.tsx"
import { Input } from "../../ui/primitives/input.tsx"
import { surface } from "../../ui/recipes/surface.ts"
import { creditLimitPayload } from "./documents-payloads.ts"
import { createCreditStandingQuery, createSetCreditLimitMutation } from "./documents-queries.ts"
import { creditFailureMessages } from "./documents.ts"

function SetLimitDialog(props: { customerId: string; current: string | null }) {
  const scope = useContext(ApiRuntime)
  const [open, setOpen] = createSignal(false)
  const [invalid, setInvalid] = createSignal(false)
  const mutation = createSetCreditLimitMutation(scope, () => setOpen(false))

  return (
    <Dialog
      open={open()}
      onOpenChange={setOpen}
      trigger={<span>Set credit limit</span>}
      title="Set credit limit"
      description="What this customer may owe on open invoices. A confirmed order that would go past it is refused."
    >
      <Form
        class={layout.stack}
        onSubmit={(value) => {
          const payload = creditLimitPayload(value)
          setInvalid(payload === undefined)

          if (payload !== undefined && !mutation.isPending) {
            mutation.mutate({ customerId: props.customerId, ...payload })
          }
        }}
      >
        <FormField
          label="Credit limit"
          helperText="Leave empty to remove the limit."
          error={invalid() ? "Enter an amount such as 5000.00, or leave it empty." : undefined}
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="creditLimit"
              inputmode="decimal"
              autocomplete="off"
              value={props.current ?? ""}
              disabled={mutation.isPending}
            />
          )}
        </FormField>
        <CommandFeedback
          error={mutation.error}
          messages={creditFailureMessages}
          pending={mutation.isPending}
          success={mutation.isSuccess}
          successMessage="Credit limit saved."
          area="customer credit"
          reload={() => Promise.resolve()}
          reset={() => mutation.reset()}
        />
        <Button variant="primary" type="submit" loading={mutation.isPending}>
          Save limit
        </Button>
      </Form>
    </Dialog>
  )
}

/** The customer's credit limit, what they owe now, and what is left. */
export function CustomerCredit(props: { customerId: string }) {
  const scope = useContext(ApiRuntime)
  const query = createCreditStandingQuery(scope, props.customerId)

  return (
    <section class={[surface(), layout.stack]} aria-labelledby="customer-credit-heading">
      <h3 id="customer-credit-heading">Credit</h3>
      <QueryBoundary label="credit limit" retry={() => reloaded(query.refetch())}>
        <Show when={query.data} keyed>
          {(standing) => (
            <div class={layout.stack}>
              <dl class={layout.detailList}>
                <div class={layout.detailItem}>
                  <dt class={layout.detailTerm}>Credit limit</dt>
                  <dd class={[layout.detailValue, layout.numeric]}>
                    {standing.creditLimit === null
                      ? "No limit"
                      : formatDecimal(standing.creditLimit)}
                  </dd>
                </div>
                <div class={layout.detailItem}>
                  <dt class={layout.detailTerm}>Owed now</dt>
                  <dd class={[layout.detailValue, layout.numeric]}>
                    {formatDecimal(standing.receivableBalance)}
                  </dd>
                </div>
                <Show when={standing.available}>
                  {(available) => (
                    <div class={layout.detailItem}>
                      <dt class={layout.detailTerm}>Available</dt>
                      <dd class={[layout.detailValue, layout.numeric]}>
                        {formatDecimal(available())}
                      </dd>
                    </div>
                  )}
                </Show>
              </dl>
              <div class={layout.actionRow}>
                <SetLimitDialog customerId={props.customerId} current={standing.creditLimit} />
              </div>
            </div>
          )}
        </Show>
      </QueryBoundary>
    </section>
  )
}
