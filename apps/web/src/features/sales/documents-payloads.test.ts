import { assert, describe, it } from "@effect/vitest"
import type { OrderFulfillment } from "./documents.ts"
import {
  creditLimitPayload,
  deliveryPayload,
  quotationPayload,
  remainingQuantity,
} from "./documents-payloads.ts"

const fulfillment: OrderFulfillment = {
  orderId: "01900000-0000-7000-8000-000000000001",
  tenantId: "01900000-0000-7000-8000-000000000002",
  legalEntityId: "01900000-0000-7000-8000-000000000003",
  customerId: "01900000-0000-7000-8000-000000000004",
  partyId: "01900000-0000-7000-8000-000000000005",
  status: "confirmed",
  lines: [
    {
      orderLineId: "line-a",
      productId: "01900000-0000-7000-8000-000000000006",
      quantity: "10",
      unitPrice: "9.00",
      taxCodeId: null,
      delivered: "6",
    },
    {
      orderLineId: "line-b",
      productId: "01900000-0000-7000-8000-000000000007",
      quantity: "1",
      unitPrice: "50.00",
      taxCodeId: null,
      delivered: "1",
    },
  ],
}

describe("quotation payload", () => {
  const base = { customerId: "c1", validUntil: "2026-12-31" }

  it("keeps filled rows and skips rows without a product", () => {
    assert.deepStrictEqual(
      quotationPayload(
        {
          ...base,
          "productId-0": "p1",
          "quantity-0": "10",
          "discount-0": "10",
          "productId-1": "",
          "quantity-1": "",
          "productId-2": "p2",
          "quantity-2": "1",
          "discount-2": "",
        },
        3,
      ),
      {
        customerId: "c1",
        validUntil: "2026-12-31",
        lines: [
          { productId: "p1", quantity: "10", discountPercent: "10" },
          { productId: "p2", quantity: "1" },
        ],
      },
    )
  })

  it("rejects a missing customer or date, no rows, or a malformed row", () => {
    const row = { "productId-0": "p1", "quantity-0": "1" }
    assert.isUndefined(quotationPayload({ validUntil: "2026-12-31", ...row }, 1))
    assert.isUndefined(quotationPayload({ customerId: "c1", validUntil: "soon", ...row }, 1))
    assert.isUndefined(quotationPayload(base, 1))
    assert.isUndefined(quotationPayload({ ...base, "productId-0": "p1", "quantity-0": "0" }, 1))
    assert.isUndefined(quotationPayload({ ...base, "productId-0": "p1", "quantity-0": "1.5" }, 1))
    assert.isUndefined(quotationPayload({ ...base, ...row, "discount-0": "101" }, 1))
    assert.isUndefined(quotationPayload({ ...base, ...row, "discount-0": "abc" }, 1))
  })
})

describe("delivery payload", () => {
  const base = { warehouseId: "w1", deliveryDate: "2026-10-24" }

  it("computes what is still undelivered", () => {
    assert.deepStrictEqual(fulfillment.lines.map(remainingQuantity), [4, 0])
  })

  it("delivers the filled quantities and skips blank or zero ones", () => {
    assert.deepStrictEqual(
      deliveryPayload({ ...base, "quantity-line-a": "4", "quantity-line-b": "0" }, fulfillment),
      {
        orderId: fulfillment.orderId,
        warehouseId: "w1",
        deliveryDate: "2026-10-24",
        lines: [{ orderLineId: "line-a", quantity: "4" }],
      },
    )
  })

  it("rejects delivering more than is left, nothing at all, or a missing warehouse or date", () => {
    assert.isUndefined(deliveryPayload({ ...base, "quantity-line-a": "5" }, fulfillment))
    assert.isUndefined(deliveryPayload({ ...base, "quantity-line-b": "1" }, fulfillment))
    assert.isUndefined(deliveryPayload(base, fulfillment))
    assert.isUndefined(deliveryPayload({ ...base, "quantity-line-a": "1.5" }, fulfillment))
    assert.isUndefined(
      deliveryPayload({ deliveryDate: "2026-10-24", "quantity-line-a": "1" }, fulfillment),
    )
    assert.isUndefined(deliveryPayload({ warehouseId: "w1", "quantity-line-a": "1" }, fulfillment))
  })
})

describe("creditLimitPayload", () => {
  it("sets a limit, or removes it when the field is empty", () => {
    assert.deepStrictEqual(creditLimitPayload({ creditLimit: " 5000.50 " }), {
      creditLimit: "5000.50",
    })
    assert.deepStrictEqual(creditLimitPayload({ creditLimit: "" }), { creditLimit: null })
  })

  it("rejects what is not an amount", () => {
    assert.isUndefined(creditLimitPayload({ creditLimit: "5000.555" }))
    assert.isUndefined(creditLimitPayload({ creditLimit: "-1" }))
    assert.isUndefined(creditLimitPayload({ creditLimit: "abc" }))
  })
})
