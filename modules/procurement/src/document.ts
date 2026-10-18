import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  DocumentAst,
  DocumentContext,
  documentContextFromSnapshot,
  DocumentNode,
  DocumentSnapshot,
  DocumentSnapshotInput,
  makeDocumentAst,
  makeDocumentSnapshot,
} from "../../../foundation/mod.ts"
import { PurchaseOrder, PurchaseOrderLineSnapshot } from "./contract.ts"
import { PurchaseOrderInvalidState } from "./errors.ts"

const Uuid = Schema.String.check(Schema.isUUID())

export const PurchaseOrderDocumentPayload = Schema.Struct({
  documentType: Schema.Literal("purchase_order"),
  status: Schema.Literal("confirmed"),
  supplierAccountId: Uuid,
  confirmedAt: Schema.String,
  total: PurchaseOrder.fields.total,
  lines: Schema.Array(PurchaseOrderLineSnapshot).check(Schema.isMinLength(1)),
})
export type PurchaseOrderDocumentPayload = Schema.Schema.Type<typeof PurchaseOrderDocumentPayload>

export const PurchaseOrderDocumentSnapshotInput = Schema.Struct({
  snapshotId: Schema.optionalKey(Uuid),
  capturedAt: DocumentSnapshotInput.fields.capturedAt,
})
export type PurchaseOrderDocumentSnapshotInput = Schema.Schema.Type<
  typeof PurchaseOrderDocumentSnapshotInput
>

export const PurchaseOrderDocumentSnapshot = Schema.Struct({
  ...DocumentSnapshot.fields,
  source: Schema.Struct({
    owner: Schema.Literal("procurement"),
    type: Schema.Literal("purchase_order"),
    id: Uuid,
  }),
  payload: PurchaseOrderDocumentPayload,
})
export type PurchaseOrderDocumentSnapshot = Schema.Schema.Type<typeof PurchaseOrderDocumentSnapshot>

export const makePurchaseOrderDocumentSnapshot = (order: unknown, input: unknown) =>
  Effect.gen(function* () {
    const decodedOrder = yield* Schema.decodeUnknownEffect(PurchaseOrder)(order)
    const decodedInput = yield* Schema.decodeUnknownEffect(PurchaseOrderDocumentSnapshotInput)(
      input,
    )
    if (decodedOrder.status !== "confirmed" || decodedOrder.confirmedAt === null) {
      return yield* Effect.fail(
        new PurchaseOrderInvalidState({
          tenantId: decodedOrder.tenantId,
          purchaseOrderId: decodedOrder.id,
          status: decodedOrder.status,
        }),
      )
    }
    const payload = yield* Schema.decodeUnknownEffect(PurchaseOrderDocumentPayload)({
      documentType: "purchase_order",
      status: "confirmed",
      supplierAccountId: decodedOrder.supplierAccountId,
      confirmedAt: decodedOrder.confirmedAt,
      total: decodedOrder.total,
      lines: decodedOrder.lines,
    })
    return yield* makeDocumentSnapshot({
      snapshotId: decodedInput.snapshotId,
      tenantId: decodedOrder.tenantId,
      source: {
        owner: "procurement",
        type: "purchase_order",
        id: decodedOrder.id,
      },
      capturedAt: decodedInput.capturedAt,
      schemaVersion: 1,
      payload,
    })
  })

export const makePurchaseOrderDocumentContext = (snapshot: unknown) =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(PurchaseOrderDocumentSnapshot)(snapshot)
    return documentContextFromSnapshot(decoded)
  })

export const makePurchaseOrderDocumentAst = (snapshot: unknown) =>
  Effect.gen(function* () {
    const decodedSnapshot = yield* Schema.decodeUnknownEffect(PurchaseOrderDocumentSnapshot)(
      snapshot,
    )
    const payload = yield* Schema.decodeUnknownEffect(PurchaseOrderDocumentPayload)(
      decodedSnapshot.payload,
    )
    const nodes: DocumentNode[] = [
      { _tag: "text", value: "PURCHASE ORDER" },
      { _tag: "text", value: `Order ${decodedSnapshot.source.id}` },
      { _tag: "text", value: `Supplier account ${payload.supplierAccountId}` },
      { _tag: "text", value: `Confirmed ${payload.confirmedAt}` },
      {
        _tag: "table",
        headers: ["Item", "Quantity", "Unit Price"],
        rows: payload.lines.map((line) => [line.itemId, line.quantity, line.unitPrice]),
      },
      { _tag: "text", value: `Total ${payload.total}` },
    ]
    return yield* makeDocumentAst({
      snapshotId: decodedSnapshot.snapshotId,
      documentType: "purchase_order",
      astVersion: 1,
      nodes,
    })
  })

export type PurchaseOrderDocumentAst = DocumentAst
export type PurchaseOrderDocumentContext = DocumentContext
