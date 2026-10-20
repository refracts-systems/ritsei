import { and, asc, eq, inArray, lte, sql, sum } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
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
import { ApprovalService } from "../../../../framework/modules/approvals/mod.ts"
import {
  AuthorizationService,
  makeScopedCommand,
} from "../../../../framework/modules/authorization/mod.ts"
import { NumberingService } from "../../../../framework/modules/numbering/mod.ts"
import { GeneralLedgerService, type LedgerLineInput } from "../../accounting/mod.ts"
import { ProductService } from "../../product/mod.ts"
import {
  PurchaseDocumentService,
  PurchaseOrderInvalidState,
  type PurchaseMatchingType,
} from "../../procurement/mod.ts"
import { SalesDocumentService, SalesOrderInvalidState } from "../../sales/mod.ts"
import { TaxService } from "../../tax/mod.ts"
import { BillingCapabilities } from "./capabilities.ts"
import {
  ApplySettlementInput,
  BillPurchaseOrderInput,
  BillVarianceSubject,
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
  BillExceedsReceipt,
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
  /** Supplier documents: the received value this line clears from goods received not invoiced. */
  readonly matchedValue?: string
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
    readonly matched: string
  }) => ReadonlyArray<LedgerLine>
}

type MatchingLine = PurchaseMatchingType["lines"][number]
type RequestedBillLine = {
  readonly purchaseOrderLineId: string
  readonly quantity: string
  readonly unitPrice: string
}
type BillMatch = {
  readonly matched: ReadonlyArray<{
    readonly line: MatchingLine
    readonly requested: RequestedBillLine
    /** Received value this line clears from goods received not invoiced, at the purchase price. */
    readonly matchedValue: bigint
  }>
  /** Billed value beyond what was received, which needs an approved variance. */
  readonly excessValue: bigint
  readonly excess: ReadonlyArray<{
    readonly lineId: string
    readonly billable: bigint
    readonly requested: bigint
  }>
}

/**
 * Three-way match: each line may bill what was received, net of returns, minus what was billed
 * net of supplier credits. Returns the unknown line id when a line is not on the order.
 */
const matchBill = (
  requestedLines: ReadonlyArray<RequestedBillLine>,
  orderLines: ReadonlyArray<MatchingLine>,
  billed: ReadonlyMap<string, bigint>,
  credited: ReadonlyMap<string, bigint>,
): BillMatch | { readonly unknownLineId: string } => {
  const byLine = new Map(orderLines.map((line) => [line.purchaseOrderLineId, line]))
  const match = {
    matched: new Array<BillMatch["matched"][number]>(),
    excessValue: 0n,
    excess: new Array<BillMatch["excess"][number]>(),
  }
  for (const requested of requestedLines) {
    const line = byLine.get(requested.purchaseOrderLineId)
    if (line === undefined) return { unknownLineId: requested.purchaseOrderLineId }
    const netBilled =
      (billed.get(line.purchaseOrderLineId) ?? 0n) - (credited.get(line.purchaseOrderLineId) ?? 0n)
    const billable = BigInt(line.received) - BigInt(line.returned) - netBilled
    const quantity = BigInt(requested.quantity)
    const matched = quantity < billable ? quantity : billable > 0n ? billable : 0n
    if (quantity > matched) {
      match.excess.push({ lineId: line.purchaseOrderLineId, billable, requested: quantity })
      match.excessValue += (quantity - matched) * minor(requested.unitPrice)
    }
    match.matched.push({ line, requested, matchedValue: matched * minor(line.unitPrice) })
  }
  return match
}

/** Goods received not invoiced clears at the purchase price; the rest posts as price variance. */
const supplierBillJournal: DraftDocument["journal"] = ({ subtotal, taxTotal, total, matched }) => {
  const variance = minor(subtotal) - minor(matched)
  return [
    { role: "goods_received_not_invoiced", debit: matched, credit: "0" },
    variance >= 0n
      ? { role: "purchase_price_variance", debit: major(variance), credit: "0" }
      : { role: "purchase_price_variance", debit: "0", credit: major(-variance) },
    { role: "input_tax", debit: taxTotal, credit: "0" },
    { role: "payable", debit: "0", credit: total },
  ]
}

/** A credit note reverses its document's revenue and tax, or its payable and receipt value. */
const creditJournal =
  (receivable: boolean): DraftDocument["journal"] =>
  ({ subtotal, taxTotal, total, matched }) => {
    if (receivable) {
      return [
        { role: "revenue", debit: subtotal, credit: "0" },
        { role: "output_tax", debit: taxTotal, credit: "0" },
        { role: "receivable", debit: "0", credit: total },
      ]
    }
    // Mirror the bill: goods received not invoiced returns at its cleared value, and the price
    // variance the bill booked reverses.
    const variance = minor(subtotal) - minor(matched)
    return [
      { role: "payable", debit: total, credit: "0" },
      { role: "goods_received_not_invoiced", debit: "0", credit: matched },
      variance >= 0n
        ? { role: "purchase_price_variance", debit: "0", credit: major(variance) }
        : { role: "purchase_price_variance", debit: major(-variance), credit: "0" },
      { role: "input_tax", debit: "0", credit: taxTotal },
    ]
  }

/**
 * The part of a bill line's matched value a credit of `quantity` units returns: proportional, and
 * the last units take what is left so credits never over- or under-return it.
 */
const creditShare = (
  line: BillingDocument["lines"][number],
  quantity: bigint,
  credited: ReadonlyMap<string, bigint>,
  creditedMatched: ReadonlyMap<string, bigint>,
) => {
  const matched = minor(line.matchedValue)
  const total = BigInt(line.quantity)
  const done = credited.get(line.id) ?? 0n
  const returned = creditedMatched.get(line.id) ?? 0n
  return done + quantity === total
    ? matched - returned
    : (matched * quantity * 2n + total) / (total * 2n)
}

/** Credit lines copy the credited lines' prices and taxes; quantities stay within what is left. */
const creditLinesFor = (
  invoice: BillingDocument,
  requested: ReadonlyArray<{ readonly invoiceLineId: string; readonly quantity: string }>,
  credited: ReadonlyMap<string, bigint>,
  creditedMatched: ReadonlyMap<string, bigint>,
):
  | { readonly lines: DraftLine[] }
  | { readonly invoiceLineId: string; readonly available: bigint } => {
  const byId = new Map(invoice.lines.map((line) => [line.id, line]))
  const lines: DraftLine[] = []
  for (const request of requested) {
    const line = byId.get(request.invoiceLineId)
    const available =
      line === undefined ? 0n : BigInt(line.quantity) - (credited.get(line.id) ?? 0n)
    if (line === undefined || BigInt(request.quantity) > available) {
      return { invoiceLineId: request.invoiceLineId, available }
    }
    lines.push({
      productId: line.productId,
      description: line.description,
      quantity: request.quantity,
      unitPrice: line.unitPrice,
      taxCodeId: line.taxCodeId,
      sourceLineId: line.id,
      matchedValue: major(creditShare(line, BigInt(request.quantity), credited, creditedMatched)),
    })
  }
  return { lines }
}

export const makeBillingService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const authorized = makeScopedCommand(authorization)
  const ledger = yield* GeneralLedgerService
  const numbering = yield* NumberingService
  const tax = yield* TaxService
  const sales = yield* SalesDocumentService
  const products = yield* ProductService
  const purchasing = yield* PurchaseDocumentService
  const approvals = yield* ApprovalService

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
          matchedValue: normalize(line.matchedValue),
        })),
      } satisfies BillingDocument
    })

  const existing = (tenantId: string, invoiceId: string) =>
    loadDocument(tenantId, invoiceId).pipe(
      Effect.map((document): BillingDocument | undefined => document),
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

  /** A column of the lines already billed per source line by documents of the given kind. */
  const billedSums = (
    tenantId: string,
    kind: InvoiceKind,
    sourceLineIds: string[],
    column: typeof invoiceLines.quantity | typeof invoiceLines.matchedValue,
    parse: (value: string) => bigint,
  ) =>
    sourceLineIds.length === 0
      ? Effect.succeed(new Map<string, bigint>())
      : database
          .query(
            (db) =>
              db
                .select({
                  sourceLineId: invoiceLines.sourceLineId,
                  total: sum(column),
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
            "billing.billed_sums",
          )
          .pipe(
            Effect.map(
              (rows) => new Map(rows.map((row) => [row.sourceLineId!, parse(row.total ?? "0")])),
            ),
          )

  const billedQuantities = (tenantId: string, kind: InvoiceKind, sourceLineIds: string[]) =>
    billedSums(tenantId, kind, sourceLineIds, invoiceLines.quantity, BigInt)

  const billedMatchedValues = (tenantId: string, kind: InvoiceKind, sourceLineIds: string[]) =>
    billedSums(tenantId, kind, sourceLineIds, invoiceLines.matchedValue, minor)

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
      const matched = major(priced.reduce((sum, line) => sum + minor(line.matchedValue ?? "0"), 0n))
      const allocated = yield* numbering
        .allocate({
          tenantId: draft.tenantId,
          scopeId: draft.legalEntityId,
          documentType: `billing.${draft.kind}`,
          documentId: draft.invoiceId,
          documentDate: draft.invoiceDate,
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
          .journal({ subtotal, taxTotal, total, matched })
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
            matchedValue: line.matchedValue ?? "0",
          })),
        )
      }, "billing.document.insert")
      return yield* loadDocument(draft.tenantId, draft.invoiceId).pipe(
        Effect.catchTag("BillingDocumentNotFound", (error) => Effect.die(error)),
      )
    })

  /**
   * Applies `amount` of `source` to an open document on `settledOn`; replaying the same source is
   * a no-op.
   */
  const settle = (
    tenantId: string,
    invoiceId: string,
    amount: bigint,
    source: { readonly type: string; readonly id: string },
    settledOn: string,
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
          settledOn,
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
    const decoded = yield* authorized(
      InvoiceSalesOrderInput,
      BillingCapabilities.customerInvoiceCreate,
    )(input)
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

  /** Supplier-credited quantity per purchase order line, through the bill lines it credits. */
  const creditedPurchaseQuantities = (tenantId: string, purchaseOrderLineIds: string[]) => {
    const billLines = alias(invoiceLines, "bill_lines")
    return purchaseOrderLineIds.length === 0
      ? Effect.succeed(new Map<string, bigint>())
      : database
          .query(
            (db) =>
              db
                .select({ lineId: billLines.sourceLineId, quantity: sum(invoiceLines.quantity) })
                .from(invoiceLines)
                .innerJoin(
                  invoices,
                  and(
                    eq(invoices.tenantId, invoiceLines.tenantId),
                    eq(invoices.id, invoiceLines.invoiceId),
                  ),
                )
                .innerJoin(
                  billLines,
                  and(
                    eq(billLines.tenantId, invoiceLines.tenantId),
                    eq(billLines.id, invoiceLines.sourceLineId),
                  ),
                )
                .where(
                  and(
                    eq(invoiceLines.tenantId, tenantId),
                    eq(invoices.kind, "supplier_credit_note"),
                    inArray(billLines.sourceLineId, purchaseOrderLineIds),
                  ),
                )
                .groupBy(billLines.sourceLineId),
            "billing.supplier_credited_quantities",
          )
          .pipe(
            Effect.map(
              (rows) => new Map(rows.map((row) => [row.lineId!, BigInt(row.quantity ?? "0")])),
            ),
          )
  }

  /** Fails unless an approved variance covers the value billed beyond receipts. */
  const requireVariance = (
    scope: { readonly principal: Principal; readonly tenantId: string },
    billId: string,
    match: BillMatch,
  ) =>
    Effect.gen(function* () {
      if (match.excess.length === 0) return
      const approval = yield* approvals.getForSubject({
        ...scope,
        subjectType: BillVarianceSubject,
        subjectId: billId,
      })
      if (approval?.status === "approved" && minor(approval.amount) >= match.excessValue) return
      const first = match.excess[0]!
      return yield* Effect.fail(
        new BillExceedsReceipt({
          tenantId: scope.tenantId,
          purchaseOrderLineId: first.lineId,
          billable: (first.billable > 0n ? first.billable : 0n).toString(),
          requested: first.requested.toString(),
        }),
      )
    })

  const billPurchaseOrder = Effect.fn("BillingService.billPurchaseOrder")(function* (
    input: unknown,
  ) {
    const decoded = yield* authorized(
      BillPurchaseOrderInput,
      BillingCapabilities.supplierBillCreate,
    )(input)
    const scope = { principal: decoded.principal, tenantId: decoded.tenantId }
    return yield* database.withTransaction(
      Effect.gen(function* () {
        const posted =
          decoded.billId === undefined
            ? undefined
            : yield* existing(decoded.tenantId, decoded.billId)
        if (posted !== undefined) return posted
        const billId = decoded.billId ?? uuidv7()
        yield* lockSource(decoded.tenantId, "procurement.purchase_order", decoded.purchaseOrderId)
        const matching = yield* purchasing.getMatching({
          ...scope,
          purchaseOrderId: decoded.purchaseOrderId,
        })
        if (matching.status !== "confirmed") {
          return yield* Effect.fail(
            new PurchaseOrderInvalidState({
              tenantId: decoded.tenantId,
              purchaseOrderId: decoded.purchaseOrderId,
              status: matching.status,
            }),
          )
        }
        const lineIds = matching.lines.map((line) => line.purchaseOrderLineId)
        const match = matchBill(
          decoded.lines,
          matching.lines,
          yield* billedQuantities(decoded.tenantId, "supplier_bill", lineIds),
          yield* creditedPurchaseQuantities(decoded.tenantId, lineIds),
        )
        if ("unknownLineId" in match) {
          return yield* Effect.fail(
            new BillExceedsReceipt({
              tenantId: decoded.tenantId,
              purchaseOrderLineId: match.unknownLineId,
              billable: "0",
              requested: "0",
            }),
          )
        }
        yield* requireVariance(scope, billId, match)
        const lines: DraftLine[] = []
        for (const { line, requested, matchedValue } of match.matched) {
          const product = yield* products.getProduct({ ...scope, productId: line.productId })
          lines.push({
            productId: line.productId,
            description: `${product.code} ${product.name}`,
            quantity: requested.quantity,
            unitPrice: requested.unitPrice,
            taxCodeId: line.taxCodeId,
            sourceLineId: line.purchaseOrderLineId,
            matchedValue: major(matchedValue),
          })
        }
        return yield* post({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          invoiceId: billId,
          legalEntityId: matching.legalEntityId,
          kind: "supplier_bill",
          partyId: matching.partyId,
          invoiceDate: decoded.billDate,
          sourceType: "procurement.purchase_order",
          sourceId: decoded.purchaseOrderId,
          creditedInvoiceId: null,
          supplierReference: decoded.supplierReference,
          lines,
          journal: supplierBillJournal,
        })
      }),
      "billing.supplier_bill.atomic",
    )
  })

  /** The credit settles the invoice first; any remainder stays open as a credit balance. */
  const applyCredit = (invoice: BillingDocument, creditNote: BillingDocument) =>
    Effect.gen(function* () {
      const applied =
        minor(invoice.openAmount) < minor(creditNote.total)
          ? minor(invoice.openAmount)
          : minor(creditNote.total)
      if (applied === 0n) return creditNote
      // The applied amount never exceeds either open amount, so settlement cannot fail here.
      const impossible = (error: unknown) => Effect.die(error)
      const guarded = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.catch(impossible))
      yield* guarded(
        settle(
          invoice.tenantId,
          invoice.id,
          applied,
          { type: `billing.${creditNote.kind}`, id: creditNote.id },
          creditNote.invoiceDate,
        ),
      )
      return yield* guarded(
        settle(
          invoice.tenantId,
          creditNote.id,
          applied,
          { type: `billing.${invoice.kind}`, id: invoice.id },
          creditNote.invoiceDate,
        ),
      )
    })

  const creditInvoice = Effect.fn("BillingService.creditInvoice")(function* (input: unknown) {
    const decoded = yield* authorized(
      CreditInvoiceInput,
      BillingCapabilities.creditNoteCreate,
    )(input)
    return yield* database.withTransaction(
      Effect.gen(function* () {
        const posted =
          decoded.creditNoteId === undefined
            ? undefined
            : yield* existing(decoded.tenantId, decoded.creditNoteId)
        if (posted !== undefined) return posted
        const invoice = yield* loadDocument(decoded.tenantId, decoded.invoiceId, true)
        if (isCreditNote(invoice.kind)) {
          return yield* Effect.fail(
            new BillingDocumentNotFound({
              tenantId: decoded.tenantId,
              invoiceId: decoded.invoiceId,
            }),
          )
        }
        const receivable = invoice.kind === "customer_invoice"
        const creditKind: InvoiceKind = receivable ? "customer_credit_note" : "supplier_credit_note"
        const credited = yield* billedQuantities(
          decoded.tenantId,
          creditKind,
          invoice.lines.map((line) => line.id),
        )
        const creditedMatched = yield* billedMatchedValues(
          decoded.tenantId,
          creditKind,
          invoice.lines.map((line) => line.id),
        )
        const built = creditLinesFor(invoice, decoded.lines, credited, creditedMatched)
        if (!("lines" in built)) {
          return yield* Effect.fail(
            new CreditExceedsInvoice({
              tenantId: decoded.tenantId,
              invoiceLineId: built.invoiceLineId,
              available: built.available.toString(),
            }),
          )
        }
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
          lines: built.lines,
          journal: creditJournal(receivable),
        })
        return yield* applyCredit(invoice, creditNote)
      }),
      "billing.credit_note.atomic",
    )
  })

  const applySettlement = Effect.fn("BillingService.applySettlement")(function* (input: unknown) {
    const decoded = yield* authorized(
      ApplySettlementInput,
      BillingCapabilities.settlementApply,
    )(input)
    return yield* database.withTransaction(
      settle(
        decoded.tenantId,
        decoded.invoiceId,
        minor(decoded.amount),
        decoded.source,
        decoded.settledOn,
      ),
      "billing.settlement.atomic",
    )
  })

  const getDocument = Effect.fn("BillingService.getDocument")(function* (input: unknown) {
    const decoded = yield* authorized(
      GetBillingDocumentInput,
      BillingCapabilities.documentRead,
    )(input)
    return yield* loadDocument(decoded.tenantId, decoded.invoiceId)
  })

  const listDocuments = Effect.fn("BillingService.listDocuments")(function* (input: unknown) {
    const decoded = yield* authorized(
      ListBillingDocumentsInput,
      BillingCapabilities.documentRead,
    )(input)
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
    const decoded = yield* authorized(ListOpenItemsInput, BillingCapabilities.documentRead)(input)
    // The open amount on the as-of date: the total less what was settled by then.
    const openAsOf = sql<string>`${invoices.total} - coalesce((
      select sum(${invoiceSettlements.amount}) from ${invoiceSettlements}
      where ${invoiceSettlements.tenantId} = ${invoices.tenantId}
        and ${invoiceSettlements.invoiceId} = ${invoices.id}
        and ${invoiceSettlements.settledOn} <= ${decoded.asOf}
    ), 0)`
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
            openAmount: openAsOf,
          })
          .from(invoices)
          .where(
            and(
              eq(invoices.tenantId, decoded.tenantId),
              eq(invoices.legalEntityId, decoded.legalEntityId),
              inArray(invoices.kind, kindsOf(decoded.side)),
              sql`${openAsOf} <> 0`,
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
    billPurchaseOrder,
    creditInvoice,
    applySettlement,
    getDocument,
    listDocuments,
    listOpenItems,
  } satisfies BillingService
})

export const BillingLive = Layer.effect(BillingService, makeBillingService)
