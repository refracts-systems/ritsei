/**
 * Alchemy model of the Tax aggregates (ADR-0124, phase 1, class A). Stories run it in memory; no
 * production path loads it and `mod.ts` does not export it, because tax codes stay table-backed
 * (foreign keys from products, `TAX-PROD-1`). Every decision it makes is a pure function in
 * `tax-decisions.ts` or `contract.ts` that the production service or memory store also calls.
 *
 * Tenant scope and authorization run in the RITSEI service before a command is sent (phase 0), so
 * nothing here checks a capability: an instance id is a tax code id, which the service builds from
 * the caller's tenant.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import { CalendarDate, FinancialMajorAmount } from "../../../../framework/foundation/mod.ts"
import { normalizeRate, TaxComputation, TaxDirection, TaxRate } from "./contract.ts"
import { decideRatePeriod, firstUnusableCode, computeTaxLines } from "./tax-decisions.ts"

export const TaxCodeId = Schema.String.pipe(Schema.brand("TaxCodeId"))

// ---------------------------------------------------------------- TaxCode aggregate

export class TaxCodeNotFound extends Domain.Rejection("TaxCodeNotFound", {
  taxCodeId: Schema.String,
}) {}

export class TaxCodeRateAlreadyExists extends Domain.Rejection("TaxCodeRateAlreadyExists", {
  taxCodeId: Schema.String,
  effectiveFrom: CalendarDate,
}) {}

export class TaxCodeCreated extends Domain.Event("TaxCodeCreated", {
  code: Schema.String,
  /** Normalized to four decimals. */
  rate: Schema.String,
  direction: TaxDirection,
}) {}

export class CreateTaxCode extends Domain.Command("CreateTaxCode", {
  target: TaxCodeId,
  input: { code: Schema.String, rate: TaxRate, direction: TaxDirection },
  events: [TaxCodeCreated],
}) {}

export class TaxCodeRateScheduled extends Domain.Event("TaxCodeRateScheduled", {
  effectiveFrom: CalendarDate,
  /** Normalized to four decimals. */
  rate: Schema.String,
}) {}

/** There is no command that changes or deletes a period: a rate change is a later period. */
export class ScheduleTaxCodeRate extends Domain.Command("ScheduleTaxCodeRate", {
  target: TaxCodeId,
  input: { effectiveFrom: CalendarDate, rate: TaxRate },
  events: [TaxCodeRateScheduled],
  rejects: [TaxCodeNotFound, TaxCodeRateAlreadyExists],
}) {}

const Unopened = Schema.TaggedStruct("Unopened", {})

const Open = Schema.TaggedStruct("Open", {
  code: Schema.String,
  rate: Schema.String,
  direction: TaxDirection,
  /** Rate by period start date. */
  periods: Schema.Record(Schema.String, Schema.String),
})

const TaxCodeState = Schema.Union([Unopened, Open])

export class TaxCode extends Domain.Aggregate("TaxCode", {
  id: TaxCodeId,
  state: TaxCodeState,
  initial: Unopened.make({}),
  commands: [CreateTaxCode, ScheduleTaxCodeRate],
  decide: {
    // Creating an existing code again records nothing; production has no such repeat, since it
    // mints a new id per code.
    CreateTaxCode: (state, cmd) =>
      Predicate.isTagged(state, "Open")
        ? []
        : [
            new TaxCodeCreated({
              code: cmd.code,
              rate: normalizeRate(cmd.rate),
              direction: cmd.direction,
            }),
          ],
    ScheduleTaxCodeRate: (state, cmd, ctx) => {
      if (!Predicate.isTagged(state, "Open")) return new TaxCodeNotFound({ taxCodeId: ctx.id })

      const period = decideRatePeriod(Object.keys(state.periods), cmd.effectiveFrom)

      return Predicate.isTagged(period, "AlreadyExists")
        ? new TaxCodeRateAlreadyExists({ taxCodeId: ctx.id, effectiveFrom: cmd.effectiveFrom })
        : [
            new TaxCodeRateScheduled({
              effectiveFrom: cmd.effectiveFrom,
              rate: normalizeRate(cmd.rate),
            }),
          ]
    },
  },
  evolve: {
    TaxCodeCreated: (_, e) =>
      Open.make({ code: e.code, rate: e.rate, direction: e.direction, periods: {} }),
    TaxCodeRateScheduled: (s, e) =>
      Predicate.isTagged(s, "Open")
        ? { ...s, periods: { ...s.periods, [e.effectiveFrom]: e.rate } }
        : s,
  },
}) {}

// ---------------------------------------------------------------- tax code reads

interface StoredTaxCode {
  readonly id: string
  readonly rate: string
  readonly direction: typeof TaxDirection.Type
  readonly active: boolean
  readonly periods: ReadonlyArray<{ readonly effectiveFrom: string; readonly rate: string }>
}

/** What the projection keeps of each code: the reference data every tax computation reads. */
export class TaxCodeStore extends Context.Service<
  TaxCodeStore,
  {
    readonly apply: (rows: ReadonlyArray<StoredTaxCode>) => Effect.Effect<void>
    readonly get: (ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<StoredTaxCode>>
  }
>()("Tax/TaxCodeStore") {}

export const MemoryTaxCodeStore = Layer.sync(TaxCodeStore, () => {
  const rows = new Map<string, StoredTaxCode>()

  return {
    apply: (batch) => Effect.sync(() => batch.forEach((row) => rows.set(row.id, row))),
    get: (ids) => Effect.sync(() => ids.flatMap((id) => (rows.has(id) ? [rows.get(id)!] : []))),
  }
})

export class TaxCodes extends Domain.Projection("TaxCodes", {
  from: [TaxCode],
  key: TaxCode,
  on: [TaxCodeCreated, TaxCodeRateScheduled],
}) {}

export const TaxCodesLive = TaxCodes.toLayer(
  Effect.gen(function* () {
    const store = yield* TaxCodeStore

    return Effect.fn(function* (batch) {
      for (const { key, event } of batch) {
        const [current] = yield* store.get([key.id])

        // Both events fold idempotently, since a projection runs at least once per input.
        if (Predicate.isTagged(event, "TaxCodeCreated")) {
          yield* store.apply([
            current ?? {
              id: key.id,
              rate: event.rate,
              direction: event.direction,
              active: true,
              periods: [],
            },
          ])
        } else if (current !== undefined) {
          yield* store.apply([
            {
              ...current,
              periods: [
                ...current.periods.filter((period) => period.effectiveFrom !== event.effectiveFrom),
                { effectiveFrom: event.effectiveFrom, rate: event.rate },
              ],
            },
          ])
        }
      }
    })
  }),
)

export class ComputeTax extends Domain.Query("ComputeTax", {
  input: {
    direction: TaxDirection,
    date: Schema.optionalKey(CalendarDate),
    lines: Schema.Array(
      Schema.Struct({
        key: Schema.String,
        base: FinancialMajorAmount,
        taxCodeId: Schema.NullOr(Schema.String),
      }),
    ),
  },
  success: TaxComputation,
  waitsFor: [TaxCodes],
  rejects: [TaxCodeNotFound],
}) {}

export const ComputeTaxLive = ComputeTax.toLayer(
  Effect.gen(function* () {
    const store = yield* TaxCodeStore

    return Effect.fn(function* (input) {
      const ids = [
        ...new Set(
          input.lines.flatMap((line) => (line.taxCodeId === null ? [] : [line.taxCodeId])),
        ),
      ]

      const codes = yield* store.get(ids)
      const unusable = firstUnusableCode(codes, input.direction, input.lines)

      if (unusable !== undefined) return yield* new TaxCodeNotFound({ taxCodeId: unusable })

      return computeTaxLines({
        date: input.date,
        codes,
        periods: codes.flatMap((code) =>
          code.periods.map((period) => ({ ...period, taxCodeId: code.id })),
        ),
        lines: input.lines,
      })
    })
  }),
)

export class TaxModel extends Domain.Model("TaxModel", {
  aggregates: [TaxCode],
  projections: [TaxCodes],
  queries: [ComputeTax],
}) {}

export const TaxModelHandlers = Layer.mergeAll(TaxCodesLive, ComputeTaxLive)
