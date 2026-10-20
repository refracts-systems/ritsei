import { and, asc, eq, gt, inArray, lte } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  partyPaymentTerms,
  paymentAllocations,
  payments,
  paymentTerms,
} from "../../../../db/schema/settlement.ts"
import {
  addDays,
  Database,
  daysBetween,
  formatSignedMinor,
  isDatabaseConstraint,
  requireExactMajorToMinor,
  uuidv7,
} from "../../../../framework/foundation/mod.ts"
import type { Principal as PrincipalSchema } from "../../../../framework/modules/auth/mod.ts"
import {
  AuthorizationService,
  makeScopedCommand,
} from "../../../../framework/modules/authorization/mod.ts"
import { NumberingService } from "../../../../framework/modules/numbering/mod.ts"
import { GeneralLedgerService } from "../../accounting/mod.ts"
import { BillingService } from "../../billing/mod.ts"
import { SettlementCapabilities } from "./capabilities.ts"
import {
  AgingInput,
  AllocatePaymentInput,
  AssignPartyTermInput,
  CreatePaymentTermInput,
  MakePaymentInput,
  type Payment,
  type PaymentDirection,
  ReceivePaymentInput,
  SettlementService,
  StatementInput,
} from "./contract.ts"
import {
  AllocationExceedsPayment,
  AllocationMismatch,
  PaymentNotFound,
  PaymentTermAlreadyExists,
  PaymentTermNotFound,
} from "./errors.ts"

type Principal = Schema.Schema.Type<typeof PrincipalSchema>

const minor = (value: string) => requireExactMajorToMinor(value, 2)
const signedMinor = (value: string) =>
  value.startsWith("-") ? -minor(value.slice(1)) : minor(value)
const major = (value: bigint) => formatSignedMinor(value, 2)
const normalize = (value: string) => major(minor(value))

const rules = {
  incoming: { side: "receivable", kind: "customer_invoice", prefix: "RCV/" },
  outgoing: { side: "payable", kind: "supplier_bill", prefix: "PAY/" },
} as const

type BucketName = "current" | "days1To30" | "days31To60" | "days61To90" | "over90" | "unapplied"
type Buckets = Record<BucketName, bigint>

const emptyBuckets = (): Buckets => ({
  current: 0n,
  days1To30: 0n,
  days31To60: 0n,
  days61To90: 0n,
  over90: 0n,
  unapplied: 0n,
})

/** The aging bucket for a number of days past due. */
const bucketFor = (overdue: number): BucketName => {
  if (overdue <= 0) return "current"
  if (overdue <= 30) return "days1To30"
  if (overdue <= 60) return "days31To60"
  return overdue <= 90 ? "days61To90" : "over90"
}

const formatBuckets = (values: Buckets) => ({
  current: major(values.current),
  days1To30: major(values.days1To30),
  days31To60: major(values.days31To60),
  days61To90: major(values.days61To90),
  over90: major(values.over90),
  unapplied: major(values.unapplied),
  total: major(Object.values(values).reduce((sum, value) => sum + value, 0n)),
})

const sumBuckets = (rows: Iterable<Buckets>) => {
  const totals = emptyBuckets()
  for (const values of rows) {
    for (const key of Object.keys(totals) as BucketName[]) totals[key] += values[key]
  }
  return totals
}

export const makeSettlementService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const authorized = makeScopedCommand(authorization)
  const ledger = yield* GeneralLedgerService
  const billing = yield* BillingService
  const numbering = yield* NumberingService

  const authorize = (input: { principal: Principal; tenantId: string }, capability: string) =>
    authorization.authorize({ principal: input.principal, tenantId: input.tenantId, capability })

  const loadPayment = (tenantId: string, paymentId: string, lock = false) =>
    Effect.gen(function* () {
      const loaded = yield* database.transaction(async (tx) => {
        const query = tx
          .select()
          .from(payments)
          .where(and(eq(payments.tenantId, tenantId), eq(payments.id, paymentId)))
        const header = (await (lock ? query.for("update") : query))[0]
        if (header === undefined) return undefined
        const allocations = await tx
          .select({ invoiceId: paymentAllocations.invoiceId, amount: paymentAllocations.amount })
          .from(paymentAllocations)
          .where(
            and(
              eq(paymentAllocations.tenantId, tenantId),
              eq(paymentAllocations.paymentId, paymentId),
            ),
          )
          .orderBy(asc(paymentAllocations.invoiceId))
        return { header, allocations }
      }, "settlement.payment.load")
      if (loaded === undefined)
        return yield* Effect.fail(new PaymentNotFound({ tenantId, paymentId }))
      const { header, allocations } = loaded
      return {
        id: header.id,
        tenantId: header.tenantId,
        legalEntityId: header.legalEntityId,
        direction: header.direction,
        partyId: header.partyId,
        number: header.number,
        paymentDate: header.paymentDate,
        amount: normalize(header.amount),
        unallocatedAmount: normalize(header.unallocatedAmount),
        cashAccountId: header.cashAccountId,
        journalEntryId: header.journalEntryId,
        allocations: allocations.map((row) => ({
          invoiceId: row.invoiceId,
          amount: normalize(row.amount),
        })),
      } satisfies Payment
    })

  /** Applies allocations of a locked payment to billing documents of its party and side. */
  const allocate = (
    principal: Principal,
    payment: Payment,
    allocations: ReadonlyArray<{ readonly invoiceId: string; readonly amount: string }>,
  ) =>
    Effect.gen(function* () {
      const requested = allocations.reduce((sum, allocation) => sum + minor(allocation.amount), 0n)
      if (requested > minor(payment.unallocatedAmount)) {
        return yield* Effect.fail(
          new AllocationExceedsPayment({
            tenantId: payment.tenantId,
            paymentId: payment.id,
            unallocated: payment.unallocatedAmount,
            requested: major(requested),
          }),
        )
      }
      for (const allocation of allocations) {
        const document = yield* billing.getDocument({
          principal,
          tenantId: payment.tenantId,
          invoiceId: allocation.invoiceId,
        })
        if (
          document.kind !== rules[payment.direction].kind ||
          document.partyId !== payment.partyId ||
          document.legalEntityId !== payment.legalEntityId
        ) {
          return yield* Effect.fail(
            new AllocationMismatch({
              tenantId: payment.tenantId,
              paymentId: payment.id,
              invoiceId: allocation.invoiceId,
            }),
          )
        }
        yield* billing.applySettlement({
          principal,
          tenantId: payment.tenantId,
          invoiceId: allocation.invoiceId,
          amount: allocation.amount,
          source: { type: "settlement.payment", id: payment.id },
        })
      }
      const unallocatedAmount = major(minor(payment.unallocatedAmount) - requested)
      yield* database.transaction(async (tx) => {
        if (allocations.length === 0) return
        await tx.insert(paymentAllocations).values(
          allocations.map((allocation) => ({
            tenantId: payment.tenantId,
            paymentId: payment.id,
            invoiceId: allocation.invoiceId,
            amount: allocation.amount,
          })),
        )
        await tx
          .update(payments)
          .set({ unallocatedAmount })
          .where(and(eq(payments.tenantId, payment.tenantId), eq(payments.id, payment.id)))
      }, "settlement.payment.allocate")
      return yield* loadPayment(payment.tenantId, payment.id)
    })

  const record = (
    direction: PaymentDirection,
    input: Schema.Schema.Type<typeof ReceivePaymentInput>,
  ) =>
    database.withTransaction(
      Effect.gen(function* () {
        if (input.paymentId !== undefined) {
          const recorded = yield* loadPayment(input.tenantId, input.paymentId).pipe(
            Effect.map((payment) => payment as Payment | undefined),
            Effect.catchTag("PaymentNotFound", () => Effect.succeed(undefined)),
          )
          if (recorded !== undefined) return recorded
        }
        const paymentId = input.paymentId ?? uuidv7()
        const rule = rules[direction]
        const allocated = yield* numbering
          .allocate({
            tenantId: input.tenantId,
            scopeId: input.legalEntityId,
            documentType: `settlement.payment_${direction}`,
            documentId: paymentId,
            documentDate: input.paymentDate,
            prefix: rule.prefix,
          })
          .pipe(Effect.catchTag("SchemaError", (error) => Effect.die(error)))
        const cash =
          input.cashAccountId === undefined
            ? { role: "cash" as const }
            : { accountId: input.cashAccountId }
        const counter = { role: rule.side } as const
        const journal = yield* ledger.postDocumentEntry({
          principal: input.principal,
          tenantId: input.tenantId,
          legalEntityId: input.legalEntityId,
          postingDate: input.paymentDate,
          reference: `settlement/payment/${paymentId}`,
          description: allocated.number,
          source: { type: "settlement.payment", id: paymentId },
          lines:
            direction === "incoming"
              ? [
                  { ...cash, debit: input.amount, credit: "0" },
                  { ...counter, debit: "0", credit: input.amount },
                ]
              : [
                  { ...counter, debit: input.amount, credit: "0" },
                  { ...cash, debit: "0", credit: input.amount },
                ],
        })
        yield* database.query(
          (db) =>
            db.insert(payments).values({
              id: paymentId,
              tenantId: input.tenantId,
              legalEntityId: input.legalEntityId,
              direction,
              partyId: input.partyId,
              number: allocated.number,
              paymentDate: input.paymentDate,
              amount: input.amount,
              unallocatedAmount: input.amount,
              cashAccountId: input.cashAccountId ?? null,
              journalEntryId: journal.id,
            }),
          "settlement.payment.insert",
        )
        const payment = yield* loadPayment(input.tenantId, paymentId, true)
        return yield* allocate(input.principal, payment, input.allocations)
      }),
      `settlement.payment_${direction}.atomic`,
    )

  const receivePayment = Effect.fn("SettlementService.receivePayment")(function* (input: unknown) {
    const decoded = yield* authorized(
      ReceivePaymentInput,
      SettlementCapabilities.paymentReceive,
    )(input)
    return yield* record("incoming", decoded)
  })

  const makePayment = Effect.fn("SettlementService.makePayment")(function* (input: unknown) {
    const decoded = yield* authorized(MakePaymentInput, SettlementCapabilities.paymentMake)(input)
    return yield* record("outgoing", decoded)
  })

  const allocatePayment = Effect.fn("SettlementService.allocatePayment")(function* (
    input: unknown,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(AllocatePaymentInput)(input)
    const payment = yield* loadPayment(decoded.tenantId, decoded.paymentId)
    yield* authorize(
      decoded,
      payment.direction === "incoming"
        ? SettlementCapabilities.paymentReceive
        : SettlementCapabilities.paymentMake,
    )
    return yield* database.withTransaction(
      Effect.gen(function* () {
        const locked = yield* loadPayment(decoded.tenantId, decoded.paymentId, true)
        return yield* allocate(decoded.principal, locked, decoded.allocations)
      }),
      "settlement.payment.allocate.atomic",
    )
  })

  const createPaymentTerm = Effect.fn("SettlementService.createPaymentTerm")(function* (
    input: unknown,
  ) {
    const decoded = yield* authorized(
      CreatePaymentTermInput,
      SettlementCapabilities.paymentTermConfigure,
    )(input)
    const code = decoded.code.toUpperCase()
    const rows = yield* database
      .query(
        (db) =>
          db
            .insert(paymentTerms)
            .values({
              tenantId: decoded.tenantId,
              code,
              name: decoded.name,
              netDays: decoded.netDays,
            })
            .returning({
              id: paymentTerms.id,
              tenantId: paymentTerms.tenantId,
              code: paymentTerms.code,
              name: paymentTerms.name,
              netDays: paymentTerms.netDays,
            }),
        "settlement.payment_term.create",
      )
      .pipe(
        Effect.mapError((error) =>
          isDatabaseConstraint(error, "payment_terms_tenant_code_key")
            ? new PaymentTermAlreadyExists({ tenantId: decoded.tenantId, code })
            : error,
        ),
      )
    return rows[0]!
  })

  const assignPartyTerm = Effect.fn("SettlementService.assignPartyTerm")(function* (
    input: unknown,
  ) {
    const decoded = yield* authorized(
      AssignPartyTermInput,
      SettlementCapabilities.paymentTermConfigure,
    )(input)
    yield* database
      .query(
        (db) =>
          db
            .insert(partyPaymentTerms)
            .values({
              tenantId: decoded.tenantId,
              partyId: decoded.partyId,
              side: decoded.side,
              paymentTermId: decoded.paymentTermId,
            })
            .onConflictDoUpdate({
              target: [
                partyPaymentTerms.tenantId,
                partyPaymentTerms.partyId,
                partyPaymentTerms.side,
              ],
              set: { paymentTermId: decoded.paymentTermId, updatedAt: new Date() },
            }),
        "settlement.party_term.assign",
      )
      .pipe(
        Effect.mapError((error) =>
          isDatabaseConstraint(error, "party_payment_terms_term_fkey", "23503")
            ? new PaymentTermNotFound({
                tenantId: decoded.tenantId,
                paymentTermId: decoded.paymentTermId,
              })
            : error,
        ),
      )
  })

  const unallocatedPayments = (
    tenantId: string,
    legalEntityId: string,
    direction: PaymentDirection,
    asOf: string,
  ) =>
    database.query(
      (db) =>
        db
          .select({ partyId: payments.partyId, unallocated: payments.unallocatedAmount })
          .from(payments)
          .where(
            and(
              eq(payments.tenantId, tenantId),
              eq(payments.legalEntityId, legalEntityId),
              eq(payments.direction, direction),
              gt(payments.unallocatedAmount, "0"),
              lte(payments.paymentDate, asOf),
            ),
          ),
      "settlement.payment.unallocated",
    )

  /** Net payment days per party for one side; parties without terms are due immediately. */
  const netDaysFor = (tenantId: string, side: "receivable" | "payable", partyIds: string[]) =>
    partyIds.length === 0
      ? Effect.succeed(new Map<string, number>())
      : database
          .query(
            (db) =>
              db
                .select({ partyId: partyPaymentTerms.partyId, netDays: paymentTerms.netDays })
                .from(partyPaymentTerms)
                .innerJoin(
                  paymentTerms,
                  and(
                    eq(paymentTerms.tenantId, partyPaymentTerms.tenantId),
                    eq(paymentTerms.id, partyPaymentTerms.paymentTermId),
                  ),
                )
                .where(
                  and(
                    eq(partyPaymentTerms.tenantId, tenantId),
                    eq(partyPaymentTerms.side, side),
                    inArray(partyPaymentTerms.partyId, partyIds),
                  ),
                ),
            "settlement.party_term.list",
          )
          .pipe(Effect.map((terms) => new Map(terms.map((term) => [term.partyId, term.netDays]))))

  const aging = Effect.fn("SettlementService.aging")(function* (input: unknown) {
    const decoded = yield* authorized(AgingInput, SettlementCapabilities.reportRead)(input)
    const items = yield* billing.listOpenItems(decoded)
    const netDays = yield* netDaysFor(decoded.tenantId, decoded.side, [
      ...new Set(items.map((item) => item.partyId)),
    ])
    const rows = new Map<string, Buckets>()
    const row = (partyId: string) => {
      const values = rows.get(partyId) ?? emptyBuckets()
      rows.set(partyId, values)
      return values
    }
    for (const item of items) {
      const amount = signedMinor(item.openAmount)
      // Credit notes are unapplied credit; documents age from their due date.
      const due = addDays(item.invoiceDate, netDays.get(item.partyId) ?? 0)
      const bucket = amount < 0n ? "unapplied" : bucketFor(daysBetween(due, decoded.asOf))
      row(item.partyId)[bucket] += amount
    }
    const direction = decoded.side === "receivable" ? "incoming" : "outgoing"
    for (const payment of yield* unallocatedPayments(
      decoded.tenantId,
      decoded.legalEntityId,
      direction,
      decoded.asOf,
    )) {
      row(payment.partyId).unapplied -= minor(payment.unallocated)
    }
    return {
      legalEntityId: decoded.legalEntityId,
      side: decoded.side,
      asOf: decoded.asOf,
      rows: [...rows]
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([partyId, values]) => ({ partyId, ...formatBuckets(values) })),
      totals: formatBuckets(sumBuckets(rows.values())),
    }
  })

  const customerStatement = Effect.fn("SettlementService.customerStatement")(function* (
    input: unknown,
  ) {
    const decoded = yield* authorized(StatementInput, SettlementCapabilities.reportRead)(input)
    const documents = yield* billing.listDocuments({
      principal: decoded.principal,
      tenantId: decoded.tenantId,
      legalEntityId: decoded.legalEntityId,
      partyId: decoded.partyId,
      side: "receivable",
      to: decoded.to,
    })
    const received = yield* database.query(
      (db) =>
        db
          .select({
            id: payments.id,
            number: payments.number,
            paymentDate: payments.paymentDate,
            amount: payments.amount,
          })
          .from(payments)
          .where(
            and(
              eq(payments.tenantId, decoded.tenantId),
              eq(payments.legalEntityId, decoded.legalEntityId),
              eq(payments.partyId, decoded.partyId),
              eq(payments.direction, "incoming"),
              lte(payments.paymentDate, decoded.to),
            ),
          ),
      "settlement.statement.payments",
    )
    const entries = [
      ...documents.map((document) => ({
        date: document.invoiceDate,
        kind:
          document.kind === "customer_invoice" ? ("invoice" as const) : ("credit_note" as const),
        documentId: document.id,
        number: document.number,
        amount:
          document.kind === "customer_invoice" ? minor(document.total) : -minor(document.total),
      })),
      ...received.map((payment) => ({
        date: payment.paymentDate,
        kind: "payment" as const,
        documentId: payment.id,
        number: payment.number,
        amount: -minor(payment.amount),
      })),
    ].toSorted(
      (left, right) =>
        left.date.localeCompare(right.date) || left.number.localeCompare(right.number),
    )
    const opening = entries
      .filter((entry) => entry.date < decoded.from)
      .reduce((sum, entry) => sum + entry.amount, 0n)
    let balance = opening
    const period = entries
      .values()
      .filter((entry) => entry.date >= decoded.from)
      .map((entry) => {
        balance += entry.amount
        return { ...entry, amount: major(entry.amount), balance: major(balance) }
      })
      .toArray()
    return {
      legalEntityId: decoded.legalEntityId,
      partyId: decoded.partyId,
      from: decoded.from,
      to: decoded.to,
      openingBalance: major(opening),
      entries: period,
      closingBalance: major(balance),
    }
  })

  return {
    createPaymentTerm,
    assignPartyTerm,
    receivePayment,
    makePayment,
    allocatePayment,
    aging,
    customerStatement,
  } satisfies SettlementService
})

export const SettlementLive = Layer.effect(SettlementService, makeSettlementService)
