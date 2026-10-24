import { formText, isDate } from "../../shared/form-values.ts"
import type { FormValue } from "../../ui/primitives/form.tsx"
import type { BillingDocument } from "./service.ts"

const isPositiveAmount = (value: string) => /^\d+(\.\d{1,2})?$/.test(value) && /[1-9]/.test(value)

/** The create-invoice payload, or undefined when the order or date is missing or malformed. */
export const invoicePayload = (value: FormValue) => {
  const orderId = formText(value.orderId)
  const invoiceDate = formText(value.invoiceDate)

  return orderId === "" || !isDate(invoiceDate) ? undefined : { orderId, invoiceDate }
}

/** The record-payment payload for one document, or undefined when the date or amount is invalid. */
export const paymentPayload = (value: FormValue, document: BillingDocument) => {
  const paymentDate = formText(value.paymentDate)
  const amount = formText(value.amount)

  return isDate(paymentDate) && isPositiveAmount(amount)
    ? {
        side: document.kind === "customer_invoice" ? ("receivable" as const) : ("payable" as const),
        legalEntityId: document.legalEntityId,
        partyId: document.partyId,
        invoiceId: document.id,
        paymentDate,
        amount,
      }
    : undefined
}
