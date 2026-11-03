import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  DocumentAst,
  DocumentTableNode,
  DocumentTextNode,
} from "../../../../framework/foundation/mod.ts"
import {
  CustomerInvoiceDocument,
  InvoiceDocumentSnapshot,
  makeInvoiceDocumentAst,
  makeInvoiceDocumentSnapshot,
} from "../mod.ts"

const invoice: Schema.Codec.Encoded<typeof CustomerInvoiceDocument> = {
  id: "018f0000-0000-7000-8000-000000000001",
  tenantId: "018f0000-0000-7000-8000-000000000002",
  legalEntityId: "018f0000-0000-7000-8000-000000000003",
  kind: "customer_invoice",
  partyId: "018f0000-0000-7000-8000-000000000004",
  number: "INV-001",
  invoiceDate: "2026-11-04",
  subtotal: "25.00",
  taxTotal: "2.50",
  total: "27.50",
  openAmount: "27.50",
  sourceType: "sales.order",
  sourceId: "018f0000-0000-7000-8000-000000000005",
  creditedInvoiceId: null,
  supplierReference: null,
  journalEntryId: "018f0000-0000-7000-8000-000000000006",
  lines: [
    {
      id: "018f0000-0000-7000-8000-000000000007",
      productId: null,
      description: "Item",
      quantity: "2",
      unitPrice: "12.50",
      netAmount: "25.00",
      taxCodeId: null,
      taxAmount: "2.50",
      sourceLineId: null,
      matchedValue: "0.00",
    },
  ],
}

const snapshotInput = {
  snapshotId: "018f0000-0000-7000-8000-000000000008",
  capturedAt: "2026-11-04T00:00:00.000Z",
  issuerName: "Issuer Ltd",
  customerName: "Customer Ltd",
}

describe("invoice document evaluation", () => {
  it.effect("captures immutable invoice facts and builds its AST", () =>
    Effect.gen(function* () {
      const snapshot = yield* makeInvoiceDocumentSnapshot(invoice, snapshotInput)
      yield* Schema.decodeUnknownEffect(InvoiceDocumentSnapshot)(snapshot)

      const ast = yield* makeInvoiceDocumentAst(snapshot)
      yield* Schema.decodeUnknownEffect(DocumentAst)(ast)

      assert.strictEqual(snapshot.source.owner, "billing")
      assert.strictEqual(snapshot.source.id, invoice.id)
      assert.strictEqual(snapshot.payload.number, invoice.number)
      assert.strictEqual(snapshot.payload.customerName, snapshotInput.customerName)
      assert.notProperty(snapshot.payload, "openAmount")
      assert.strictEqual(ast.snapshotId, snapshot.snapshotId)
      assert.deepStrictEqual(ast.nodes[0], DocumentTextNode.make({ value: "INVOICE INV-001" }))
      assert.deepStrictEqual(
        ast.nodes[4],
        DocumentTableNode.make({
          headers: ["Description", "Quantity", "Unit price", "Net", "Tax"],
          rows: [["Item", "2", "12.50", "25.00", "2.50"]],
        }),
      )
      assert.deepStrictEqual(ast.nodes.at(-1), DocumentTextNode.make({ value: "Total: 27.50" }))
    }),
  )

  it.effect("does not change the issued snapshot when the open amount changes", () =>
    Effect.gen(function* () {
      const first = yield* makeInvoiceDocumentSnapshot(invoice, snapshotInput)

      const settled = yield* makeInvoiceDocumentSnapshot(
        { ...invoice, openAmount: "0.00" },
        snapshotInput,
      )

      const renamed = yield* makeInvoiceDocumentSnapshot(invoice, {
        ...snapshotInput,
        customerName: "Different Customer",
      })

      assert.strictEqual(settled.checksum, first.checksum)
      assert.notStrictEqual(renamed.checksum, first.checksum)
    }),
  )

  it.effect("rejects non-invoice documents at the snapshot boundary", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        Schema.decodeUnknownEffect(CustomerInvoiceDocument)({ ...invoice, kind: "supplier_bill" }),
      )

      assert.instanceOf(failure, Schema.SchemaError)
    }),
  )
})
