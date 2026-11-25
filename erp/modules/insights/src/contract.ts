import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  CalendarDate,
  type DatabaseFailure,
  SignedAmount,
  Uuid,
} from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import type { OrgUnitNotFound } from "../../party/mod.ts"

/** A calendar month, `YYYY-MM`. */
export const Period = Schema.String.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/))

export const KpisInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  legalEntityId: Uuid,
  period: Period,
})

/**
 * `ok` carries the figures. `denied` means the caller may not read the owner that holds the figure,
 * and `unavailable` that the legal entity has no data to compute it from (for example no cash
 * posting rule); neither is shown as zero.
 */
export const KpiStatus = Schema.Literals(["ok", "denied", "unavailable"])

/** One amount for the period and the same amount for the previous period. */
export const Kpi = Schema.Struct({
  status: KpiStatus,
  value: Schema.NullOr(SignedAmount),
  previous: Schema.NullOr(SignedAmount),
})

/** Orders with something still to deliver, and what that is worth, now and a period earlier. */
export const UndeliveredKpi = Schema.Struct({
  status: KpiStatus,
  value: Schema.NullOr(SignedAmount),
  previous: Schema.NullOr(SignedAmount),
  orders: Schema.NullOr(Schema.Int),
  previousOrders: Schema.NullOr(Schema.Int),
})

/**
 * Six figures of one legal entity for a calendar month, each beside the previous month. Flow figures
 * (net sales) cover the month; balance figures are as of its last day.
 *
 * - `netSales`: customer invoices less credit notes dated in the month, before tax.
 * - `receivableOverdue` and `payableOverdue`: open items past their due date on the last day, by the
 *   payment terms of Settlement (credit notes and unallocated payments are not netted off).
 * - `cash`: the ledger balance of the cash posting role on the last day.
 * - `confirmedUndelivered`: confirmed orders with undelivered quantity at order prices; an order
 *   cancelled since the date is not counted, so the previous figure can understate.
 * - `inventoryValue`: the ledger balance of the inventory posting role on the last day.
 */
export const Kpis = Schema.Struct({
  legalEntityId: Uuid,
  period: Period,
  from: CalendarDate,
  to: CalendarDate,
  previousPeriod: Period,
  netSales: Kpi,
  receivableOverdue: Kpi,
  payableOverdue: Kpi,
  cash: Kpi,
  confirmedUndelivered: UndeliveredKpi,
  inventoryValue: Kpi,
})

export type Kpis = Schema.Schema.Type<typeof Kpis>

export type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

/** Read-only figures joined from the modules that own the data; it owns no data itself. */
export interface InsightsService {
  readonly kpis: (
    input: Schema.Codec.Encoded<typeof KpisInput>,
  ) => Effect.Effect<Kpis, CommonFailure>
  /** The KPIs of a unit's legal entities in the group currency, with per-entity lines. */
  readonly groupKpis: (
    input: Schema.Codec.Encoded<typeof GroupKpisInput>,
  ) => Effect.Effect<GroupKpis, OrgUnitNotFound | CommonFailure>
  /** Profit and loss and balance sheet totals of a unit's legal entities in the group currency. */
  readonly groupStatements: (
    input: Schema.Codec.Encoded<typeof GroupStatementsInput>,
  ) => Effect.Effect<GroupStatements, OrgUnitNotFound | CommonFailure>
}

export const InsightsService = Context.Service<InsightsService>("RITSEI/InsightsService")

const Amounts = Schema.Record(Schema.String, Schema.NullOr(SignedAmount))

/** One legal entity of a group read: its figures, the rate they were translated at, and why not. */
export const GroupEntity = Schema.Struct({
  legalEntityId: Uuid,
  /** The entity's base currency; null when accounting is not configured for it. */
  currency: Schema.NullOr(Schema.String),
  /** The rate at the end of the period (or the as-of day); null when none was entered. */
  rate: Schema.NullOr(Schema.String),
  /** The rate a period earlier, for the previous figures; the same as `rate` for statements. */
  previousRate: Schema.NullOr(Schema.String),
  status: Schema.Literals(["ok", "denied", "unavailable"]),
  /** The figures in the entity's own currency; null where its owner gave none. */
  figures: Amounts,
  /** The same figures in the group currency. */
  translated: Amounts,
})

export type GroupEntity = Schema.Schema.Type<typeof GroupEntity>

const GroupTotals = {
  groupCurrency: Schema.String,
  entities: Schema.Array(GroupEntity),
  /** The group total of each figure, from the entities that gave it. */
  totals: Schema.Record(Schema.String, SignedAmount),
  /** Per figure, whether every entity contributed; false means the total leaves some out. */
  complete: Schema.Record(Schema.String, Schema.Boolean),
  /** Intercompany balances are not eliminated in this version (ADR-0130). */
  intercompanyEliminated: Schema.Literal(false),
}

export const GroupKpisInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  unitId: Uuid,
  period: Period,
})

/**
 * The six KPIs of every legal entity at or under a unit, in the group currency. Figure keys are
 * those of \`Kpis\`; the previous month's are the same key with \`Previous\` added.
 */
export const GroupKpis = Schema.Struct({
  unitId: Uuid,
  period: Period,
  from: CalendarDate,
  to: CalendarDate,
  previousPeriod: Period,
  ...GroupTotals,
})

export type GroupKpis = Schema.Schema.Type<typeof GroupKpis>

export const GroupStatementsInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  unitId: Uuid,
  from: CalendarDate,
  to: CalendarDate,
})

/**
 * Profit and loss over \`from\` to \`to\` and the balance sheet at \`to\`, as section totals per entity
 * and in the group currency: revenue, expenses, netIncome, assets, liabilities, equity,
 * unclosedEarnings, and totalLiabilitiesAndEquity.
 */
export const GroupStatements = Schema.Struct({
  unitId: Uuid,
  from: CalendarDate,
  to: CalendarDate,
  ...GroupTotals,
})

export type GroupStatements = Schema.Schema.Type<typeof GroupStatements>
