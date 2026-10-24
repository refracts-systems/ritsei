import { assert, describe, it } from "@effect/vitest"
import { invoicePayload, paymentPayload } from "./payloads.ts"
import type { BillingDocument } from "./service.ts"

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
