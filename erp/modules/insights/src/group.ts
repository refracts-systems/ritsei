import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { ExchangeRateService, GeneralLedgerService } from "../../accounting/mod.ts"
import { OrgUnitService } from "../../party/mod.ts"
import { consolidate, type EntityFigures } from "./consolidation.ts"
import {
  type GroupEntity,
  type GroupKpis,
  GroupKpisInput,
  type GroupStatements,
  GroupStatementsInput,
  type Kpis,
  type CommonFailure,
} from "./contract.ts"

type Principal = Schema.Schema.Type<typeof GroupKpisInput>["principal"]

type Scope = { readonly principal: Principal; readonly tenantId: string }

const kpiKeys = [
  "netSales",
  "receivableOverdue",
  "payableOverdue",
  "cash",
  "inventoryValue",
  "confirmedUndelivered",
] as const

const statementKeys = [
  "revenue",
  "expenses",
  "netIncome",
  "assets",
  "liabilities",
  "equity",
  "unclosedEarnings",
  "totalLiabilitiesAndEquity",
] as const

const pick = (kpi: { readonly status: string; readonly value: string | null }) =>
  kpi.status === "ok" ? kpi.value : null

const figuresOf = (kpis: Kpis, previous: boolean) =>
  Object.fromEntries(
    kpiKeys.map((key) => [
      key,
      pick({
        status: kpis[key].status,
        value: previous ? kpis[key].previous : kpis[key].value,
      }),
    ]),
  )

/**
 * Group reads over a unit's legal entities, in the group currency (ADR-0130). Each entity is read
 * with the same owners and capabilities as a single-entity read; an entity that cannot be read or
 * translated is left out of the totals and marked, never counted as zero.
 */
export const makeGroupReads = Effect.fn("InsightsService.makeGroupReads")(function* (
  kpisOf: (input: {
    readonly principal: Principal
    readonly tenantId: string
    readonly legalEntityId: string
    readonly period: string
  }) => Effect.Effect<Kpis, CommonFailure>,
) {
  const units = yield* OrgUnitService
  const exchange = yield* ExchangeRateService
  const ledger = yield* GeneralLedgerService

  /** The rate from an entity's currency to the group's on a day: "1" within one currency. */
  const rateOf = (scope: Scope, from: string | null, to: string, asOf: string) =>
    from === null
      ? Effect.succeed<string | null>(null)
      : from === to
        ? Effect.succeed<string | null>("1")
        : exchange
            .find({ ...scope, fromCurrency: from, toCurrency: to, asOf })
            .pipe(Effect.map((found) => found?.rate ?? null))

  const resolve = (scope: Scope, unitId: string) =>
    Effect.gen(function* () {
      const unit = yield* units.resolve({ ...scope, unitId })

      const currencies = yield* exchange.legalEntityCurrencies({
        ...scope,
        legalEntityIds: unit.legalEntityIds,
      })

      return { unit, currencies }
    })

  const toEntity = (
    consolidated: ReturnType<typeof consolidate>["entities"][number],
    status: GroupEntity["status"],
    previousRate: string | null,
    previous: ReturnType<typeof consolidate>["entities"][number] | undefined,
  ): GroupEntity => ({
    legalEntityId: consolidated.legalEntityId,
    currency: consolidated.currency,
    rate: consolidated.rate,
    previousRate,
    status,
    figures: { ...consolidated.figures, ...prefixed(previous?.figures) },
    translated: { ...consolidated.translated, ...prefixed(previous?.translated) },
  })

  const prefixed = <T>(figures: Readonly<Record<string, T>> | undefined): Record<string, T> =>
    Object.fromEntries(
      Object.entries(figures ?? {}).map(([key, value]) => [`${key}Previous`, value]),
    )

  const groupKpis = Effect.fn("InsightsService.groupKpis")(function* (
    input: Schema.Codec.Encoded<typeof GroupKpisInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(GroupKpisInput)(input)
    const scope = { principal: decoded.principal, tenantId: decoded.tenantId }
    const { unit, currencies } = yield* resolve(scope, decoded.unitId)

    const read = yield* Effect.forEach(unit.legalEntityIds, (legalEntityId) =>
      kpisOf({ ...scope, legalEntityId, period: decoded.period }).pipe(
        Effect.map((kpis): Kpis | null => kpis),
        // An entity this caller may not read at all is left out and marked.
        Effect.catchTag("AuthorizationDenied", () => Effect.succeed<Kpis | null>(null)),
      ),
    )

    const first = read.find((kpis) => kpis !== null)

    const dates = {
      to: first?.to ?? "",
      previousTo: previousEnd(first?.to ?? ""),
    }

    const current: Array<EntityFigures> = []
    const previous: Array<EntityFigures> = []

    for (const [index, legalEntityId] of unit.legalEntityIds.entries()) {
      const kpis = read[index] ?? null
      const currency = currencies.get(legalEntityId) ?? null
      const to = kpis?.to ?? dates.to
      const previousTo = kpis === null ? dates.previousTo : previousEnd(kpis.to)

      current.push({
        legalEntityId,
        currency,
        rate: yield* rateOf(scope, currency, unit.currency, to),
        figures: kpis === null ? {} : figuresOf(kpis, false),
      })

      previous.push({
        legalEntityId,
        currency,
        rate: yield* rateOf(scope, currency, unit.currency, previousTo),
        figures: kpis === null ? {} : figuresOf(kpis, true),
      })
    }

    const now = consolidate(current, kpiKeys)
    const before = consolidate(previous, kpiKeys)

    const periodDates = first === undefined ? { from: "", to: "", previousPeriod: "" } : first

    return {
      unitId: decoded.unitId,
      period: decoded.period,
      from: periodDates.from,
      to: periodDates.to,
      previousPeriod: first?.previousPeriod ?? "",
      groupCurrency: unit.currency,
      entities: now.entities.map((entity, index) =>
        toEntity(
          entity,
          read[index] === null
            ? "denied"
            : entity.currency === null || entity.rate === null
              ? "unavailable"
              : "ok",
          before.entities[index]!.rate,
          before.entities[index],
        ),
      ),
      totals: { ...now.totals, ...prefixed(before.totals) },
      complete: { ...now.complete, ...prefixed(before.complete) },
      intercompanyEliminated: false,
    } satisfies GroupKpis
  })

  const groupStatements = Effect.fn("InsightsService.groupStatements")(function* (
    input: Schema.Codec.Encoded<typeof GroupStatementsInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(GroupStatementsInput)(input)
    const scope = { principal: decoded.principal, tenantId: decoded.tenantId }
    const { unit, currencies } = yield* resolve(scope, decoded.unitId)

    const entities: Array<EntityFigures> = []
    const denied = new Set<string>()

    for (const legalEntityId of unit.legalEntityIds) {
      const currency = currencies.get(legalEntityId) ?? null

      const statements = yield* Effect.all({
        pnl: ledger.profitAndLoss({ ...scope, legalEntityId, from: decoded.from, to: decoded.to }),
        sheet: ledger.balanceSheet({ ...scope, legalEntityId, asOf: decoded.to }),
      }).pipe(
        Effect.map((found): { pnl: PnL; sheet: Sheet } | null => found),
        Effect.catchTag("AuthorizationDenied", () => Effect.succeed(null)),
      )

      if (statements === null) denied.add(legalEntityId)

      entities.push({
        legalEntityId,
        currency,
        rate: yield* rateOf(scope, currency, unit.currency, decoded.to),
        figures:
          statements === null
            ? {}
            : {
                revenue: statements.pnl.revenue.total,
                expenses: statements.pnl.expenses.total,
                netIncome: statements.pnl.netIncome,
                assets: statements.sheet.assets.total,
                liabilities: statements.sheet.liabilities.total,
                equity: statements.sheet.equity.total,
                unclosedEarnings: statements.sheet.unclosedEarnings,
                totalLiabilitiesAndEquity: statements.sheet.totalLiabilitiesAndEquity,
              },
      })
    }

    const result = consolidate(entities, statementKeys)

    return {
      unitId: decoded.unitId,
      from: decoded.from,
      to: decoded.to,
      groupCurrency: unit.currency,
      entities: result.entities.map((entity) =>
        toEntity(
          entity,
          denied.has(entity.legalEntityId)
            ? "denied"
            : entity.currency === null || entity.rate === null
              ? "unavailable"
              : "ok",
          entity.rate,
          undefined,
        ),
      ),
      totals: result.totals,
      complete: result.complete,
      intercompanyEliminated: false,
    } satisfies GroupStatements
  })

  return { groupKpis, groupStatements }
})

type PnL = Effect.Success<ReturnType<GeneralLedgerService["profitAndLoss"]>>

type Sheet = Effect.Success<ReturnType<GeneralLedgerService["balanceSheet"]>>

/** The last day of the month before the one a date is in. */
const previousEnd = (day: string) =>
  day === ""
    ? ""
    : new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, 0))
        .toISOString()
        .slice(0, 10)
