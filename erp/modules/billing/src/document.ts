import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  createDocumentAst,
  createDocumentSnapshot,
  DocumentSnapshot,
  DocumentSnapshotInput,
  DocumentTableNode,
  DocumentTextNode,
} from "../../../../framework/foundation/mod.ts"
import { BillingDocument, BillingDocumentLine } from "./contract.ts"

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))

export const CustomerInvoiceDocument = Schema.Struct({
  ...BillingDocument.fields,
  kind: Schema.Literal("customer_invoice"),
})

export const InvoiceDocumentPayload = Schema.Struct({
  number: NonEmptyString,
  invoiceDate: BillingDocument.fields.invoiceDate,
  legalEntityId: BillingDocument.fields.legalEntityId,
  partyId: BillingDocument.fields.partyId,
  issuerName: NonEmptyString,
  customerName: NonEmptyString,
  subtotal: BillingDocument.fields.subtotal,
  taxTotal: BillingDocument.fields.taxTotal,
  total: BillingDocument.fields.total,
  lines: Schema.Array(
    Schema.Struct({
      description: NonEmptyString,
      quantity: BillingDocumentLine.fields.quantity,
      unitPrice: BillingDocumentLine.fields.unitPrice,
      netAmount: BillingDocumentLine.fields.netAmount,
      taxAmount: BillingDocumentLine.fields.taxAmount,
    }),
  ).check(Schema.isMinLength(1)),
})

export const InvoiceDocumentSnapshotInput = Schema.Struct({
  snapshotId: Schema.optionalKey(DocumentSnapshot.fields.snapshotId),
  capturedAt: DocumentSnapshotInput.fields.capturedAt,
  issuerName: NonEmptyString,
  customerName: NonEmptyString,
})

export const InvoiceDocumentSnapshot = Schema.Struct({
  ...DocumentSnapshot.fields,
  source: Schema.Struct({
    owner: Schema.Literal("billing"),
    type: Schema.Literal("customer_invoice"),
    id: BillingDocument.fields.id,
  }),
  payload: InvoiceDocumentPayload,
})

/** Evaluation only: production issuance must obtain names from their owner in the posting transaction. */
export const makeInvoiceDocumentSnapshot = Effect.fn("Billing.makeInvoiceDocumentSnapshot")(
  function* (
    document: Schema.Codec.Encoded<typeof CustomerInvoiceDocument>,
    input: Schema.Codec.Encoded<typeof InvoiceDocumentSnapshotInput>,
  ) {
    const invoice = yield* Schema.decodeUnknownEffect(CustomerInvoiceDocument)(document)
    const decoded = yield* Schema.decodeUnknownEffect(InvoiceDocumentSnapshotInput)(input)

    const payload = yield* Schema.decodeUnknownEffect(InvoiceDocumentPayload)({
      number: invoice.number,
      invoiceDate: invoice.invoiceDate,
      legalEntityId: invoice.legalEntityId,
      partyId: invoice.partyId,
      issuerName: decoded.issuerName,
      customerName: decoded.customerName,
      subtotal: invoice.subtotal,
      taxTotal: invoice.taxTotal,
      total: invoice.total,
      lines: invoice.lines,
    })

    const source = { owner: "billing", type: "customer_invoice", id: invoice.id } as const

    const snapshot = yield* createDocumentSnapshot({
      snapshotId: decoded.snapshotId,
      tenantId: invoice.tenantId,
      source,
      capturedAt: decoded.capturedAt,
      schemaVersion: 1,
      payload,
    })

    return { ...snapshot, source, payload } satisfies Schema.Schema.Type<
      typeof InvoiceDocumentSnapshot
    >
  },
)

export const makeInvoiceDocumentAst = Effect.fn("Billing.makeInvoiceDocumentAst")(function* (
  snapshot: Schema.Codec.Encoded<typeof InvoiceDocumentSnapshot>,
) {
  const decoded = yield* Schema.decodeUnknownEffect(InvoiceDocumentSnapshot)(snapshot)
  const payload = decoded.payload

  return yield* createDocumentAst({
    snapshotId: decoded.snapshotId,
    documentType: "customer_invoice",
    astVersion: 1,
    nodes: [
      DocumentTextNode.make({ value: `INVOICE ${payload.number}` }),
      DocumentTextNode.make({ value: `From: ${payload.issuerName}` }),
      DocumentTextNode.make({ value: `To: ${payload.customerName}` }),
      DocumentTextNode.make({ value: `Date: ${payload.invoiceDate}` }),
      DocumentTableNode.make({
        headers: ["Description", "Quantity", "Unit price", "Net", "Tax"],
        rows: payload.lines.map((line) => [
          line.description,
          line.quantity,
          line.unitPrice,
          line.netAmount,
          line.taxAmount,
        ]),
      }),
      DocumentTextNode.make({ value: `Subtotal: ${payload.subtotal}` }),
      DocumentTextNode.make({ value: `Tax: ${payload.taxTotal}` }),
      DocumentTextNode.make({ value: `Total: ${payload.total}` }),
    ],
  })
})
