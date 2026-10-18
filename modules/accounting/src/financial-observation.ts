import { and, asc, eq, inArray } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  financialOperations,
  financialOperationTransfers,
  journalEntries,
  journalLines,
} from "../../../db/schema/accounting.ts"
import { Database, type DrizzleDatabase, majorToMinor } from "../../../foundation/mod.ts"
import {
  type FinancialStoreAccountObservation,
  FinancialStoreInventory,
  FinancialStoreInventoryRequest,
  FinancialStoreInventoryScanner,
  type FinancialStoreInventoryScannerService,
  FinancialStoreObservationFailure,
  type FinancialStoreTransferObservation,
  FinancialStoreWatermark,
  FinancialStoreWatermarkCollector,
  type FinancialStoreWatermarkCollectorService,
  FinancialStoreWatermarkInput,
  hashFinancialStoreFacts,
} from "./financial-store-contract.ts"

const minor = (value: string | number | null) => {
  const result = majorToMinor(String(value ?? "0"), 2)
  return result.ok ? BigInt(result.value) : undefined
}

const positiveMinor = (value: string | number | null) => {
  try {
    return BigInt(String(value ?? "0")) > 0n
  } catch {
    return false
  }
}

const observationFailure = (
  scope: string,
  reason: "unavailable" | "unsupported" | "incomplete" | "invalid_fact" | "invalid_watermark",
) => new FinancialStoreObservationFailure({ scope, reason })

const parseLegalEntityScope = (scope: string) => {
  const match =
    /^tenant:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/legal-entity:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
      scope,
    )
  return match === null ? undefined : { tenantId: match[1]!, legalEntityId: match[2]! }
}

type OperationRow = {
  readonly currency: string
  readonly mappingVersion: number
  readonly updatedAt: Date | null
}

type TransferRow = {
  readonly transferId: string | null
  readonly debitAccountId: string
  readonly creditAccountId: string
  readonly amountMinor: string | number | null
  readonly observedTimestamp: string | null
  readonly operationCurrency: string
  readonly mappingVersion: number
}

type BalanceRow = {
  readonly accountId: string
  readonly currency: string
  readonly mappingVersion: number
  readonly debit: string | number | null
  readonly credit: string | number | null
  readonly observedAt: Date | null
}

const validateObservationRows = (
  scope: string,
  maxRecords: number,
  operationRows: readonly OperationRow[],
  transferRows: readonly TransferRow[],
  balanceRows: readonly BalanceRow[],
): Effect.Effect<void, FinancialStoreObservationFailure> => {
  if (
    operationRows.length > maxRecords ||
    transferRows.length > maxRecords ||
    balanceRows.length > maxRecords
  ) {
    return Effect.fail(observationFailure(scope, "incomplete"))
  }
  if (
    operationRows.some((row) => !/^[A-Z]{3}$/.test(row.currency) || row.mappingVersion < 1) ||
    transferRows.some(
      (row) =>
        !/^[A-Z]{3}$/.test(row.operationCurrency) ||
        row.mappingVersion < 1 ||
        !positiveMinor(row.amountMinor) ||
        row.debitAccountId === row.creditAccountId,
    ) ||
    balanceRows.some((row) => !/^[A-Z]{3}$/.test(row.currency) || row.mappingVersion < 1)
  ) {
    return Effect.fail(observationFailure(scope, "invalid_fact"))
  }
  return Effect.void
}

const buildTransferObservations = (
  scope: string,
  rows: readonly TransferRow[],
): Effect.Effect<readonly FinancialStoreTransferObservation[], FinancialStoreObservationFailure> =>
  Effect.gen(function* () {
    const transfers: FinancialStoreTransferObservation[] = []
    for (const row of rows) {
      if (row.transferId === null || row.observedTimestamp === null) {
        return yield* Effect.fail(observationFailure(scope, "incomplete"))
      }
      transfers.push({
        transferRef: row.transferId,
        debitAccountRef: row.debitAccountId,
        creditAccountRef: row.creditAccountId,
        amountMinor: String(row.amountMinor),
        currency: row.operationCurrency,
        mappingVersion: row.mappingVersion,
        status: "accepted",
        observedAt: row.observedTimestamp,
      })
    }
    return transfers
  })

const aggregateBalanceObservations = (
  scope: string,
  rows: readonly BalanceRow[],
): Effect.Effect<readonly FinancialStoreAccountObservation[], FinancialStoreObservationFailure> =>
  Effect.gen(function* () {
    const balances = new Map<string, FinancialStoreAccountObservation>()
    for (const row of rows) {
      if (row.observedAt === null) {
        return yield* Effect.fail(observationFailure(scope, "incomplete"))
      }
      const currency = row.currency.toUpperCase()
      const debitMinor = minor(row.debit)
      const creditMinor = minor(row.credit)
      if (debitMinor === undefined || creditMinor === undefined) {
        return yield* Effect.fail(observationFailure(scope, "incomplete"))
      }
      const observedAt = row.observedAt.toISOString()
      const key = `${row.accountId}:${currency}:${row.mappingVersion}`
      const current = balances.get(key) ?? {
        accountRef: row.accountId,
        currency,
        mappingVersion: row.mappingVersion,
        debitsPendingMinor: "0",
        debitsPostedMinor: "0",
        creditsPendingMinor: "0",
        creditsPostedMinor: "0",
        observedAt,
      }
      balances.set(key, {
        ...current,
        debitsPostedMinor: (BigInt(current.debitsPostedMinor) + debitMinor).toString(),
        creditsPostedMinor: (BigInt(current.creditsPostedMinor) + creditMinor).toString(),
        observedAt: current.observedAt > observedAt ? current.observedAt : observedAt,
      })
    }
    return [...balances.values()].sort((left, right) =>
      `${left.accountRef}:${left.currency}:${left.mappingVersion}`.localeCompare(
        `${right.accountRef}:${right.currency}:${right.mappingVersion}`,
      ),
    )
  })

const buildPostgresqlInventory = (
  scope: string,
  operationRows: readonly OperationRow[],
  accounts: readonly FinancialStoreAccountObservation[],
  transfers: readonly FinancialStoreTransferObservation[],
  now: () => Date,
) =>
  Effect.gen(function* () {
    const hash = yield* hashFinancialStoreFacts({ accounts, transfers })
    const latestOperation =
      operationRows.at(-1)?.updatedAt?.toISOString() ?? new Date(0).toISOString()
    const watermark: FinancialStoreWatermark = {
      authority: "postgresql",
      scope,
      value: `updatedAt:${latestOperation};operations:${operationRows.length};accounts:${accounts.length};transfers:${transfers.length}`,
      snapshotRef: `sha256:${hash}`,
      consistency: "bounded",
      capturedAt: now().toISOString(),
    }
    return {
      watermark,
      inventory: {
        authority: "postgresql" as const,
        scope,
        watermark,
        accounts,
        transfers,
      } satisfies FinancialStoreInventory,
    }
  })

const makePostgresqlInventoryServices = (now: () => Date) =>
  Effect.gen(function* () {
    const database = yield* Database
    const read = <A>(
      scope: string,
      operationName: string,
      operation: (db: DrizzleDatabase) => Promise<A>,
    ) =>
      database
        .query(operation, operationName)
        .pipe(Effect.mapError(() => observationFailure(scope, "unavailable")))

    const scan = (scope: string, maxRecords: number) =>
      Effect.gen(function* () {
        const limit = maxRecords + 1
        const scopeIds = parseLegalEntityScope(scope)
        if (scopeIds === undefined) {
          return yield* Effect.fail(observationFailure(scope, "unsupported"))
        }
        const operationScope = and(
          eq(financialOperations.tenantId, scopeIds.tenantId),
          eq(financialOperations.legalEntityId, scopeIds.legalEntityId),
        )
        const operationRows = yield* read(
          scope,
          "accounting.financial_observation.operations",
          (db) =>
            db
              .select({
                id: financialOperations.id,
                operationId: financialOperations.operationId,
                currency: financialOperations.currency,
                mappingVersion: financialOperations.mappingVersion,
                status: financialOperations.status,
                engineAcceptedAt: financialOperations.engineAcceptedAt,
                updatedAt: financialOperations.updatedAt,
              })
              .from(financialOperations)
              .where(
                and(
                  operationScope,
                  eq(financialOperations.engineVerified, true),
                  inArray(financialOperations.status, ["accepted", "reconciled"]),
                ),
              )
              .orderBy(asc(financialOperations.updatedAt), asc(financialOperations.id))
              .limit(limit),
        )
        const transferRows = yield* read(
          scope,
          "accounting.financial_observation.transfers",
          (db) =>
            db
              .select({
                transferId: financialOperationTransfers.engineTransferId,
                debitAccountId: financialOperationTransfers.debitAccountId,
                creditAccountId: financialOperationTransfers.creditAccountId,
                amountMinor: financialOperationTransfers.amountMinor,
                status: financialOperationTransfers.status,
                observedTimestamp: financialOperationTransfers.observedTimestamp,
                operationCurrency: financialOperations.currency,
                mappingVersion: financialOperations.mappingVersion,
                operationUpdatedAt: financialOperations.updatedAt,
              })
              .from(financialOperationTransfers)
              .innerJoin(
                financialOperations,
                and(
                  eq(financialOperationTransfers.tenantId, financialOperations.tenantId),
                  eq(financialOperationTransfers.operationId, financialOperations.id),
                ),
              )
              .where(
                and(
                  operationScope,
                  eq(financialOperations.engineVerified, true),
                  inArray(financialOperations.status, ["accepted", "reconciled"]),
                  eq(financialOperationTransfers.status, "accepted"),
                ),
              )
              .orderBy(
                asc(financialOperationTransfers.createdAt),
                asc(financialOperationTransfers.id),
              )
              .limit(limit),
        )
        const balanceRows = yield* read(scope, "accounting.financial_observation.balances", (db) =>
          db
            .select({
              accountId: journalLines.accountId,
              currency: financialOperations.currency,
              mappingVersion: financialOperations.mappingVersion,
              debit: journalLines.debit,
              credit: journalLines.credit,
              observedAt: journalEntries.postedAt,
            })
            .from(journalLines)
            .innerJoin(
              journalEntries,
              and(
                eq(journalLines.tenantId, journalEntries.tenantId),
                eq(journalLines.entryId, journalEntries.id),
              ),
            )
            .innerJoin(
              financialOperations,
              and(
                eq(financialOperations.tenantId, journalEntries.tenantId),
                eq(financialOperations.journalId, journalEntries.id),
              ),
            )
            .where(
              and(
                operationScope,
                eq(financialOperations.engineVerified, true),
                inArray(financialOperations.status, ["accepted", "reconciled"]),
                inArray(journalEntries.status, ["posted", "reversed"]),
              ),
            )
            .orderBy(asc(journalEntries.postedAt), asc(journalLines.id))
            .limit(limit),
        )

        yield* validateObservationRows(scope, maxRecords, operationRows, transferRows, balanceRows)
        const transfers = yield* buildTransferObservations(scope, transferRows)
        const accounts = yield* aggregateBalanceObservations(scope, balanceRows)
        return yield* buildPostgresqlInventory(scope, operationRows, accounts, transfers, now)
      })

    const collector: FinancialStoreWatermarkCollectorService = {
      collect: (input) =>
        Effect.gen(function* () {
          const decoded = yield* Schema.decodeUnknownEffect(FinancialStoreWatermarkInput)(input)
          return (yield* scan(decoded.scope, decoded.maxRecords)).watermark
        }),
    }
    const scanner: FinancialStoreInventoryScannerService = {
      scan: (input) =>
        Effect.gen(function* () {
          const decoded = yield* Schema.decodeUnknownEffect(FinancialStoreInventoryRequest)(input)
          if (decoded.watermark.authority !== "postgresql") {
            return yield* Effect.fail(observationFailure(decoded.scope, "invalid_watermark"))
          }
          const observed = yield* scan(decoded.scope, decoded.maxRecords)
          if (
            observed.watermark.value !== decoded.watermark.value ||
            observed.watermark.snapshotRef !== decoded.watermark.snapshotRef ||
            observed.watermark.consistency !== decoded.watermark.consistency
          ) {
            return yield* Effect.fail(observationFailure(decoded.scope, "invalid_watermark"))
          }
          return observed.inventory
        }),
    }
    return { collector, scanner }
  })

export const makePostgresqlFinancialStoreObservation = (now: () => Date = () => new Date()) =>
  makePostgresqlInventoryServices(now)

export const makePostgresqlFinancialStoreObservationLayer = Layer.mergeAll(
  Layer.effect(
    FinancialStoreWatermarkCollector,
    makePostgresqlFinancialStoreObservation().pipe(Effect.map(({ collector }) => collector)),
  ),
  Layer.effect(
    FinancialStoreInventoryScanner,
    makePostgresqlFinancialStoreObservation().pipe(Effect.map(({ scanner }) => scanner)),
  ),
)
