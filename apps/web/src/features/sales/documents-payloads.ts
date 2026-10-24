import { formText, isDate } from "../../shared/form-values.ts"
import type { FormValue } from "../../ui/primitives/form.tsx"
import type { OrderFulfillment } from "./documents.ts"

const positiveInteger = /^[1-9]\d*$/
const percent = /^\d{1,3}(\.\d{1,2})?$/

/** Units still to deliver on a fulfillment line. */
export const remainingQuantity = (line: OrderFulfillment["lines"][number]) =>
  Math.max(0, Number(line.quantity) - Number(line.delivered))

/**
 * The draft-quotation payload from `customerId`, `validUntil`, and `productId-n`, `quantity-n`,
 * `discount-n` for each of `lineCount` rows. A row without a product is skipped; a row with a
 * product needs a whole quantity and an optional discount of at most 100 percent. Undefined when
 * the customer or date is missing, no row is filled, or a filled row is malformed.
 */
export const quotationPayload = (value: FormValue, lineCount: number) => {
  const customerId = formText(value.customerId)
  const validUntil = formText(value.validUntil)
  const lines = []

  for (let index = 0; index < lineCount; index += 1) {
    const productId = formText(value[`productId-${index}`])
    const quantity = formText(value[`quantity-${index}`])
    const discount = formText(value[`discount-${index}`])

    if (productId === "") continue

    if (!positiveInteger.test(quantity)) return undefined

    if (discount !== "" && (!percent.test(discount) || Number(discount) > 100)) return undefined
    lines.push(
      discount === ""
        ? { productId, quantity }
        : { productId, quantity, discountPercent: discount },
    )
  }

  return customerId === "" || !isDate(validUntil) || lines.length === 0
    ? undefined
    : { customerId, validUntil, lines }
}

/**
 * The delivery payload from `warehouseId`, `deliveryDate`, and a `quantity-<orderLineId>` field
 * per fulfillment line. Zero or blank quantities are skipped; a quantity above what is still
 * undelivered makes the whole payload invalid, as does having nothing to deliver.
 */
export const deliveryPayload = (value: FormValue, fulfillment: OrderFulfillment) => {
  const warehouseId = formText(value.warehouseId)
  const deliveryDate = formText(value.deliveryDate)
  const lines = []

  for (const line of fulfillment.lines) {
    const quantity = formText(value[`quantity-${line.orderLineId}`])

    if (quantity === "" || quantity === "0") continue

    if (!positiveInteger.test(quantity) || Number(quantity) > remainingQuantity(line)) {
      return undefined
    }

    lines.push({ orderLineId: line.orderLineId, quantity })
  }

  return warehouseId === "" || !isDate(deliveryDate) || lines.length === 0
    ? undefined
    : { orderId: fulfillment.orderId, warehouseId, deliveryDate, lines }
}

const amount = /^\d+(\.\d{1,2})?$/

/**
 * The credit limit command from the `creditLimit` field: a non-negative amount with at most two
 * decimals, or null when the field is empty, which removes the limit. Undefined when malformed.
 */
export const creditLimitPayload = (value: FormValue) => {
  const limit = formText(value.creditLimit)

  if (limit === "") return { creditLimit: null }

  return amount.test(limit) ? { creditLimit: limit } : undefined
}
