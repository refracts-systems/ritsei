import { and, asc, eq } from "drizzle-orm"
import * as Effect from "effect/Effect"

import { invoiceLines, invoices } from "../../../../db/schema/billing.ts"
import {
  Database,
  formatSignedMinor,
  requireExactMajorToMinor,
} from "../../../../framework/foundation/mod.ts"
import type { BillingDocument } from "./contract.ts"
import { BillingDocumentNotFound } from "./errors.ts"

const normalize = (value: string) => formatSignedMinor(requireExactMajorToMinor(value, 2), 2)

export const makeBillingDocumentLoader = Effect.gen(function* () {
  const database = yield* Database

  return Effect.fn("Billing.loadDocument")(function* (
    tenantId: string,
    invoiceId: string,
    lock = false,
  ) {
    const loaded = yield* database.transaction(async (tx) => {
      const query = tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))

      const header = (await (lock ? query.for("update") : query))[0]

      if (header === undefined) return undefined

      const lines = await tx
        .select()
        .from(invoiceLines)
        .where(and(eq(invoiceLines.tenantId, tenantId), eq(invoiceLines.invoiceId, invoiceId)))
        .orderBy(asc(invoiceLines.id))

      return { header, lines }
    }, "billing.document.load")

    if (loaded === undefined) {
      return yield* Effect.fail(new BillingDocumentNotFound({ tenantId, invoiceId }))
    }

    const { header, lines } = loaded

    return {
      id: header.id,
      tenantId: header.tenantId,
      legalEntityId: header.legalEntityId,
      kind: header.kind,
      partyId: header.partyId,
      number: header.number,
      invoiceDate: header.invoiceDate,
      subtotal: normalize(header.subtotal),
      taxTotal: normalize(header.taxTotal),
      total: normalize(header.total),
      openAmount: normalize(header.openAmount),
      sourceType: header.sourceType,
      sourceId: header.sourceId,
      creditedInvoiceId: header.creditedInvoiceId,
      supplierReference: header.supplierReference,
      journalEntryId: header.journalEntryId,
      lines: lines.map((line) => ({
        id: line.id,
        productId: line.productId,
        description: line.description,
        quantity: line.quantity,
        unitPrice: normalize(line.unitPrice),
        netAmount: normalize(line.netAmount),
        taxCodeId: line.taxCodeId,
        taxAmount: normalize(line.taxAmount),
        sourceLineId: line.sourceLineId,
        matchedValue: normalize(line.matchedValue),
      })),
    } satisfies BillingDocument
  })
})
