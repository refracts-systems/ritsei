import { assert, describe, it } from "@effect/vitest"
import { type DocumentNode, nodeHref } from "./service.ts"

const id = "01900000-0000-7000-8000-000000000001"
const legalEntityId = "01900000-0000-7000-8000-000000000002"

const node = (type: DocumentNode["type"]): DocumentNode => ({
  type,
  id,
  number: null,
  state: "open",
  amount: null,
  date: null,
  current: false,
})

describe("document flow links", () => {
  it("links the documents that have a workspace page", () => {
    assert.strictEqual(nodeHref(node("sales.quotation"), null), `/sales/quotations/${id}`)
    assert.strictEqual(nodeHref(node("sales.order"), null), `/sales/orders/${id}`)
    assert.strictEqual(nodeHref(node("procurement.purchase_order"), null), `/procurement/${id}`)
  })

  it("opens a billing document on the side of the ledger it belongs to", () => {
    assert.strictEqual(
      nodeHref(node("billing.customer_credit_note"), legalEntityId),
      `/billing/${id}?legalEntityId=${legalEntityId}&side=receivable`,
    )
    assert.strictEqual(
      nodeHref(node("billing.supplier_bill"), legalEntityId),
      `/billing/${id}?legalEntityId=${legalEntityId}&side=payable`,
    )
  })

  it("leaves out a link it cannot build", () => {
    assert.isUndefined(nodeHref(node("billing.customer_invoice"), null))
    assert.isUndefined(nodeHref(node("sales.delivery"), legalEntityId))
    assert.isUndefined(nodeHref(node("settlement.payment"), legalEntityId))
    assert.isUndefined(nodeHref(node("procurement.receipt"), legalEntityId))
  })
})
