import type { CapabilityType } from "../../../../framework/modules/authorization/mod.ts"
import { and, asc, count, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  bankLineMatches,
  bankStatementLines,
  bankStatements,
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
  typedKeys,
} from "../../../../framework/foundation/mod.ts"
import type { Principal as PrincipalSchema } from "../../../../framework/modules/auth/mod.ts"
import {
  AuthorizationService,
  scopedCommand,
} from "../../../../framework/modules/authorization/mod.ts"
import { NumberingService } from "../../../../framework/modules/numbering/mod.ts"
import {
  AccountingLegalEntityNotFound,
  AccountNotFound,
  GeneralLedgerService,
} from "../../accounting/mod.ts"
import { BillingService } from "../../billing/mod.ts"
import { bankStatementChecksum, parseBankStatement } from "./bank-statement.ts"
import { SettlementCapabilities } from "./capabilities.ts"
import {
  AgingInput,
  AllocatePaymentInput,
  AssignPartyTermInput,
  BankReconciliationInput,
  CreatePaymentTermInput,
  ImportBankStatementInput,
  ListPaymentsInput,
  MakePaymentInput,
  MatchBankLineInput,
  type BankLineMatch,
  type Payment,
  type PaymentDirection,
  ReceivePaymentInput,
  ReverseBankMatchInput,
  SettlementService,
  StatementInput,
} from "./contract.ts"
import {
  AllocationBeforePayment,
  AllocationExceedsPayment,
  AllocationMismatch,
  BankLineNotFound,
  BankMatchExceedsAvailable,
  BankMatchMismatch,
  BankMatchNotFound,
  InvalidWithholding,
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

/** The withholding of a receipt; absent unless the payer withheld tax. */
const withholdingOf = (row: typeof payments.$inferSelect) =>
  row.withholdingReference === null || row.withholdingAccountId === null
    ? {}
    : {
        withholding: {
          amount: normalize(row.withheldAmount),
          certificateReference: row.withholdingReference,
          accountId: row.withholdingAccountId,
        },
      }

const normalizeSigned = (value: string) => major(signedMinor(value))

const abs = (value: bigint) => (value < 0n ? -value : value)

/** The cash a payment brought in or sent out: what it settles less any withholding. */
const cashOf = (payment: Payment) =>
  minor(payment.amount) -
  (payment.withholding === undefined ? 0n : minor(payment.withholding.amount))

/** Why a line and a payment cannot be matched, if they cannot. */
const matchMismatch = (
  line: { readonly amount: bigint; readonly legalEntityId: string; readonly bankAccountId: string },
  payment: Payment,
) => {
  if (line.legalEntityId !== payment.legalEntityId) return "legal_entity" as const

  if (line.bankAccountId !== payment.cashAccountId) return "bank_account" as const

  return line.amount > 0n === (payment.direction === "incoming")
    ? undefined
    : ("direction" as const)
}

type ReceiptInput = Schema.Schema.Type<typeof ReceivePaymentInput>

const withheldOf = (input: Pick<ReceiptInput, "withholding">) =>
  input.withholding === undefined ? 0n : minor(input.withholding.amount)

/** Withheld tax settles documents with the cash, so it must leave cash and be allocated. */
export const checkWithholding = (
  input: Pick<ReceiptInput, "tenantId" | "amount" | "withholding" | "allocations">,
) => {
  const withheld = withheldOf(input)

  const allocated = input.allocations.reduce(
    (sum, allocation) => sum + minor(allocation.amount),
    0n,
  )

  const reason =
    withheld >= minor(input.amount)
      ? ("not_below_payment" as const)
      : withheld > allocated
        ? ("not_allocated" as const)
        : undefined

  return reason === undefined
    ? Effect.void
    : Effect.fail(new InvalidWithholding({ tenantId: input.tenantId, reason }))
}

/** The journal lines of a payment: cash against the control account, withholding as a claim. */
export const paymentLines = (
  direction: PaymentDirection,
  input: Pick<ReceiptInput, "cashAccountId" | "amount" | "withholding">,
) => {
  const cash =
    input.cashAccountId === undefined
      ? { role: "cash" as const }
      : { accountId: input.cashAccountId }

  const counter = { role: rules[direction].side } as const

  if (direction === "outgoing") {
    return [
      { ...counter, debit: input.amount, credit: "0" },
      { ...cash, debit: "0", credit: input.amount },
    ]
  }

  const withholding = input.withholding

  return [
    { ...cash, debit: major(minor(input.amount) - withheldOf(input)), credit: "0" },
    ...(withholding === undefined
      ? []
      : [{ accountId: withholding.accountId, debit: withholding.amount, credit: "0" }]),
    { ...counter, debit: "0", credit: input.amount },
  ]
}

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
    for (const key of typedKeys(totals)) totals[key] += values[key]
  }

  return totals
}

export const makeSettlementService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const authorized = scopedCommand(authorization)
  const ledger = yield* GeneralLedgerService
  const billing = yield* BillingService
  const numbering = yield* NumberingService

  const authorize = (
    input: { principal: Principal; tenantId: string },
    capability: CapabilityType,
  ) => authorization.authorize({ principal: input.principal, tenantId: input.tenantId, capability })

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
        ...withholdingOf(header),
      } satisfies Payment
    })

  /** Applies allocations of a locked payment to billing documents of its party and side. */
  const allocate = (
    principal: Principal,
    payment: Payment,
    allocations: ReadonlyArray<{ readonly invoiceId: string; readonly amount: string }>,
    allocatedOn: string,
  ) =>
    Effect.gen(function* () {
      if (allocatedOn < payment.paymentDate) {
        return yield* Effect.fail(
          new AllocationBeforePayment({
            tenantId: payment.tenantId,
            paymentId: payment.id,
            paymentDate: payment.paymentDate,
            allocatedOn,
          }),
        )
      }

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
          settledOn: allocatedOn,
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
            allocatedOn,
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
            Effect.map((payment): Payment | undefined => payment),
            Effect.catchTag("PaymentNotFound", () => Effect.succeed(undefined)),
          )

          if (recorded !== undefined) return recorded
        }

        yield* checkWithholding(input)

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

        const journal = yield* ledger.postDocumentEntry({
          principal: input.principal,
          tenantId: input.tenantId,
          legalEntityId: input.legalEntityId,
          postingDate: input.paymentDate,
          reference: `settlement/payment/${paymentId}`,
          description: allocated.number,
          source: { type: "settlement.payment", id: paymentId },
          lines: paymentLines(direction, input),
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
              withheldAmount: major(withheldOf(input)),
              withholdingReference: input.withholding?.certificateReference ?? null,
              withholdingAccountId: input.withholding?.accountId ?? null,
            }),
          "settlement.payment.insert",
        )
        const payment = yield* loadPayment(input.tenantId, paymentId, true)

        return yield* allocate(input.principal, payment, input.allocations, input.paymentDate)
      }),
      `settlement.payment_${direction}.atomic`,
    )

  const receivePayment = Effect.fn("SettlementService.receivePayment")(function* (
    input: Schema.Codec.Encoded<typeof ReceivePaymentInput>,
  ) {
    const decoded = yield* authorized(
      ReceivePaymentInput,
      SettlementCapabilities.paymentReceive,
    )(input)

    return yield* record("incoming", decoded)
  })

  const makePayment = Effect.fn("SettlementService.makePayment")(function* (
    input: Schema.Codec.Encoded<typeof MakePaymentInput>,
  ) {
    const decoded = yield* authorized(MakePaymentInput, SettlementCapabilities.paymentMake)(input)

    return yield* record("outgoing", decoded)
  })

  const allocatePayment = Effect.fn("SettlementService.allocatePayment")(function* (
    input: Schema.Codec.Encoded<typeof AllocatePaymentInput>,
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

        return yield* allocate(decoded.principal, locked, decoded.allocations, decoded.allocatedOn)
      }),
      "settlement.payment.allocate.atomic",
    )
  })

  const createPaymentTerm = Effect.fn("SettlementService.createPaymentTerm")(function* (
    input: Schema.Codec.Encoded<typeof CreatePaymentTermInput>,
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
    input: Schema.Codec.Encoded<typeof AssignPartyTermInput>,
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
  ) => {
    // What was still unallocated on the as-of date: the amount less allocations made by then.
    const unallocatedAsOf = sql<string>`${payments.amount} - coalesce((
      select sum(${paymentAllocations.amount}) from ${paymentAllocations}
      where ${paymentAllocations.tenantId} = ${payments.tenantId}
        and ${paymentAllocations.paymentId} = ${payments.id}
        and ${paymentAllocations.allocatedOn} <= ${asOf}
    ), 0)`

    return database.query(
      (db) =>
        db
          .select({ partyId: payments.partyId, unallocated: unallocatedAsOf })
          .from(payments)
          .where(
            and(
              eq(payments.tenantId, tenantId),
              eq(payments.legalEntityId, legalEntityId),
              eq(payments.direction, direction),
              sql`${unallocatedAsOf} > 0`,
              lte(payments.paymentDate, asOf),
            ),
          ),
      "settlement.payment.unallocated",
    )
  }

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

  const listPayments = Effect.fn("SettlementService.listPayments")(function* (
    input: Schema.Codec.Encoded<typeof ListPaymentsInput>,
  ) {
    const decoded = yield* authorized(ListPaymentsInput, SettlementCapabilities.reportRead)(input)

    return yield* database.transaction(async (tx) => {
      const headers = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.tenantId, decoded.tenantId),
            eq(payments.legalEntityId, decoded.legalEntityId),
            ...(decoded.direction === undefined ? [] : [eq(payments.direction, decoded.direction)]),
            ...(decoded.partyId === undefined ? [] : [eq(payments.partyId, decoded.partyId)]),
            ...(decoded.invoiceId === undefined
              ? []
              : [
                  inArray(
                    payments.id,
                    tx
                      .select({ id: paymentAllocations.paymentId })
                      .from(paymentAllocations)
                      .where(
                        and(
                          eq(paymentAllocations.tenantId, decoded.tenantId),
                          eq(paymentAllocations.invoiceId, decoded.invoiceId),
                        ),
                      ),
                  ),
                ]),
          ),
        )
        .orderBy(desc(payments.paymentDate), desc(payments.number))
        .limit(decoded.limit ?? 100)

      const allocations =
        headers.length === 0
          ? []
          : await tx
              .select({
                paymentId: paymentAllocations.paymentId,
                invoiceId: paymentAllocations.invoiceId,
                amount: paymentAllocations.amount,
              })
              .from(paymentAllocations)
              .where(
                and(
                  eq(paymentAllocations.tenantId, decoded.tenantId),
                  inArray(
                    paymentAllocations.paymentId,
                    headers.map((header) => header.id),
                  ),
                ),
              )
              .orderBy(asc(paymentAllocations.invoiceId))

      return headers.map((header): Payment => ({
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
        allocations: allocations
          .filter((row) => row.paymentId === header.id)
          .map((row) => ({ invoiceId: row.invoiceId, amount: normalize(row.amount) })),
        ...withholdingOf(header),
      }))
    }, "settlement.payment.list")
  })

  const aging = Effect.fn("SettlementService.aging")(function* (
    input: Schema.Codec.Encoded<typeof AgingInput>,
  ) {
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
    input: Schema.Codec.Encoded<typeof StatementInput>,
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

  const importBankStatement = Effect.fn("SettlementService.importBankStatement")(function* (
    input: Schema.Codec.Encoded<typeof ImportBankStatementInput>,
  ) {
    const decoded = yield* authorized(
      ImportBankStatementInput,
      SettlementCapabilities.bankStatementImport,
    )(input)

    const lines = yield* parseBankStatement(decoded.content)

    const checksum = yield* bankStatementChecksum(decoded.content)

    const { tenantId, legalEntityId, bankAccountId } = decoded

    return yield* database
      .transaction(async (tx) => {
        const inserted = await tx
          .insert(bankStatements)
          .values({
            tenantId,
            legalEntityId,
            bankAccountId,
            sourceName: decoded.sourceName,
            checksum,
            importedBy: decoded.principal.userAccountId,
          })
          .onConflictDoNothing({
            target: [
              bankStatements.tenantId,
              bankStatements.legalEntityId,
              bankStatements.bankAccountId,
              bankStatements.checksum,
            ],
          })
          .returning()

        const created = inserted[0]

        if (created !== undefined) {
          await tx.insert(bankStatementLines).values(
            lines.map((line) => ({
              tenantId,
              statementId: created.id,
              lineNumber: line.lineNumber,
              bookingDate: line.bookingDate,
              description: line.description,
              reference: line.reference,
              amount: line.amount,
            })),
          )

          return { header: created, lineCount: lines.length }
        }

        // The same content was imported before: return that statement.
        const [existing] = await tx
          .select()
          .from(bankStatements)
          .where(
            and(
              eq(bankStatements.tenantId, tenantId),
              eq(bankStatements.legalEntityId, legalEntityId),
              eq(bankStatements.bankAccountId, bankAccountId),
              eq(bankStatements.checksum, checksum),
            ),
          )

        const [total] = await tx
          .select({ lineCount: count() })
          .from(bankStatementLines)
          .where(
            and(
              eq(bankStatementLines.tenantId, tenantId),
              eq(bankStatementLines.statementId, existing!.id),
            ),
          )

        return { header: existing!, lineCount: total!.lineCount }
      }, "settlement.bank_statement.import")
      .pipe(
        Effect.map(({ header, lineCount }) => ({
          id: header.id,
          tenantId: header.tenantId,
          legalEntityId: header.legalEntityId,
          bankAccountId: header.bankAccountId,
          sourceName: header.sourceName,
          checksum: header.checksum,
          lineCount,
        })),
        Effect.mapError((error) =>
          isDatabaseConstraint(error, "bank_statements_bank_account_fkey", "23503")
            ? new AccountNotFound({ tenantId })
            : isDatabaseConstraint(error, "bank_statements_legal_entity_fkey", "23503")
              ? new AccountingLegalEntityNotFound({ tenantId, legalEntityId })
              : error,
        ),
      )
  })

  const matchOf = (row: typeof bankLineMatches.$inferSelect): BankLineMatch => ({
    id: row.id,
    tenantId: row.tenantId,
    lineId: row.lineId,
    paymentId: row.paymentId,
    amount: normalize(row.amount),
    reversed: row.reversedAt !== null,
  })

  /** What active matches already cover, summed by line or by payment. */
  const matchedTotal = (tenantId: string, by: "line" | "payment", id: string) =>
    database
      .query(
        (db) =>
          db
            .select({ total: sql<string>`coalesce(sum(${bankLineMatches.amount}), 0)` })
            .from(bankLineMatches)
            .where(
              and(
                eq(bankLineMatches.tenantId, tenantId),
                eq(by === "line" ? bankLineMatches.lineId : bankLineMatches.paymentId, id),
                isNull(bankLineMatches.reversedAt),
              ),
            ),
        `settlement.bank_match.total_by_${by}`,
      )
      .pipe(Effect.map((rows) => minor(rows[0]!.total)))

  /** Locks a statement line and reads the legal entity and bank account of its statement. */
  const lockBankLine = (tenantId: string, lineId: string) =>
    Effect.gen(function* () {
      const [line] = yield* database.query(
        (db) =>
          db
            .select({
              amount: bankStatementLines.amount,
              statementId: bankStatementLines.statementId,
            })
            .from(bankStatementLines)
            .where(
              and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.id, lineId)),
            )
            .for("update"),
        "settlement.bank_match.line",
      )

      if (line === undefined) return yield* Effect.fail(new BankLineNotFound({ tenantId, lineId }))

      const [statement] = yield* database.query(
        (db) =>
          db
            .select({
              legalEntityId: bankStatements.legalEntityId,
              bankAccountId: bankStatements.bankAccountId,
            })
            .from(bankStatements)
            .where(
              and(eq(bankStatements.tenantId, tenantId), eq(bankStatements.id, line.statementId)),
            ),
        "settlement.bank_match.statement",
      )

      return { amount: signedMinor(line.amount), ...statement! }
    })

  /** The match a retried command already recorded, if the caller gave a match id. */
  const recordedMatch = (tenantId: string, matchId: string | undefined) =>
    matchId === undefined
      ? Effect.succeed(undefined)
      : database
          .query(
            (db) =>
              db
                .select()
                .from(bankLineMatches)
                .where(
                  and(eq(bankLineMatches.tenantId, tenantId), eq(bankLineMatches.id, matchId)),
                ),
            "settlement.bank_match.recorded",
          )
          .pipe(Effect.map(([row]) => (row === undefined ? undefined : matchOf(row))))

  const matchBankLine = Effect.fn("SettlementService.matchBankLine")(function* (
    input: Schema.Codec.Encoded<typeof MatchBankLineInput>,
  ) {
    const decoded = yield* authorized(
      MatchBankLineInput,
      SettlementCapabilities.bankStatementReconcile,
    )(input)

    const { tenantId, lineId, paymentId } = decoded

    return yield* database.withTransaction(
      Effect.gen(function* () {
        // Lock the line, then the payment, so concurrent matches of either serialize.
        const line = yield* lockBankLine(tenantId, lineId)
        const recorded = yield* recordedMatch(tenantId, decoded.matchId)

        if (recorded !== undefined) return recorded

        const payment = yield* loadPayment(tenantId, paymentId, true)
        const mismatch = matchMismatch(line, payment)

        if (mismatch !== undefined)
          return yield* Effect.fail(
            new BankMatchMismatch({ tenantId, lineId, paymentId, reason: mismatch }),
          )

        const lineOpen = abs(line.amount) - (yield* matchedTotal(tenantId, "line", lineId))
        const paymentOpen = cashOf(payment) - (yield* matchedTotal(tenantId, "payment", paymentId))
        const available = lineOpen < paymentOpen ? lineOpen : paymentOpen

        if (minor(decoded.amount) > available) {
          return yield* Effect.fail(
            new BankMatchExceedsAvailable({
              tenantId,
              lineId,
              paymentId,
              available: major(available),
              requested: normalize(decoded.amount),
            }),
          )
        }

        const [match] = yield* database.query(
          (db) =>
            db
              .insert(bankLineMatches)
              .values({
                id: decoded.matchId ?? uuidv7(),
                tenantId,
                lineId,
                paymentId,
                amount: decoded.amount,
                matchedBy: decoded.principal.userAccountId,
              })
              .returning(),
          "settlement.bank_match.insert",
        )

        return matchOf(match!)
      }),
      "settlement.bank_match.atomic",
    )
  })

  const reverseBankMatch = Effect.fn("SettlementService.reverseBankMatch")(function* (
    input: Schema.Codec.Encoded<typeof ReverseBankMatchInput>,
  ) {
    const decoded = yield* authorized(
      ReverseBankMatchInput,
      SettlementCapabilities.bankStatementReconcile,
    )(input)

    const { tenantId, matchId } = decoded

    return yield* database.withTransaction(
      Effect.gen(function* () {
        const [reversed] = yield* database.query(
          (db) =>
            db
              .update(bankLineMatches)
              .set({ reversedAt: new Date(), reversedBy: decoded.principal.userAccountId })
              .where(
                and(
                  eq(bankLineMatches.tenantId, tenantId),
                  eq(bankLineMatches.id, matchId),
                  isNull(bankLineMatches.reversedAt),
                ),
              )
              .returning(),
          "settlement.bank_match.reverse",
        )

        if (reversed !== undefined) return matchOf(reversed)

        // Already reversed, or never existed.
        const [existing] = yield* database.query(
          (db) =>
            db
              .select()
              .from(bankLineMatches)
              .where(and(eq(bankLineMatches.tenantId, tenantId), eq(bankLineMatches.id, matchId))),
          "settlement.bank_match.load",
        )

        return existing === undefined
          ? yield* Effect.fail(new BankMatchNotFound({ tenantId, matchId }))
          : matchOf(existing)
      }),
      "settlement.bank_match.reverse.atomic",
    )
  })

  const bankReconciliation = Effect.fn("SettlementService.bankReconciliation")(function* (
    input: Schema.Codec.Encoded<typeof BankReconciliationInput>,
  ) {
    const decoded = yield* authorized(
      BankReconciliationInput,
      SettlementCapabilities.reportRead,
    )(input)

    const { tenantId, legalEntityId, bankAccountId } = decoded
    const limit = decoded.limit ?? 100

    const matchedOnLine = sql<string>`coalesce((
      select sum(${bankLineMatches.amount}) from ${bankLineMatches}
      where ${bankLineMatches.tenantId} = ${bankStatementLines.tenantId}
        and ${bankLineMatches.lineId} = ${bankStatementLines.id}
        and ${bankLineMatches.reversedAt} is null
    ), 0)`

    const unmatchedOnLine = sql<string>`abs(${bankStatementLines.amount}) - ${matchedOnLine}`

    const matchedOnPayment = sql<string>`coalesce((
      select sum(${bankLineMatches.amount}) from ${bankLineMatches}
      where ${bankLineMatches.tenantId} = ${payments.tenantId}
        and ${bankLineMatches.paymentId} = ${payments.id}
        and ${bankLineMatches.reversedAt} is null
    ), 0)`

    const unmatchedCash = sql<string>`${payments.amount} - ${payments.withheldAmount} - ${matchedOnPayment}`

    const lines = yield* database.query(
      (db) =>
        db
          .select({
            id: bankStatementLines.id,
            statementId: bankStatementLines.statementId,
            sourceName: bankStatements.sourceName,
            lineNumber: bankStatementLines.lineNumber,
            bookingDate: bankStatementLines.bookingDate,
            description: bankStatementLines.description,
            reference: bankStatementLines.reference,
            amount: bankStatementLines.amount,
            unmatched: unmatchedOnLine,
          })
          .from(bankStatementLines)
          .innerJoin(
            bankStatements,
            and(
              eq(bankStatements.tenantId, bankStatementLines.tenantId),
              eq(bankStatements.id, bankStatementLines.statementId),
            ),
          )
          .where(
            and(
              eq(bankStatements.tenantId, tenantId),
              eq(bankStatements.legalEntityId, legalEntityId),
              eq(bankStatements.bankAccountId, bankAccountId),
              sql`${unmatchedOnLine} > 0`,
            ),
          )
          .orderBy(
            asc(bankStatementLines.bookingDate),
            asc(bankStatementLines.statementId),
            asc(bankStatementLines.lineNumber),
          )
          .limit(limit)
          .offset(decoded.lineOffset ?? 0),
      "settlement.bank_reconciliation.lines",
    )

    const unmatchedPayments = yield* database.query(
      (db) =>
        db
          .select({
            id: payments.id,
            number: payments.number,
            direction: payments.direction,
            partyId: payments.partyId,
            paymentDate: payments.paymentDate,
            unallocatedAmount: payments.unallocatedAmount,
            unmatched: unmatchedCash,
          })
          .from(payments)
          .where(
            and(
              eq(payments.tenantId, tenantId),
              eq(payments.legalEntityId, legalEntityId),
              eq(payments.cashAccountId, bankAccountId),
              sql`${unmatchedCash} > 0`,
            ),
          )
          .orderBy(asc(payments.paymentDate), asc(payments.number))
          .limit(limit)
          .offset(decoded.paymentOffset ?? 0),
      "settlement.bank_reconciliation.payments",
    )

    const matches = yield* database.query(
      (db) =>
        db
          .select({
            id: bankLineMatches.id,
            lineId: bankLineMatches.lineId,
            statementId: bankStatementLines.statementId,
            paymentId: bankLineMatches.paymentId,
            paymentNumber: payments.number,
            bookingDate: bankStatementLines.bookingDate,
            description: bankStatementLines.description,
            sourceName: bankStatements.sourceName,
            lineNumber: bankStatementLines.lineNumber,
            reference: bankStatementLines.reference,
            amount: bankLineMatches.amount,
          })
          .from(bankLineMatches)
          .innerJoin(
            bankStatementLines,
            and(
              eq(bankStatementLines.tenantId, bankLineMatches.tenantId),
              eq(bankStatementLines.id, bankLineMatches.lineId),
            ),
          )
          .innerJoin(
            bankStatements,
            and(
              eq(bankStatements.tenantId, bankStatementLines.tenantId),
              eq(bankStatements.id, bankStatementLines.statementId),
            ),
          )
          .innerJoin(
            payments,
            and(
              eq(payments.tenantId, bankLineMatches.tenantId),
              eq(payments.id, bankLineMatches.paymentId),
            ),
          )
          .where(
            and(
              eq(bankStatements.tenantId, tenantId),
              eq(bankStatements.legalEntityId, legalEntityId),
              eq(bankStatements.bankAccountId, bankAccountId),
              isNull(bankLineMatches.reversedAt),
              decoded.afterMatchId === undefined
                ? undefined
                : gt(bankLineMatches.id, decoded.afterMatchId),
            ),
          )
          .orderBy(asc(bankLineMatches.id))
          .limit(limit),
      "settlement.bank_reconciliation.matches",
    )

    return {
      legalEntityId,
      bankAccountId,
      lines: lines.map((line) => ({
        id: line.id,
        statementId: line.statementId,
        sourceName: line.sourceName,
        lineNumber: line.lineNumber,
        bookingDate: line.bookingDate,
        description: line.description,
        reference: line.reference,
        amount: normalizeSigned(line.amount),
        unmatchedAmount: normalize(line.unmatched),
      })),
      payments: unmatchedPayments.map((payment) => ({
        id: payment.id,
        number: payment.number,
        direction: payment.direction,
        partyId: payment.partyId,
        paymentDate: payment.paymentDate,
        unmatchedCash: normalize(payment.unmatched),
        unallocatedAmount: normalize(payment.unallocatedAmount),
      })),
      matches: matches.map((match) => ({ ...match, amount: normalize(match.amount) })),
    }
  })

  return {
    createPaymentTerm,
    assignPartyTerm,
    receivePayment,
    makePayment,
    allocatePayment,
    listPayments,
    aging,
    customerStatement,
    importBankStatement,
    matchBankLine,
    reverseBankMatch,
    bankReconciliation,
  } satisfies SettlementService
})

export const SettlementLive = Layer.effect(SettlementService, makeSettlementService)
