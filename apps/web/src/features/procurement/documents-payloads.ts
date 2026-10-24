import { formText, isDate } from "../../shared/form-values.ts"
import type { FormValue } from "../../ui/primitives/form.tsx"
import type { PurchaseMatching } from "./documents.ts"

const positiveInteger = /^[1-9]\d*$/
const money = /^\d+(\.\d{1,2})?$/

type Line = PurchaseMatching["lines"][number]

/** Units that can still be received on a line. */
export const receivable = (line: Line) => Math.max(0, Number(line.ordered) - Number(line.received))

/** Units that were received and not yet returned. */
export const returnable = (line: Line) => Math.max(0, Number(line.received) - Number(line.returned))

/**
 * The draft payload from `supplierAccountId` and `productId-n`, `quantity-n`, `unitPrice-n` for
 * each of `lineCount` rows. A row without a product is skipped; a used row needs a whole quantity,
 * and an optional unit price with at most two decimals. Undefined when the supplier is missing,
 * no row is filled, or a used row is malformed.
 */
export const draftPayload = (value: FormValue, lineCount: number) => {
  const supplierAccountId = formText(value.supplierAccountId)
  const lines = []

  for (let index = 0; index < lineCount; index += 1) {
    const productId = formText(value[`productId-${index}`])
    const quantity = formText(value[`quantity-${index}`])
    const unitPrice = formText(value[`unitPrice-${index}`])

    if (productId === "") continue

    if (!positiveInteger.test(quantity)) return undefined

    if (unitPrice !== "" && !money.test(unitPrice)) return undefined
    lines.push(unitPrice === "" ? { productId, quantity } : { productId, quantity, unitPrice })
  }

  return supplierAccountId === "" || lines.length === 0 ? undefined : { supplierAccountId, lines }
}

/**
 * The receipt or return payload from `warehouseId`, `date`, and a `quantity-<lineId>` field per
 * line. Blank or zero quantities are skipped; a quantity above the line's limit makes the whole
 * payload invalid, as does having nothing to move.
 */
export const stockPayload = (
  value: FormValue,
  matching: PurchaseMatching,
  limit: (line: Line) => number,
) => {
  const warehouseId = formText(value.warehouseId)
  const date = formText(value.date)
  const lines = []

  for (const line of matching.lines) {
    const quantity = formText(value[`quantity-${line.purchaseOrderLineId}`])

    if (quantity === "" || quantity === "0") continue

    if (!positiveInteger.test(quantity) || Number(quantity) > limit(line)) return undefined
    lines.push({ purchaseOrderLineId: line.purchaseOrderLineId, quantity })
  }

  return warehouseId === "" || !isDate(date) || lines.length === 0
    ? undefined
    : { purchaseOrderId: matching.purchaseOrderId, warehouseId, date, lines }
}
