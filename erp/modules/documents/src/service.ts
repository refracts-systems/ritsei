import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { BillingService, type BillingDocumentType } from "../../billing/mod.ts"
import { ProcurementService, PurchaseDocumentService } from "../../procurement/mod.ts"
import { SalesDocumentService, SalesService } from "../../sales/mod.ts"
import { SettlementService } from "../../settlement/mod.ts"
import { arrangeChain, billingState, type FlowNode, instantDate } from "./chain.ts"
import { ChainInput, DocumentsService } from "./contract.ts"
import { DocumentNotFound } from "./errors.ts"

/**
 * Where a chain begins once the requested document is traced back to its source. The legal entity
 * comes from the document that has one; it is null while the customer or supplier has none, and no
 * billing document can exist then.
 */
type Root = {
  readonly kind: "quotation" | "order" | "purchase_order" | "document"
  readonly id: string
  readonly legalEntityId: string | null
}

export const makeDocumentsService = Effect.gen(function* () {
  const sales = yield* SalesService
  const salesDocuments = yield* SalesDocumentService
  const procurement = yield* ProcurementService
  const purchasing = yield* PurchaseDocumentService
  const billing = yield* BillingService
  const settlement = yield* SettlementService

  const billingNode = (document: BillingDocumentType): FlowNode => {
    const type = `billing.${document.kind}` as const

    return {
      type,
      id: document.id,
      number: document.number,
      state: billingState(type, document.openAmount),
      amount: document.total,
      date: document.invoiceDate,
    }
  }

  const chainOf = Effect.fn("DocumentsService.chain")(function* (
    input: Schema.Codec.Encoded<typeof ChainInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(ChainInput)(input)
    const scope = { principal: decoded.principal, tenantId: decoded.tenantId }

    const missing = new DocumentNotFound({
      tenantId: decoded.tenantId,
      documentType: decoded.documentType,
      documentId: decoded.documentId,
    })

    const orderLegalEntity = (orderId: string) =>
      salesDocuments.getFulfillment({ ...scope, orderId }).pipe(
        Effect.map((fulfillment): string | null => fulfillment.legalEntityId),
        Effect.catchTag("CustomerLegalEntityRequired", () => Effect.succeed(null)),
      )

    const orderRoot = Effect.fn("DocumentsService.orderRoot")(function* (orderId: string) {
      const order = yield* sales.getOrder({ ...scope, orderId })
      const legalEntityId = yield* orderLegalEntity(orderId)

      return {
        kind: order.quotationId === null ? "order" : "quotation",
        id: order.quotationId ?? order.id,
        legalEntityId,
      } satisfies Root
    })

    const purchaseOrderRoot = Effect.fn("DocumentsService.purchaseOrderRoot")(function* (
      purchaseOrderId: string,
    ) {
      yield* procurement.getPurchaseOrder({ ...scope, purchaseOrderId })

      const legalEntityId = yield* purchasing.getMatching({ ...scope, purchaseOrderId }).pipe(
        Effect.map((matching): string | null => matching.legalEntityId),
        Effect.catchTag("PartyRelationshipNotFound", () => Effect.succeed(null)),
        Effect.catchTag("PurchaseOrderNotFound", Effect.die),
      )

      return { kind: "purchase_order", id: purchaseOrderId, legalEntityId } satisfies Root
    })

    /** Traces a billing document, or the invoice a credit note credits, to its source. */
    const documentRoot = Effect.fn("DocumentsService.documentRoot")(function* (invoiceId: string) {
      const entry = yield* billing.getDocument({ ...scope, invoiceId })

      const base =
        entry.creditedInvoiceId === null
          ? entry
          : yield* billing.getDocument({ ...scope, invoiceId: entry.creditedInvoiceId })

      if (base.sourceType === "sales.order" && base.sourceId !== null) {
        return yield* orderRoot(base.sourceId)
      }

      return base.sourceType === "procurement.purchase_order" && base.sourceId !== null
        ? yield* purchaseOrderRoot(base.sourceId)
        : ({ kind: "document", id: base.id, legalEntityId: base.legalEntityId } satisfies Root)
    })

    const resolveRoot = Effect.fn("DocumentsService.resolveRoot")(function* () {
      switch (decoded.documentType) {
        case "sales.quotation": {
          const quotation = yield* salesDocuments.getQuotation({
            ...scope,
            quotationId: decoded.documentId,
          })

          return {
            kind: "quotation",
            id: quotation.id,
            legalEntityId: quotation.legalEntityId,
          } satisfies Root
        }

        case "sales.order":
          return yield* orderRoot(decoded.documentId)
        case "procurement.purchase_order":
          return yield* purchaseOrderRoot(decoded.documentId)
        case "billing.document":
          return yield* documentRoot(decoded.documentId)
      }
    })

    /** A document with the credit notes raised against it and the payments that settle it. */
    const settledDocument = Effect.fn("DocumentsService.settledDocument")(function* (
      document: BillingDocumentType,
    ) {
      const legal = { ...scope, legalEntityId: document.legalEntityId }
      const credits = yield* billing.listDocuments({ ...legal, creditedInvoiceId: document.id })
      const payments = yield* settlement.listPayments({ ...legal, invoiceId: document.id })

      return [
        billingNode(document),
        ...credits.map(billingNode),
        ...payments.map((payment): FlowNode => ({
          type: "settlement.payment",
          id: payment.id,
          number: payment.number,
          state: /^0+(\.0*)?$/.test(payment.unallocatedAmount) ? "allocated" : "partly allocated",
          amount: payment.amount,
          date: payment.paymentDate,
        })),
      ]
    })

    const documentsOf = Effect.fn("DocumentsService.documentsOf")(function* (
      side: "receivable" | "payable",
      sourceId: string,
      legalEntityId: string | null,
    ) {
      if (legalEntityId === null) return []

      const documents = yield* billing.listDocuments({ ...scope, legalEntityId, side, sourceId })

      return (yield* Effect.forEach(documents, settledDocument)).flat()
    })

    const orderNodes = Effect.fn("DocumentsService.orderNodes")(function* (
      orderId: string,
      legalEntityId: string | null,
    ) {
      const order = yield* sales
        .getOrder({ ...scope, orderId })
        .pipe(Effect.catchTag("SalesOrderNotFound", Effect.die))

      const deliveries = yield* salesDocuments.listDeliveries({ ...scope, orderId }).pipe(
        Effect.catchTags({
          SalesOrderNotFound: Effect.die,
          // Without a legal entity nothing could have been delivered or billed yet.
          CustomerLegalEntityRequired: () => Effect.succeed([]),
        }),
      )

      return [
        {
          type: "sales.order",
          id: order.id,
          number: null,
          state: order.status,
          amount: order.total,
          date: instantDate(order.confirmedAt),
        },
        ...deliveries.map((delivery): FlowNode => ({
          type: "sales.delivery",
          id: delivery.id,
          number: delivery.number,
          state: "delivered",
          amount: null,
          date: delivery.deliveryDate,
        })),
        ...(yield* documentsOf("receivable", order.id, legalEntityId)),
      ] satisfies ReadonlyArray<FlowNode>
    })

    const purchaseOrderNodes = Effect.fn("DocumentsService.purchaseOrderNodes")(function* (
      purchaseOrderId: string,
      legalEntityId: string | null,
    ) {
      const order = yield* procurement
        .getPurchaseOrder({ ...scope, purchaseOrderId })
        .pipe(Effect.catchTag("PurchaseOrderNotFound", Effect.die))

      const receipts = yield* procurement.listPurchaseReceipts({ ...scope, purchaseOrderId })
      const returns = yield* purchasing.listPurchaseReturns({ ...scope, purchaseOrderId })

      return [
        {
          type: "procurement.purchase_order",
          id: order.id,
          number: null,
          state: order.status,
          amount: order.total,
          date: instantDate(order.confirmedAt),
        },
        ...receipts.map((receipt): FlowNode => ({
          type: "procurement.receipt",
          id: receipt.id,
          number: null,
          state: "received",
          amount: null,
          date: instantDate(receipt.receivedAt),
        })),
        ...returns.map((purchaseReturn): FlowNode => ({
          type: "procurement.return",
          id: purchaseReturn.id,
          number: purchaseReturn.number,
          state: "returned",
          amount: null,
          date: purchaseReturn.returnDate,
        })),
        ...(yield* documentsOf("payable", order.id, legalEntityId)),
      ] satisfies ReadonlyArray<FlowNode>
    })

    const nodesOf = Effect.fn("DocumentsService.nodesOf")(function* (root: Root) {
      switch (root.kind) {
        case "order":
          return yield* orderNodes(root.id, root.legalEntityId)
        case "purchase_order":
          return yield* purchaseOrderNodes(root.id, root.legalEntityId)
        case "document": {
          const document = yield* billing
            .getDocument({ ...scope, invoiceId: root.id })
            .pipe(Effect.catchTag("BillingDocumentNotFound", Effect.die))

          return yield* settledDocument(document)
        }

        case "quotation": {
          const quotation = yield* salesDocuments
            .getQuotation({ ...scope, quotationId: root.id })
            .pipe(Effect.catchTag("QuotationNotFound", Effect.die))

          const orders = yield* sales.listOrders({ ...scope, quotationId: root.id })

          return [
            {
              type: "sales.quotation",
              id: quotation.id,
              number: null,
              state: quotation.status,
              amount: quotation.total,
              date: null,
            } satisfies FlowNode,
            ...(yield* Effect.forEach(orders, (order) =>
              orderNodes(order.id, quotation.legalEntityId),
            )).flat(),
          ]
        }
      }
    })

    const root = yield* resolveRoot().pipe(
      Effect.catchTags({
        SalesOrderNotFound: () => Effect.fail(missing),
        QuotationNotFound: () => Effect.fail(missing),
        PurchaseOrderNotFound: () => Effect.fail(missing),
        BillingDocumentNotFound: () => Effect.fail(missing),
      }),
    )

    return {
      legalEntityId: root.legalEntityId,
      nodes: arrangeChain(yield* nodesOf(root), decoded.documentId),
    }
  })

  return { chain: chainOf } satisfies DocumentsService
})

export const DocumentsLive = Layer.effect(DocumentsService, makeDocumentsService)
