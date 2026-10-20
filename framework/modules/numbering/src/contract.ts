import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { CalendarDate, type DatabaseFailure } from "../../../foundation/mod.ts"

const Uuid = Schema.String.check(Schema.isUUID())

/** A dotted lowercase document type owned by the caller, such as `billing.customer_invoice`. */
export const DocumentType = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_.]*$/))

const Prefix = Schema.String.check(
  Schema.makeFilter((value) => value === value.trim() && value.length <= 32, {
    expected: "a trimmed prefix of at most 32 characters",
  }),
)

/**
 * Allocate the next number of a gapless series. Call it inside the transaction that commits the
 * numbered document: the series row stays locked until commit, and a rollback returns the value.
 * Allocating again for the same document returns the number it already holds.
 */
export const AllocateNumberInput = Schema.Struct({
  tenantId: Uuid,
  /** The numbering scope, normally the legal entity that issues the document. */
  scopeId: Uuid,
  documentType: DocumentType,
  documentId: Uuid,
  documentDate: CalendarDate,
  /**
   * First month of the scope's fiscal year; the series restarts every fiscal year. Omit it to use
   * the composed `FiscalCalendar` (calendar year when none is composed).
   */
  fiscalYearStartMonth: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
  ),
  /** Prefix for a new fiscal-year series, for example `INV/`. */
  prefix: Prefix,
  padding: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 }))),
})
export type AllocateNumberCommand = Schema.Schema.Type<typeof AllocateNumberInput>

export const AllocatedNumber = Schema.Struct({
  seriesId: Uuid,
  periodKey: Schema.String.check(Schema.isPattern(/^\d{4}$/)),
  value: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  number: Schema.String,
})
export type AllocatedNumber = Schema.Schema.Type<typeof AllocatedNumber>

export interface NumberingService {
  readonly allocate: (
    input: unknown,
  ) => Effect.Effect<AllocatedNumber, DatabaseFailure | Schema.SchemaError>
}

export const NumberingService = Context.Service<NumberingService>("RITSEI/NumberingService")

/**
 * The fiscal calendar of a numbering scope. The owner of the scope's accounting configuration (the
 * legal entity's Accounting configuration) provides it, so document owners never pass or guess the
 * fiscal-year start month (ADR-0095).
 */
export interface FiscalCalendar {
  readonly fiscalYearStartMonth: (
    tenantId: string,
    scopeId: string,
  ) => Effect.Effect<number, DatabaseFailure>
}

export const FiscalCalendar = Context.Service<FiscalCalendar>("RITSEI/FiscalCalendar")

/** The fiscal year label: the calendar year in which the document's fiscal year starts. */
export const fiscalPeriodKey = (documentDate: string, fiscalYearStartMonth: number): string => {
  const year = Number(documentDate.slice(0, 4))
  const month = Number(documentDate.slice(5, 7))
  return String(month >= fiscalYearStartMonth ? year : year - 1)
}

export const formatNumber = (prefix: string, periodKey: string, value: number, padding: number) =>
  `${prefix}${periodKey}/${String(value).padStart(padding, "0")}`

export const DEFAULT_PADDING = 5
