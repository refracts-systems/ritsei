import { assert, describe, it } from "@effect/vitest"
import { billableQuantity, billPayload, invoicePayload, paymentPayload } from "./payloads.ts"
import type { BillingDocument, OrderMatching } from "./service.ts"

const document: BillingDocument = {
  id: "01900000-0000-7000-8000-000000000030",
  tenantId: "01900000-0000-7000-8000-000000000010",
  legalEntityId: "01900000-0000-7000-8000-000000000020",
  kind: "customer_invoice",
  partyId: "01900000-0000-7000-8000-000000000021",
  number: "INV-0001",
  invoiceDate: "2026-10-24",
  subtotal: "100.00",
  taxTotal: "11.00",
  total: "111.00",
  openAmount: "111.00",
  sourceType: null,
  sourceId: null,
  creditedInvoiceId: null,
  supplierReference: null,
  lines: [],
}

describe("billing form payloads", () => {
  it("builds the invoice payload from a chosen order and a date", () => {
    assert.deepStrictEqual(invoicePayload({ orderId: " order-1 ", invoiceDate: "2026-10-24" }), {
      orderId: "order-1",
      invoiceDate: "2026-10-24",
    })
  })

  it("rejects an invoice without an order or with a malformed date", () => {
    assert.isUndefined(invoicePayload({ orderId: "", invoiceDate: "2026-10-24" }))
    assert.isUndefined(invoicePayload({ orderId: "order-1", invoiceDate: "24/10/2026" }))
    assert.isUndefined(invoicePayload({}))
  })

  it("builds a receipt for a customer invoice and a payment for a supplier bill", () => {
    const received = paymentPayload({ paymentDate: "2026-10-25", amount: "100.00" }, document)

    const paid = paymentPayload(
      { paymentDate: "2026-10-25", amount: "5" },
      { ...document, kind: "supplier_bill" },
    )

    assert.strictEqual(received?.side, "receivable")
    assert.strictEqual(received?.invoiceId, document.id)
    assert.strictEqual(paid?.side, "payable")
    assert.strictEqual(paid?.amount, "5")
  })

  it("rejects zero, negative, over-precise, and missing amounts", () => {
    for (const amount of ["0", "0.00", "-1", "1.234", "", "abc"]) {
      assert.isUndefined(paymentPayload({ paymentDate: "2026-10-25", amount }, document))
    }

    assert.isUndefined(paymentPayload({ paymentDate: "soon", amount: "10" }, document))
  })
})

const matching: OrderMatching = {
  purchaseOrderId: "01900000-0000-7000-8000-000000000040",
  partyId: "01900000-0000-7000-8000-000000000041",
  legalEntityId: "01900000-0000-7000-8000-000000000042",
  lines: [
    {
      purchaseOrderLineId: "line-a",
      productId: "01900000-0000-7000-8000-000000000043",
      ordered: "10",
      received: "6",
      returned: "1",
      unitPrice: "6.00",
    },
    {
      purchaseOrderLineId: "line-b",
      productId: "01900000-0000-7000-8000-000000000044",
      ordered: "2",
      received: "0",
      returned: "0",
      unitPrice: "50.00",
    },
  ],
}

describe("supplier bill payload", () => {
  const base = { billDate: "2026-10-24", supplierReference: "SUP-1" }

  it("bills what was received, net of returns", () => {
    assert.deepStrictEqual(matching.lines.map(billableQuantity), [5, 0])
  })

  it("builds the payload from the filled lines and skips blank or zero ones", () => {
    assert.deepStrictEqual(
      billPayload(
        { ...base, "quantity-line-a": "5", "unitPrice-line-a": "6.00", "quantity-line-b": "0" },
        matching,
      ),
      {
        purchaseOrderId: matching.purchaseOrderId,
        billDate: "2026-10-24",
        supplierReference: "SUP-1",
        lines: [{ purchaseOrderLineId: "line-a", quantity: "5", unitPrice: "6.00" }],
      },
    )
  })

  it("rejects a missing reference or date, nothing to bill, or a malformed line", () => {
    const line = { "quantity-line-a": "5", "unitPrice-line-a": "6.00" }
    assert.isUndefined(billPayload({ billDate: "2026-10-24", ...line }, matching))
    assert.isUndefined(billPayload({ supplierReference: "SUP-1", ...line }, matching))
    assert.isUndefined(
      billPayload({ ...base, supplierReference: "x".repeat(129), ...line }, matching),
    )
    assert.isUndefined(billPayload(base, matching))
    assert.isUndefined(billPayload({ ...base, ...line, "quantity-line-a": "1.5" }, matching))
    assert.isUndefined(billPayload({ ...base, ...line, "unitPrice-line-a": "6.001" }, matching))
    assert.isUndefined(billPayload({ ...base, ...line, "unitPrice-line-a": "" }, matching))
  })
})
