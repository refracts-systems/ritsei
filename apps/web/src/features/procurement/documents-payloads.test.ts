import { assert, describe, it } from "@effect/vitest"
import type { PurchaseMatching } from "./documents.ts"
import { draftPayload, receivable, returnable, stockPayload } from "./documents-payloads.ts"

const matching: PurchaseMatching = {
  purchaseOrderId: "01900000-0000-7000-8000-000000000001",
  supplierAccountId: "01900000-0000-7000-8000-000000000002",
  partyId: "01900000-0000-7000-8000-000000000003",
  legalEntityId: "01900000-0000-7000-8000-000000000004",
  status: "confirmed",
  lines: [
    {
      purchaseOrderLineId: "line-a",
      productId: "01900000-0000-7000-8000-000000000005",
      ordered: "10",
      received: "6",
      returned: "1",
      unitPrice: "6.00",
      taxCodeId: null,
    },
    {
      purchaseOrderLineId: "line-b",
      productId: "01900000-0000-7000-8000-000000000006",
      ordered: "2",
      received: "2",
      returned: "0",
      unitPrice: "50.00",
      taxCodeId: null,
    },
  ],
}

describe("purchase order draft payload", () => {
  it("keeps filled rows and takes an optional unit price", () => {
    assert.deepStrictEqual(
      draftPayload(
        {
          supplierAccountId: "s1",
          "productId-0": "p1",
          "quantity-0": "10",
          "unitPrice-0": "6.50",
          "productId-1": "",
          "productId-2": "p2",
          "quantity-2": "1",
          "unitPrice-2": "",
        },
        3,
      ),
      {
        supplierAccountId: "s1",
        lines: [
          { productId: "p1", quantity: "10", unitPrice: "6.50" },
          { productId: "p2", quantity: "1" },
        ],
      },
    )
  })

  it("rejects a missing supplier, no rows, or a malformed row", () => {
    const row = { "productId-0": "p1", "quantity-0": "1" }
    assert.isUndefined(draftPayload(row, 1))
    assert.isUndefined(draftPayload({ supplierAccountId: "s1" }, 1))
    assert.isUndefined(draftPayload({ supplierAccountId: "s1", ...row, "quantity-0": "0" }, 1))
    assert.isUndefined(draftPayload({ supplierAccountId: "s1", ...row, "unitPrice-0": "1.234" }, 1))
    assert.isUndefined(draftPayload({ supplierAccountId: "s1", ...row, "unitPrice-0": "-1" }, 1))
  })
})

describe("receipt and return payload", () => {
  const base = { warehouseId: "w1", date: "2026-10-24" }

  it("computes what can still be received and returned", () => {
    assert.deepStrictEqual(matching.lines.map(receivable), [4, 0])
    assert.deepStrictEqual(matching.lines.map(returnable), [5, 2])
  })

  it("builds a receipt within the limit and skips blank quantities", () => {
    assert.deepStrictEqual(
      stockPayload(
        { ...base, "quantity-line-a": "4", "quantity-line-b": "" },
        matching,
        receivable,
      ),
      {
        purchaseOrderId: matching.purchaseOrderId,
        warehouseId: "w1",
        date: "2026-10-24",
        lines: [{ purchaseOrderLineId: "line-a", quantity: "4" }],
      },
    )
  })

  it("rejects going over the limit, nothing to move, or a missing warehouse or date", () => {
    assert.isUndefined(stockPayload({ ...base, "quantity-line-a": "5" }, matching, receivable))
    assert.isUndefined(stockPayload({ ...base, "quantity-line-a": "6" }, matching, returnable))
    assert.isUndefined(stockPayload(base, matching, receivable))
    assert.isUndefined(stockPayload({ ...base, "quantity-line-a": "1.5" }, matching, receivable))
    assert.isUndefined(
      stockPayload({ date: "2026-10-24", "quantity-line-a": "1" }, matching, receivable),
    )
    assert.isUndefined(
      stockPayload({ warehouseId: "w1", "quantity-line-a": "1" }, matching, receivable),
    )
  })
})
