import { assert, describe, it } from "@effect/vitest"

import { arrangeChain, billingState, type FlowNode } from "../src/chain.ts"
import { DocumentsModule } from "../mod.ts"

const node = (overrides: Partial<FlowNode> & Pick<FlowNode, "type" | "id">): FlowNode => ({
  number: null,
  state: "open",
  amount: null,
  date: null,
  ...overrides,
})

describe("documents module", () => {
  // The registry as a whole, including dependencies, is validated in tests/architecture/modules.test.ts.
  it("declares the owners it reads from and its HTTP group", () => {
    assert.strictEqual(DocumentsModule.name, "documents")
    assert.deepStrictEqual(DocumentsModule.dependsOn, [
      "billing",
      "procurement",
      "sales",
      "settlement",
    ])
    assert.deepStrictEqual(DocumentsModule.http, ["Documents"])
  })

  it("orders a chain by stage, then date, and marks the requested document", () => {
    const arranged = arrangeChain(
      [
        node({ type: "settlement.payment", id: "p1", date: "2026-10-05" }),
        node({ type: "billing.customer_invoice", id: "i2", number: "INV-2", date: "2026-10-03" }),
        node({ type: "billing.customer_invoice", id: "i1", number: "INV-1", date: "2026-10-02" }),
        node({ type: "sales.order", id: "o1" }),
        node({ type: "sales.quotation", id: "q1" }),
        node({ type: "sales.delivery", id: "d1", date: "2026-10-01" }),
      ],
      "i1",
    )

    assert.deepStrictEqual(
      arranged.map((entry) => entry.id),
      ["q1", "o1", "d1", "i1", "i2", "p1"],
    )
    assert.deepStrictEqual(
      arranged.filter((entry) => entry.current).map((entry) => entry.id),
      ["i1"],
    )
  })

  it("places a purchase return after the receipts and before the bills", () => {
    const arranged = arrangeChain(
      [
        node({ type: "billing.supplier_bill", id: "b1", number: "BILL-1", date: "2026-10-01" }),
        node({ type: "procurement.return", id: "r1", number: "RET-1", date: "2026-10-09" }),
        node({ type: "procurement.receipt", id: "g1", date: "2026-10-08" }),
        node({ type: "procurement.purchase_order", id: "p1" }),
      ],
      "p1",
    )

    assert.deepStrictEqual(
      arranged.map((entry) => entry.id),
      ["p1", "g1", "r1", "b1"],
    )
  })

  it("lists a document once even when two walks reach it", () => {
    const repeated = node({ type: "billing.supplier_bill", id: "b1", number: "BILL-1" })

    assert.strictEqual(arrangeChain([repeated, repeated], "b1").length, 1)
  })

  it("names the state of a billing document from what is still open", () => {
    assert.strictEqual(billingState("billing.customer_invoice", "10.00"), "open")
    assert.strictEqual(billingState("billing.customer_invoice", "0.00"), "settled")
    assert.strictEqual(billingState("billing.customer_credit_note", "-0.00"), "applied")
    assert.strictEqual(billingState("billing.customer_credit_note", "-5.00"), "open")
  })
})
