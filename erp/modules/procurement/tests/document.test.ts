import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  DocumentAst,
  DocumentContext,
  DocumentSnapshot,
} from "../../../../framework/foundation/mod.ts"
import {
  makePurchaseOrderDocumentAst,
  makePurchaseOrderDocumentContext,
  makePurchaseOrderDocumentSnapshot,
  PurchaseOrder,
  PurchaseOrderInvalidState,
} from "../mod.ts"

const tenantId = "018f0000-0000-7000-8000-000000000001"
const purchaseOrderId = "018f0000-0000-7000-8000-000000000010"
const supplierAccountId = "018f0000-0000-7000-8000-000000000011"
const lineId = "018f0000-0000-7000-8000-000000000012"
const itemId = "018f0000-0000-7000-8000-000000000013"
const snapshotId = "018f0000-0000-7000-8000-000000000014"
const confirmedAt = "2026-09-06T00:00:00.000Z"

const confirmedOrder: PurchaseOrder = {
  id: purchaseOrderId,
  tenantId,
  supplierAccountId,
  status: "confirmed",
  confirmedAt,
  total: "25.00",
  lines: [{ id: lineId, itemId, quantity: "2", unitPrice: "12.50" }],
}

describe("purchase order document pilot", () => {
  it.effect("creates an owner-local snapshot, context, and AST", () =>
    Effect.gen(function* () {
      const snapshot = yield* makePurchaseOrderDocumentSnapshot(confirmedOrder, {
        snapshotId,
        capturedAt: confirmedAt,
      })
      yield* Schema.decodeUnknownEffect(DocumentSnapshot)(snapshot)
      const context = yield* makePurchaseOrderDocumentContext(snapshot)
      yield* Schema.decodeUnknownEffect(DocumentContext)(context)
      const ast = yield* makePurchaseOrderDocumentAst(snapshot)
      yield* Schema.decodeUnknownEffect(DocumentAst)(ast)

      assert.strictEqual(snapshot.source.owner, "procurement")
      assert.strictEqual(snapshot.source.type, "purchase_order")
      assert.strictEqual(context.snapshotChecksum, snapshot.checksum)
      assert.strictEqual(ast.snapshotId, snapshot.snapshotId)
      assert.strictEqual(ast.documentType, "purchase_order")
      assert.strictEqual(ast.nodes[0]?._tag, "text")
      assert.strictEqual(ast.nodes[4]?._tag, "table")
      assert.strictEqual(ast.nodes[5]?._tag, "text")
    }),
  )

  it.effect("keeps snapshot checksums stable across capture timestamps", () =>
    Effect.gen(function* () {
      const first = yield* makePurchaseOrderDocumentSnapshot(confirmedOrder, {
        snapshotId,
        capturedAt: confirmedAt,
      })
      const second = yield* makePurchaseOrderDocumentSnapshot(confirmedOrder, {
        snapshotId,
        capturedAt: "2026-09-06T01:00:00.000Z",
      })
      assert.strictEqual(first.checksum, second.checksum)
    }),
  )

  it.effect("does not render an unconfirmed purchase order", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        makePurchaseOrderDocumentSnapshot(
          { ...confirmedOrder, status: "draft", confirmedAt: null },
          { snapshotId, capturedAt: confirmedAt },
        ),
      )
      assert.instanceOf(error, PurchaseOrderInvalidState)
      assert.strictEqual(error.status, "draft")
    }),
  )
})
