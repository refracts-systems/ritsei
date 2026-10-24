import { formText, isDate } from "../../shared/form-values.ts"
import type { FormValue } from "../../ui/primitives/form.tsx"
import type { BillingDocument, OrderMatching } from "./service.ts"

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

const positiveInteger = /^[1-9]\d*$/
const money = /^\d+(\.\d{1,2})?$/

/** Units received and not returned, which is the most a first bill covers. */
export const billableQuantity = (line: OrderMatching["lines"][number]) =>
  Math.max(0, Number(line.received) - Number(line.returned))

/**
 * The supplier-bill payload from `purchaseOrderId`, `billDate`, `supplierReference`, and a
 * `quantity-<lineId>` and `unitPrice-<lineId>` pair per matching line. Lines with a blank or zero
 * quantity are skipped; a used line needs a whole quantity and a price with at most two decimals.
 */
export const billPayload = (value: FormValue, matching: OrderMatching) => {
  const supplierReference = formText(value.supplierReference)
  const billDate = formText(value.billDate)
  const lines = []

  for (const line of matching.lines) {
    const quantity = formText(value[`quantity-${line.purchaseOrderLineId}`])
    const unitPrice = formText(value[`unitPrice-${line.purchaseOrderLineId}`])

    if (quantity === "" || quantity === "0") continue

    if (!positiveInteger.test(quantity) || !money.test(unitPrice)) return undefined
    lines.push({ purchaseOrderLineId: line.purchaseOrderLineId, quantity, unitPrice })
  }

  return supplierReference === "" ||
    supplierReference.length > 128 ||
    !isDate(billDate) ||
    lines.length === 0
    ? undefined
    : { purchaseOrderId: matching.purchaseOrderId, billDate, supplierReference, lines }
}
