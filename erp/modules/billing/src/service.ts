import { and, asc, eq, inArray, lte, ne, sum } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  billingSources,
  invoiceLines,
  invoices,
  invoiceSettlements,
} from "../../../../db/schema/billing.ts"
import {
  Database,
  formatSignedMinor,
  requireExactMajorToMinor,
  uuidv7,
} from "../../../../framework/foundation/mod.ts"
import type { Principal as PrincipalSchema } from "../../../../framework/modules/auth/mod.ts"
import { AuthorizationService } from "../../../../framework/modules/authorization/mod.ts"
import { NumberingService } from "../../../../framework/modules/numbering/mod.ts"
import { GeneralLedgerService, type LedgerLineInput } from "../../accounting/mod.ts"
import { ProductService } from "../../product/mod.ts"
import { SalesDocumentService, SalesOrderInvalidState } from "../../sales/mod.ts"
import { TaxService } from "../../tax/mod.ts"
import { BillingCapabilities } from "./capabilities.ts"
import {
  ApplySettlementInput,
  type BillingDocument,
  BillingService,
  CreditInvoiceInput,
  GetBillingDocumentInput,
  type InvoiceKind,
  InvoiceSalesOrderInput,
  isCreditNote,
  ListBillingDocumentsInput,
  ListOpenItemsInput,
  sideOf,
} from "./contract.ts"
import {
  BillingDocumentNotFound,
  CreditExceedsInvoice,
  NothingToInvoice,
  SettlementConflict,
  SettlementExceedsOpenAmount,
} from "./errors.ts"

type Principal = Schema.Schema.Type<typeof PrincipalSchema>
type LedgerLine = Schema.Schema.Type<typeof LedgerLineInput>

const minor = (value: string) => requireExactMajorToMinor(value, 2)
const major = (value: bigint) => formatSignedMinor(value, 2)
const normalize = (value: string) => major(minor(value))

const prefixes: Record<InvoiceKind, string> = {
  customer_invoice: "INV/",
  customer_credit_note: "CN/",
  supplier_bill: "BILL/",
  supplier_credit_note: "DN/",
}

/** The kinds a receivable or payable side holds, for open-item queries. */
const kindsOf = (side: "receivable" | "payable"): InvoiceKind[] =>
  side === "receivable"
    ? ["customer_invoice", "customer_credit_note"]
    : ["supplier_bill", "supplier_credit_note"]

export type DraftLine = {
  readonly productId: string | null
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly taxCodeId: string | null
  readonly sourceLineId: string | null
}

export type DraftDocument = {
  readonly principal: Principal
  readonly tenantId: string
  readonly invoiceId: string
  readonly legalEntityId: string
  readonly kind: InvoiceKind
  readonly partyId: string
  readonly invoiceDate: string
  readonly sourceType: string | null
  readonly sourceId: string | null
  readonly creditedInvoiceId: string | null
  readonly supplierReference: string | null
  readonly lines: ReadonlyArray<DraftLine>
  /** Ledger lines for the computed subtotal, tax, and total. */
  readonly journal: (amounts: {
    readonly subtotal: string
    readonly taxTotal: string
    readonly total: string
  }) => ReadonlyArray<LedgerLine>
}

export const makeBillingService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const ledger = yield* GeneralLedgerService
  const numbering = yield* NumberingService
  const tax = yield* TaxService
  const sales = yield* SalesDocumentService
  const products = yield* ProductService

  const authorize = (input: { principal: Principal; tenantId: string }, capability: string) =>
    authorization.authorize({ principal: input.principal, tenantId: input.tenantId, capability })

  const loadDocument = (tenantId: string, invoiceId: string, lock = false) =>
    Effect.gen(function* () {
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
        })),
      } satisfies BillingDocument
    })

  const existing = (tenantId: string, invoiceId: string) =>
    loadDocument(tenantId, invoiceId).pipe(
      Effect.map((document) => document as BillingDocument | undefined),
      Effect.catchTag("BillingDocumentNotFound", () => Effect.succeed(undefined)),
    )

  /** Locks a billed source so concurrent documents for it serialize. */
  const lockSource = (tenantId: string, sourceType: string, sourceId: string) =>
    database.transaction(async (tx) => {
      await tx
        .insert(billingSources)
        .values({ tenantId, sourceType, sourceId })
        .onConflictDoNothing()
      await tx
        .select()
        .from(billingSources)
        .where(
          and(
            eq(billingSources.tenantId, tenantId),
            eq(billingSources.sourceType, sourceType),
            eq(billingSources.sourceId, sourceId),
          ),
        )
        .for("update")
    }, "billing.source.lock")

  /** Quantity already billed per source line by documents of the given kind. */
  const billedQuantities = (tenantId: string, kind: InvoiceKind, sourceLineIds: string[]) =>
    sourceLineIds.length === 0
      ? Effect.succeed(new Map<string, bigint>())
      : database
          .query(
            (db) =>
              db
                .select({
                  sourceLineId: invoiceLines.sourceLineId,
                  quantity: sum(invoiceLines.quantity),
                })
                .from(invoiceLines)
                .innerJoin(
                  invoices,
                  and(
                    eq(invoices.tenantId, invoiceLines.tenantId),
                    eq(invoices.id, invoiceLines.invoiceId),
                  ),
                )
                .where(
                  and(
                    eq(invoiceLines.tenantId, tenantId),
                    eq(invoices.kind, kind),
                    inArray(invoiceLines.sourceLineId, sourceLineIds),
                  ),
                )
                .groupBy(invoiceLines.sourceLineId),
            "billing.billed_quantities",
          )
          .pipe(
            Effect.map(
              (rows) =>
                new Map(rows.map((row) => [row.sourceLineId!, BigInt(row.quantity ?? "0")])),
            ),
          )

  /** Computes tax, numbers, posts, and stores a document in the caller's transaction. */
  const post = (draft: DraftDocument) =>
    Effect.gen(function* () {
      const direction = sideOf(draft.kind) === "receivable" ? "sales" : "purchase"
      const priced = draft.lines.map((line, index) => ({
        ...line,
        key: String(index),
        netAmount: major(minor(line.unitPrice) * BigInt(line.quantity)),
      }))
      const computed = yield* tax.computeTax({
        principal: draft.principal,
        tenantId: draft.tenantId,
        direction,
        lines: priced.map((line) => ({
          key: line.key,
          base: line.netAmount,
          taxCodeId: line.taxCodeId,
        })),
      })
      const taxByKey = new Map(computed.lines.map((line) => [line.key, line.tax]))
      const subtotal = major(priced.reduce((sum, line) => sum + minor(line.netAmount), 0n))
      const taxTotal = computed.totalTax
      const total = major(minor(subtotal) + minor(taxTotal))
      const allocated = yield* numbering
        .allocate({
          tenantId: draft.tenantId,
          scopeId: draft.legalEntityId,
          documentType: `billing.${draft.kind}`,
          documentId: draft.invoiceId,
          documentDate: draft.invoiceDate,
          fiscalYearStartMonth: 1,
          prefix: prefixes[draft.kind],
        })
        .pipe(Effect.catchTag("SchemaError", (error) => Effect.die(error)))
      const journal = yield* ledger.postDocumentEntry({
        principal: draft.principal,
        tenantId: draft.tenantId,
        legalEntityId: draft.legalEntityId,
        postingDate: draft.invoiceDate,
        reference: `billing/${draft.kind}/${draft.invoiceId}`,
        description: `${allocated.number}`,
        source: { type: `billing.${draft.kind}`, id: draft.invoiceId },
        lines: draft
          .journal({ subtotal, taxTotal, total })
          .filter((line) => minor(line.debit) > 0n || minor(line.credit) > 0n),
      })
      yield* database.transaction(async (tx) => {
        await tx.insert(invoices).values({
          id: draft.invoiceId,
          tenantId: draft.tenantId,
          legalEntityId: draft.legalEntityId,
          kind: draft.kind,
          partyId: draft.partyId,
          number: allocated.number,
          invoiceDate: draft.invoiceDate,
          subtotal,
          taxTotal,
          total,
          openAmount: total,
          sourceType: draft.sourceType,
          sourceId: draft.sourceId,
          creditedInvoiceId: draft.creditedInvoiceId,
          supplierReference: draft.supplierReference,
          journalEntryId: journal.id,
        })
        await tx.insert(invoiceLines).values(
          priced.map((line) => ({
            tenantId: draft.tenantId,
            invoiceId: draft.invoiceId,
            productId: line.productId,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            netAmount: line.netAmount,
            taxCodeId: line.taxCodeId,
            taxAmount: taxByKey.get(line.key)!,
            sourceLineId: line.sourceLineId,
          })),
        )
      }, "billing.document.insert")
      return yield* loadDocument(draft.tenantId, draft.invoiceId).pipe(
        Effect.catchTag("BillingDocumentNotFound", (error) => Effect.die(error)),
      )
    })

  /** Applies `amount` of `source` to an open document; replaying the same source is a no-op. */
  const settle = (
    tenantId: string,
    invoiceId: string,
    amount: bigint,
    source: { readonly type: string; readonly id: string },
  ) =>
    Effect.gen(function* () {
      const document = yield* loadDocument(tenantId, invoiceId, true)
      const prior = (yield* database.query(
        (db) =>
          db
            .select({ amount: invoiceSettlements.amount })
            .from(invoiceSettlements)
            .where(
              and(
                eq(invoiceSettlements.tenantId, tenantId),
                eq(invoiceSettlements.invoiceId, invoiceId),
                eq(invoiceSettlements.sourceType, source.type),
                eq(invoiceSettlements.sourceId, source.id),
              ),
            ),
        "billing.settlement.lookup",
      ))[0]
      if (prior !== undefined) {
        if (minor(prior.amount) === amount) return document
        return yield* Effect.fail(
          new SettlementConflict({ tenantId, invoiceId, sourceId: source.id }),
        )
      }
      if (amount > minor(document.openAmount)) {
        return yield* Effect.fail(
          new SettlementExceedsOpenAmount({
            tenantId,
            invoiceId,
            openAmount: document.openAmount,
            requested: major(amount),
          }),
        )
      }
      const openAmount = major(minor(document.openAmount) - amount)
      yield* database.transaction(async (tx) => {
        await tx.insert(invoiceSettlements).values({
          tenantId,
          invoiceId,
          sourceType: source.type,
          sourceId: source.id,
          amount: major(amount),
        })
        await tx
          .update(invoices)
          .set({ openAmount })
          .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
      }, "billing.settlement.apply")
      return { ...document, openAmount }
    })

  const invoiceSalesOrder = Effect.fn("BillingService.invoiceSalesOrder")(function* (
    input: unknown,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(InvoiceSalesOrderInput)(input)
    yield* authorize(decoded, BillingCapabilities.customerInvoiceCreate)
    return yield* database.withTransaction(
      Effect.gen(function* () {
        if (decoded.invoiceId !== undefined) {
          const posted = yield* existing(decoded.tenantId, decoded.invoiceId)
          if (posted !== undefined) return posted
        }
        yield* lockSource(decoded.tenantId, "sales.order", decoded.orderId)
        const order = yield* sales.getFulfillment({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          orderId: decoded.orderId,
        })
        if (order.status !== "confirmed") {
          return yield* Effect.fail(
            new SalesOrderInvalidState({
              tenantId: decoded.tenantId,
              orderId: decoded.orderId,
              status: order.status,
            }),
          )
        }
        const invoiced = yield* billedQuantities(
          decoded.tenantId,
          "customer_invoice",
          order.lines.map((line) => line.orderLineId),
        )
        // Invoice policy: bill what was delivered and not yet invoiced.
        const billable = order.lines.flatMap((line) => {
          const quantity = BigInt(line.delivered) - (invoiced.get(line.orderLineId) ?? 0n)
          return quantity > 0n ? [{ line, quantity }] : []
        })
        if (billable.length === 0) {
          return yield* Effect.fail(
            new NothingToInvoice({ tenantId: decoded.tenantId, sourceId: decoded.orderId }),
          )
        }
        const lines: DraftLine[] = []
        for (const { line, quantity } of billable) {
          const product = yield* products.getProduct({
            principal: decoded.principal,
            tenantId: decoded.tenantId,
            productId: line.productId,
          })
          lines.push({
            productId: line.productId,
            description: `${product.code} ${product.name}`,
            quantity: quantity.toString(),
            unitPrice: line.unitPrice,
            taxCodeId: line.taxCodeId,
            sourceLineId: line.orderLineId,
          })
        }
        return yield* post({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          invoiceId: decoded.invoiceId ?? uuidv7(),
          legalEntityId: order.legalEntityId,
          kind: "customer_invoice",
          partyId: order.partyId,
          invoiceDate: decoded.invoiceDate,
          sourceType: "sales.order",
          sourceId: order.orderId,
          creditedInvoiceId: null,
          supplierReference: null,
          lines,
          journal: ({ subtotal, taxTotal, total }) => [
            { role: "receivable", debit: total, credit: "0" },
            { role: "revenue", debit: "0", credit: subtotal },
            { role: "output_tax", debit: "0", credit: taxTotal },
          ],
        })
      }),
      "billing.customer_invoice.atomic",
    )
  })

  const creditInvoice = Effect.fn("BillingService.creditInvoice")(function* (input: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(CreditInvoiceInput)(input)
    yield* authorize(decoded, BillingCapabilities.creditNoteCreate)
    return yield* database.withTransaction(
      Effect.gen(function* () {
        if (decoded.creditNoteId !== undefined) {
          const posted = yield* existing(decoded.tenantId, decoded.creditNoteId)
          if (posted !== undefined) return posted
        }
        const invoice = yield* loadDocument(decoded.tenantId, decoded.invoiceId, true)
        if (isCreditNote(invoice.kind)) {
          return yield* Effect.fail(
            new BillingDocumentNotFound({
              tenantId: decoded.tenantId,
              invoiceId: decoded.invoiceId,
            }),
          )
        }
        const creditKind: InvoiceKind =
          invoice.kind === "customer_invoice" ? "customer_credit_note" : "supplier_credit_note"
        const credited = yield* billedQuantities(
          decoded.tenantId,
          creditKind,
          invoice.lines.map((line) => line.id),
        )
        const byId = new Map(invoice.lines.map((line) => [line.id, line]))
        const lines: DraftLine[] = []
        for (const requested of decoded.lines) {
          const line = byId.get(requested.invoiceLineId)
          const available =
            line === undefined ? 0n : BigInt(line.quantity) - (credited.get(line.id) ?? 0n)
          if (line === undefined || BigInt(requested.quantity) > available) {
            return yield* Effect.fail(
              new CreditExceedsInvoice({
                tenantId: decoded.tenantId,
                invoiceLineId: requested.invoiceLineId,
                available: available.toString(),
              }),
            )
          }
          lines.push({
            productId: line.productId,
            description: line.description,
            quantity: requested.quantity,
            unitPrice: line.unitPrice,
            taxCodeId: line.taxCodeId,
            sourceLineId: line.id,
          })
        }
        const receivable = invoice.kind === "customer_invoice"
        const creditNote = yield* post({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          invoiceId: decoded.creditNoteId ?? uuidv7(),
          legalEntityId: invoice.legalEntityId,
          kind: creditKind,
          partyId: invoice.partyId,
          invoiceDate: decoded.creditDate,
          sourceType: invoice.sourceType,
          sourceId: invoice.sourceId,
          creditedInvoiceId: invoice.id,
          supplierReference: null,
          lines,
          journal: ({ subtotal, taxTotal, total }) =>
            receivable
              ? [
                  { role: "revenue", debit: subtotal, credit: "0" },
                  { role: "output_tax", debit: taxTotal, credit: "0" },
                  { role: "receivable", debit: "0", credit: total },
                ]
              : [
                  { role: "payable", debit: total, credit: "0" },
                  { role: "goods_received_not_invoiced", debit: "0", credit: subtotal },
                  { role: "input_tax", debit: "0", credit: taxTotal },
                ],
        })
        // The credit settles the invoice first; any remainder stays open as a credit balance.
        const applied =
          minor(invoice.openAmount) < minor(creditNote.total)
            ? minor(invoice.openAmount)
            : minor(creditNote.total)
        if (applied === 0n) return creditNote
        // The applied amount never exceeds either open amount, so settlement cannot fail here.
        const impossible = (error: unknown) => Effect.die(error)
        yield* settle(decoded.tenantId, invoice.id, applied, {
          type: `billing.${creditKind}`,
          id: creditNote.id,
        }).pipe(
          Effect.catchTags({
            BillingDocumentNotFound: impossible,
            SettlementConflict: impossible,
            SettlementExceedsOpenAmount: impossible,
          }),
        )
        return yield* settle(decoded.tenantId, creditNote.id, applied, {
          type: `billing.${invoice.kind}`,
          id: invoice.id,
        }).pipe(
          Effect.catchTags({
            BillingDocumentNotFound: impossible,
            SettlementConflict: impossible,
            SettlementExceedsOpenAmount: impossible,
          }),
        )
      }),
      "billing.credit_note.atomic",
    )
  })

  const applySettlement = Effect.fn("BillingService.applySettlement")(function* (input: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(ApplySettlementInput)(input)
    yield* authorize(decoded, BillingCapabilities.settlementApply)
    return yield* database.withTransaction(
      settle(decoded.tenantId, decoded.invoiceId, minor(decoded.amount), decoded.source),
      "billing.settlement.atomic",
    )
  })

  const getDocument = Effect.fn("BillingService.getDocument")(function* (input: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(GetBillingDocumentInput)(input)
    yield* authorize(decoded, BillingCapabilities.documentRead)
    return yield* loadDocument(decoded.tenantId, decoded.invoiceId)
  })

  const listDocuments = Effect.fn("BillingService.listDocuments")(function* (input: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(ListBillingDocumentsInput)(input)
    yield* authorize(decoded, BillingCapabilities.documentRead)
    const rows = yield* database.query(
      (db) =>
        db
          .select({ id: invoices.id })
          .from(invoices)
          .where(
            and(
              eq(invoices.tenantId, decoded.tenantId),
              eq(invoices.legalEntityId, decoded.legalEntityId),
              decoded.partyId === undefined ? undefined : eq(invoices.partyId, decoded.partyId),
              decoded.side === undefined
                ? undefined
                : inArray(invoices.kind, kindsOf(decoded.side)),
              decoded.to === undefined ? undefined : lte(invoices.invoiceDate, decoded.to),
            ),
          )
          .orderBy(asc(invoices.invoiceDate), asc(invoices.number))
          .limit(500),
      "billing.document.list",
    )
    return yield* Effect.forEach(rows, (row) => loadDocument(decoded.tenantId, row.id)).pipe(
      Effect.catchTag("BillingDocumentNotFound", (error) => Effect.die(error)),
    )
  })

  const listOpenItems = Effect.fn("BillingService.listOpenItems")(function* (input: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(ListOpenItemsInput)(input)
    yield* authorize(decoded, BillingCapabilities.documentRead)
    const rows = yield* database.query(
      (db) =>
        db
          .select({
            invoiceId: invoices.id,
            kind: invoices.kind,
            number: invoices.number,
            partyId: invoices.partyId,
            invoiceDate: invoices.invoiceDate,
            total: invoices.total,
            openAmount: invoices.openAmount,
          })
          .from(invoices)
          .where(
            and(
              eq(invoices.tenantId, decoded.tenantId),
              eq(invoices.legalEntityId, decoded.legalEntityId),
              inArray(invoices.kind, kindsOf(decoded.side)),
              ne(invoices.openAmount, "0"),
              lte(invoices.invoiceDate, decoded.asOf),
              decoded.partyId === undefined ? undefined : eq(invoices.partyId, decoded.partyId),
            ),
          )
          .orderBy(asc(invoices.invoiceDate), asc(invoices.number)),
      "billing.open_items",
    )
    return rows.map((row) => ({
      ...row,
      total: normalize(row.total),
      openAmount: major(isCreditNote(row.kind) ? -minor(row.openAmount) : minor(row.openAmount)),
    }))
  })

  return {
    invoiceSalesOrder,
    creditInvoice,
    applySettlement,
    getDocument,
    listDocuments,
    listOpenItems,
  } satisfies BillingService
})

export const BillingLive = Layer.effect(BillingService, makeBillingService)
