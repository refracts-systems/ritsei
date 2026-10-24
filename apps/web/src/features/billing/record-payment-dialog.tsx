import { createSignal, useContext } from "solid-js"
import { today } from "../../shared/form-values.ts"
import { CommandFeedback } from "../../shared/request-feedback.tsx"
import { ApiRuntime } from "../../shared/runtime.ts"
import { formatDecimal } from "../../ui/foundations/format.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { Button } from "../../ui/primitives/button.tsx"
import { Dialog } from "../../ui/primitives/dialog.tsx"
import { FormField } from "../../ui/primitives/form-field.tsx"
import { Form } from "../../ui/primitives/form.tsx"
import { Input } from "../../ui/primitives/input.tsx"
import { MoneyField } from "../../ui/primitives/money-field.tsx"
import { paymentPayload } from "./payloads.ts"
import { createPaymentMutation } from "./queries.ts"
import { type BillingDocument, paymentFailureMessages } from "./service.ts"

/** Whether a payment can still settle the document: credit notes and settled documents cannot. */
export const canRecordPayment = (document: BillingDocument) =>
  (document.kind === "customer_invoice" || document.kind === "supplier_bill") &&
  Number(document.openAmount) > 0

function RecordPaymentForm(props: {
  document: BillingDocument
  close: () => void
  reload: () => Promise<void>
}) {
  const scope = useContext(ApiRuntime)
  const [invalid, setInvalid] = createSignal(false)
  const receivable = () => props.document.kind === "customer_invoice"
  const mutation = createPaymentMutation(scope, props.close)

  return (
    <Form
      class={layout.stack}
      onSubmit={(value) => {
        const payload = paymentPayload(value, props.document)
        setInvalid(payload === undefined)

        if (payload !== undefined && !mutation.isPending) mutation.mutate(payload)
      }}
    >
      <p>
        {props.document.number} has {formatDecimal(props.document.openAmount)} open. Paying less
        leaves the rest open.
      </p>
      <FormField label="Payment date" required>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            name="paymentDate"
            type="date"
            value={today()}
            required
            disabled={mutation.isPending}
          />
        )}
      </FormField>
      <MoneyField
        label="Amount"
        name="amount"
        value={props.document.openAmount}
        required
        disabled={mutation.isPending}
        error={invalid() ? "Enter a date and an amount such as 100.00." : undefined}
      />
      <CommandFeedback
        error={mutation.error}
        messages={paymentFailureMessages}
        pending={mutation.isPending}
        success={mutation.isSuccess}
        successMessage={receivable() ? "Payment received." : "Payment made."}
        area="billing"
        reload={props.reload}
        reset={() => mutation.reset()}
      />
      <Button variant="primary" type="submit" loading={mutation.isPending}>
        {receivable() ? "Receive payment" : "Make payment"}
      </Button>
    </Form>
  )
}

/** Settles one billing document with a payment, which allocates the amount to it. */
export function RecordPaymentDialog(props: {
  document: BillingDocument
  reload: () => Promise<void>
}) {
  const [open, setOpen] = createSignal(false)

  const label = () =>
    props.document.kind === "customer_invoice" ? "Receive payment" : "Make payment"

  return (
    <Dialog
      open={open()}
      onOpenChange={setOpen}
      trigger={<span>{label()}</span>}
      triggerVariant="primary"
      title={label()}
      description="The payment posts to the ledger and reduces what is open on this document."
    >
      <RecordPaymentForm
        document={props.document}
        close={() => setOpen(false)}
        reload={props.reload}
      />
    </Dialog>
  )
}
